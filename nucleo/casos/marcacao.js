// POST /efrat/marcacoes — o registro de ponto em lote.
//
// docs/fase3-contrato.md §1.6 e §3.3.3. E a rota mais quente do sistema, e a
// que exige a operacao atomica que tirou o n8n do caminho: a dedup por
// `id_cliente` deixa de depender de "envio unico em voo" no cliente
// (README.md:356) e passa a depender do INDICE UNICO.
//
// T-D00CE0 (§1.6): esta rota NUNCA responde 403 por estado de aparelho —
// sempre 200 item a item, que e o unico formato em que o cliente consegue
// soltar da fila o que ja foi resolvido. Aparelho revogado nao faz o lote
// inteiro voltar; cada marcacao recebe seu proprio veredito.

import * as dominio from '../dominio.js';

export async function enviarLote(ctx, req) {
  const b = req.corpo;

  // A autenticacao (adaptador) ja garantiu que a credencial resolve para
  // ALGUM aparelho conhecido, ou para o token do piloto. Aqui falta olhar o
  // ESTADO desse aparelho — e um aparelho que nao existe cai no mesmo ramo de
  // "nunca liberado", que e o certo.
  const dispositivo = b.dispositivo_id ? await ctx.repo.lerDispositivo(b.dispositivo_id) : null;

  const pessoas = await ctx.repo.listarPessoas();
  const resultados = [];

  for (const m of (b.marcacoes || [])) {
    if (!dominio.marcacaoTemCamposObrigatorios(m)) {
      resultados.push({ id_cliente: m && m.id_cliente, status: 'rejeitado', motivo: 'campos obrigatorios ausentes' });
      continue;
    }

    // Sonda de leitura, e ela responde ANTES de olhar o estado do aparelho —
    // e o comportamento do contrato: id_cliente ja conhecido e `duplicado`,
    // inclusive quando o ramo seguinte nao gravaria nada. Uma leitura obsoleta
    // aqui nao causa escrita dupla; quem protege o registro de ponto e o
    // `inserirMarcacaoSeAusente` de cada ramo que grava, mais abaixo.
    if (await ctx.repo.marcacaoExiste(m.id_cliente)) {
      resultados.push({ id_cliente: m.id_cliente, status: 'duplicado', motivo: null });
      continue;
    }

    const porAparelho = dominio.resultadoPorEstadoAparelho(dispositivo, req.agoraMs);
    if (porAparelho) {
      const linha = Object.assign({}, m, {
        requer_revisao: true,
        recebido_em: req.agoraIso,
        aparelho_estado_no_envio: dispositivo ? dispositivo.estado : 'desconhecido',
        aparelho_revogado_em: dispositivo ? (dispositivo.revogado_em || null) : null,
        aparelho_apelido: dispositivo ? dispositivo.apelido : null,
        aparelho_dispositivo_id: b.dispositivo_id || null,
        motivo_codigo: porAparelho.motivo_codigo
      });
      if (porAparelho.status === 'retido') {
        const gravou = await ctx.repo.inserirMarcacaoSeAusente(linha);
        if (!gravou.inserida) { resultados.push(duplicado(m)); continue; }
        // Teto de 500 retidas depois da revogacao (§1.6): incremento atomico,
        // porque contador que perde escrita e teto que nao segura.
        if (dispositivo) await ctx.repo.incrementarRetidasPosRevogacao(dispositivo.dispositivo_id);
      }
      resultados.push(comMotivo(m, porAparelho));
      continue;
    }

    const pessoa = pessoas.find(p => p.pessoa_id === m.pessoa_id) || null;
    const porPessoa = dominio.resultadoPorEstadoPessoa(pessoa, m.marcado_em);
    if (porPessoa) {
      if (porPessoa.status === 'retido') {
        const gravou = await ctx.repo.inserirMarcacaoSeAusente(Object.assign({}, m, {
          requer_revisao: true, recebido_em: req.agoraIso, motivo_codigo: porPessoa.motivo_codigo
        }));
        if (!gravou.inserida) { resultados.push(duplicado(m)); continue; }
      }
      resultados.push(comMotivo(m, porPessoa));
      continue;
    }

    // Gestor, manual, veredito diferente de aceito ou relogio fora de 2 min
    // vao para a mesa do RH. Mesma regra do workflow real.
    const revisar = dominio.exigeRevisaoDoRh(m, pessoa);
    const gravou = await ctx.repo.inserirMarcacaoSeAusente(Object.assign({}, m, {
      requer_revisao: !!revisar,
      foto_auditoria: revisar ? (m.foto_auditoria || '') : ''
    }));
    if (!gravou.inserida) { resultados.push(duplicado(m)); continue; }
    resultados.push({ id_cliente: m.id_cliente, status: 'aceito', motivo: null });
  }

  const conta = s => resultados.filter(x => x.status === s).length;
  return { status: 200, corpo: {
    ok: true, servidor_hora: req.agoraIso,
    resumo: {
      aceitas: conta('aceito'), duplicadas: conta('duplicado'),
      retidas: conta('retido'), rejeitadas: conta('rejeitado')
    },
    resultados
  } };
}

const duplicado = m => ({ id_cliente: m.id_cliente, status: 'duplicado', motivo: null });

// O cliente escolhe a frase por CODIGO (§1.6); o texto vai junto so para
// cliente antigo, que ainda le `motivo`.
const comMotivo = (m, decisao) => ({
  id_cliente: m.id_cliente, status: decisao.status,
  motivo_codigo: decisao.motivo_codigo, motivo: dominio.FRASES_MOTIVO[decisao.motivo_codigo]
});
