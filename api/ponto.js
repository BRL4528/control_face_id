// Recebe o lote de marcações da fila offline do celular e grava no livro.
// Espelha as garantias do piloto, agora com o banco como autoridade:
//
//   • Deduplicação REAL: id_cliente é PRIMARY KEY. ON CONFLICT DO NOTHING —
//     reenvio após timeout devolve 'duplicado', nunca dobra o ponto. (O n8n não
//     tinha índice único; aqui tem.)
//   • A CERCA é reconferida no servidor. O cliente informa lat/lng; nós medimos
//     contra a cerca do dia — a escala se houver, senão o local da equipe
//     (cercaVigente). Fora da cerca → grava e marca para revisão (nunca nega:
//     pode ser GPS ruim, e o ponto jamais é negado por técnica).
//   • Vai para revisão quando: veredito != aceito, origem manual, fora da cerca,
//     sem cerca nenhuma, relógio > 2 min fora, ou horário mais de 5 min à frente
//     do servidor (regra em precisaRevisao). A prova de vida reprovada sozinha não
//     manda para o RH: fica gravada (liveness_ok=false + diagnóstico no motivo).
//   • Item inválido (data, tipo, coordenadas) volta 'rejeitado' sem derrubar o lote.
//   • A foto de auditoria só se guarda quando a marcação vai para revisão.
import { db } from './_lib/db.js';
import { autenticarDispositivo } from './_lib/auth.js';
import { dentroDaCerca } from './_lib/geo.js';
import { cercaVigente } from './_lib/escala.js';
import { ocorrenciaVigente, rotuloEmFrase } from './_lib/ocorrencia.js';
import { normalizarBatida, motivoDaBatida, precisaRevisao } from './_lib/batida.js';
import { cors, ok, erro, corpo, exigeMetodo } from './_lib/http.js';
import { guardarMiniatura } from './_lib/blob.js';
import { diaNoFuso, fusoDaEmpresa } from './_lib/dia.js';
import { configGestorQualquerCerca, perimetroDoPonto } from './_lib/cerca-gestor.js';


export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (exigeMetodo(req, res, 'POST')) return;

  const vinc = await autenticarDispositivo(req);
  if (!vinc) return erro(res, 401, 'CREDENCIAL_INVALIDA', 'dispositivo não autenticado');
  if (vinc.bloqueado) return erro(res, 403, 'BLOQUEADO', 'este aparelho foi bloqueado pelo RH');

  const marcacoes = corpo(req).marcacoes;
  if (!Array.isArray(marcacoes) || !marcacoes.length) {
    return erro(res, 400, 'CORPO_INVALIDO', 'lista de marcações vazia');
  }

  const sql = db();
  const fuso = await fusoDaEmpresa(sql, vinc.empresa_id);
  let gestorLivre = null;   // parâmetro lido sob demanda (só gestor precisa)
  const resultados = [];
  let aceitas = 0, duplicadas = 0, emRevisao = 0;
  await sql`UPDATE dispositivo SET visto_em=now() WHERE id=${vinc.dispositivo_id}`;

  // Cada item é conferido e gravado sozinho: um item inválido (ou que falhe ao
  // gravar) volta 'rejeitado' e não derruba o resto do lote.
  const rejeitar = (id, motivo) => resultados.push({ id_cliente: typeof id === 'string' ? id : null, status: 'rejeitado', motivo });

  // ---- aparelho PENDENTE (link da empresa, RH ainda não identificou) ----
  // Grava a marcação SEM colaborador, amarrada ao aparelho, sempre em revisão.
  // A 1ª marcação traz o cadastro facial (vetores + miniatura) que vira template
  // quando o RH identificar a pessoa. Nunca nega: a pessoa bateu, o RH resolve.
  if (vinc.estado === 'pendente') {
    for (const bruto of marcacoes.slice(0, 100)) {
      const v = normalizarBatida(bruto);
      if (v.erro) { rejeitar(bruto && bruto.id_cliente, v.erro); continue; }
      const m = v.item;
      try {
        const dia = diaNoFuso(m.marcado_em, fuso);   // o servidor decide o dia; o do cliente é ignorado
        if (bruto.cadastro && Array.isArray(bruto.cadastro.vetores) && bruto.cadastro.vetores.length) {
          const temCad = await sql`SELECT 1 FROM dispositivo WHERE id=${vinc.dispositivo_id} AND cadastro IS NOT NULL LIMIT 1`;
          if (!temCad[0]) {
            const url = await guardarMiniatura(bruto.cadastro.miniatura || m.foto_url, 'aparelho-' + vinc.dispositivo_id);
            await sql`UPDATE dispositivo SET cadastro=${JSON.stringify({ vetores: bruto.cadastro.vetores, miniatura_url: url })} WHERE id=${vinc.dispositivo_id}`;
          }
        }
        const foto = await guardarMiniatura(m.foto_url, 'marc-' + m.id_cliente);
        const ins = await sql`
          INSERT INTO marcacao (id_cliente, empresa_id, colaborador_id, dispositivo_id, equipe_id, tipo, origem, veredito,
            score, liveness_ok, motivo, marcado_em, marcado_dia, deriva_ms, lat, lng, precisao_m,
            dentro_cerca, distancia_cerca_m, foto_url, requer_revisao)
          VALUES (${m.id_cliente}, ${vinc.empresa_id}, NULL, ${vinc.dispositivo_id}, NULL, ${m.tipo}, 'biometria', 'revisar',
            NULL, ${m.liveness_ok}, 'aparelho_nao_identificado', ${m.marcado_em}, ${dia}, ${m.deriva_ms},
            ${m.lat}, ${m.lng}, ${m.precisao_m}, NULL, NULL, ${foto}, true)
          ON CONFLICT (id_cliente) DO NOTHING RETURNING id_cliente`;
        if (!ins.length) { duplicadas++; resultados.push({ id_cliente: m.id_cliente, status: 'duplicado' }); }
        else { emRevisao++; resultados.push({ id_cliente: m.id_cliente, status: 'aceito', revisao: true, pendente_identificacao: true }); }
      } catch (e) {
        console.error('[ponto] pendente', m.id_cliente, e && e.message);
        rejeitar(m.id_cliente, 'erro ao gravar');
      }
    }
    return ok(res, { servidor_hora: new Date().toISOString(), estado: 'pendente',
                     resumo: { aceitas, duplicadas, em_revisao: emRevisao }, resultados });
  }

  // Equipe que o app informa só vale se for da empresa do aparelho (cache por lote).
  const equipesConferidas = new Map();
  const equipeDaEmpresa = async id => {
    if (!id) return null;
    if (!equipesConferidas.has(id)) {
      const r = await sql`SELECT id FROM equipe WHERE id=${id} AND empresa_id=${vinc.empresa_id} AND ativo=true LIMIT 1`;
      equipesConferidas.set(id, r[0] ? r[0].id : null);
    }
    return equipesConferidas.get(id);
  };

  for (const bruto of marcacoes.slice(0, 100)) {
    const v = normalizarBatida(bruto);
    if (v.erro) { rejeitar(bruto && bruto.id_cliente, v.erro); continue; }
    const m = v.item;
    try {
      // A marcação é SEMPRE do dono do dispositivo — o cliente não escolhe pessoa.
      const colaboradorId = vinc.colaborador_id;
      const dia = diaNoFuso(m.marcado_em, fuso);   // o servidor decide o dia; o do cliente é ignorado

      // Cerca do dia: escala/ajuste se houver, senão o local da equipe.
      const aloc = await cercaVigente(sql, vinc.empresa_id, colaboradorId, dia);
      const temCerca = !!(aloc && aloc.cerca_lat != null);
      let cerca = temCerca ? dentroDaCerca(aloc, m.lat, m.lng, m.precisao_m) : { dentro: null, distancia_m: null };

      // Gestor em visita: vale qualquer perímetro da empresa (parâmetro gestorQualquerCerca).
      let visitado = null;
      if (vinc.papel === 'gestor' && cerca.dentro !== true && m.lat != null) {
        if (gestorLivre === null) gestorLivre = await configGestorQualquerCerca(sql, vinc.empresa_id);
        if (gestorLivre) {
          visitado = await perimetroDoPonto(sql, vinc.empresa_id, dia, m.lat, m.lng, m.precisao_m);
          if (visitado) cerca = { dentro: true, distancia_m: visitado.distancia_m };
        }
      }

      // Viagem / trabalho externo: a batida vale fora da cerca. Férias, afastamento,
      // licença: não deveria bater (o app bloqueia); se chegar, vai para o RH.
      const oc = await ocorrenciaVigente(sql, vinc.empresa_id, colaboradorId, dia);
      const externo = !!(oc && oc.semCerca) && cerca.dentro !== true;
      if (externo) cerca = { dentro: true, distancia_m: cerca.distancia_m };

      // Relógio do celular: a deriva informada pelo app e, independente dela, o
      // instante comparado com o relógio do servidor (futuro além de 5 min = revisão,
      // para não aceitar batida de um dia que ainda não chegou). Antiga continua valendo.
      const revisar = precisaRevisao({
        veredito: m.veredito, origem: m.origem, temCerca: temCerca || !!visitado || externo, dentro: cerca.dentro,
        deriva_ms: m.deriva_ms, futuro: m.futuro,
        bloqueado: !!(aloc && aloc.afastado) || !!(oc && oc.bloqueia)   // afastado não bate; se chegar (fila offline), o RH decide
      });

      // O servidor é a autoridade da equipe; a do app só entra se for da empresa.
      const equipeId = (aloc && aloc.equipe_id) || await equipeDaEmpresa(m.equipe_id);
      const motivo = motivoDaBatida({
        afastado: !!(aloc && aloc.afastado),
        bloqueio: oc && oc.bloqueia ? rotuloEmFrase(oc.rotulo) : null,
        futuro: m.futuro,
        externo,
        visitado: visitado && visitado.nome,
        cliente: m.motivo
      });

      const inseridas = await sql`
        INSERT INTO marcacao (
          id_cliente, empresa_id, colaborador_id, dispositivo_id, equipe_id, tipo, origem, veredito,
          score, liveness_ok, motivo, marcado_em, marcado_dia, deriva_ms,
          lat, lng, precisao_m, dentro_cerca, distancia_cerca_m, foto_url, requer_revisao
        ) VALUES (
          ${m.id_cliente}, ${vinc.empresa_id}, ${colaboradorId}, ${vinc.dispositivo_id}, ${equipeId},
          ${m.tipo}, ${m.origem}, ${revisar ? 'revisar' : 'aceito'},
          ${m.score}, ${m.liveness_ok}, ${motivo},
          ${m.marcado_em}, ${dia}, ${m.deriva_ms},
          ${m.lat}, ${m.lng}, ${m.precisao_m},
          ${cerca.dentro}, ${cerca.distancia_m}, ${revisar ? m.foto_url : null}, ${revisar}
        )
        ON CONFLICT (id_cliente) DO NOTHING
        RETURNING id_cliente`;

      if (!inseridas.length) {
        duplicadas++;
        resultados.push({ id_cliente: m.id_cliente, status: 'duplicado' });
      } else if (revisar) {
        emRevisao++;
        await guardarVetor(sql, vinc.empresa_id, colaboradorId, m);
        resultados.push({ id_cliente: m.id_cliente, status: 'aceito', revisao: true });
      } else {
        aceitas++;
        resultados.push({ id_cliente: m.id_cliente, status: 'aceito' });
      }
    } catch (e) {
      console.error('[ponto]', m.id_cliente, e && e.message);
      rejeitar(m.id_cliente, 'erro ao gravar');
    }
  }

  return ok(res, {
    servidor_hora: new Date().toISOString(),
    resumo: { aceitas, duplicadas, em_revisao: emRevisao },
    resultados
  });
}

// Vetor do rosto da batida na zona cinzenta, para o RH reforçar o cadastro ao
// aprovar. Fica fora da marcação (livro imutável) e nunca derruba a batida: tabela
// ausente (migração pendente) ou falha só deixam a batida sem o reforço.
async function guardarVetor(sql, empresaId, colaboradorId, m) {
  if (!m.descritor || !colaboradorId) return;
  try {
    await sql`INSERT INTO marcacao_descritor (id_cliente, empresa_id, colaborador_id, vetor)
              VALUES (${m.id_cliente}, ${empresaId}, ${colaboradorId}, ${JSON.stringify(m.descritor)})
              ON CONFLICT (id_cliente) DO NOTHING`;
  } catch (e) { console.warn('[ponto] vetor da batida não guardado:', e && e.message); }
}
