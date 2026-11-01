// Carga do dia para o celular do colaborador. Diferente do piloto: não baixa a
// equipe inteira (não há galeria 1:N). Baixa só o que ESTE colaborador precisa
// para bater o próprio ponto offline:
//
//   • o template facial ativo dele (vetores) — para o match 1:1 no aparelho;
//   • a cerca de hoje: equipe + centro/raio — para checar o GPS. Vem da escala
//     do dia se houver; senão do LOCAL da equipe (o caso comum, equipe = obra).
//
// servidor_hora vai junto para o cliente medir a deriva do relógio. Se nem a
// equipe tem local, o app ainda deixa bater ponto, mas a marcação vai sem cerca
// e cai em revisão do RH — o ponto nunca é negado por falta de cerca.
//
// `afastado`: a pessoa está numa equipe de afastamento (INSS, licença). O app
// mostra o aviso e não abre a câmera.
//
// `marcacoes_hoje`: as batidas do colaborador no dia já gravadas no servidor (sem
// as anuladas pelo RH). Celular novo ou trocado não tem o histórico local; sem
// isso sugeria "Entrada" de novo e não respeitava o intervalo entre batidas.
//
// Aparelho PENDENTE nunca recebe template nem batidas de ninguém: ele ainda não
// tem dono confirmado pelo RH (inclusive quando informou uma matrícula).
import { db } from './_lib/db.js';
import { cercaVigente } from './_lib/escala.js';
import { ocorrenciaVigente } from './_lib/ocorrencia.js';
import { autenticarDispositivo } from './_lib/auth.js';
import { diaNoFuso, fusoDaEmpresa } from './_lib/dia.js';
import { cors, ok, erro, corpo, exigeMetodo } from './_lib/http.js';
import { diaValido } from './_lib/data-real.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (exigeMetodo(req, res, 'POST')) return;

  const vinc = await autenticarDispositivo(req);
  if (!vinc) return erro(res, 401, 'CREDENCIAL_INVALIDA', 'dispositivo não autenticado');
  // Bloqueado (saiu da empresa / RH rejeitou): 403 explícito — o app trava a tela
  // e para de sincronizar, em vez de ficar tentando para sempre.
  if (vinc.bloqueado) return erro(res, 403, 'BLOQUEADO', 'este aparelho foi bloqueado pelo RH');

  const sql = db();
  const fuso = await fusoDaEmpresa(sql, vinc.empresa_id);
  const dia = String(corpo(req).dia || diaNoFuso(new Date(), fuso));
  if (!diaValido(dia)) return erro(res, 400, 'CORPO_INVALIDO', 'data inválida');
  await sql`UPDATE dispositivo SET visto_em=now() WHERE id=${vinc.dispositivo_id}`;

  // Pendente: ainda sem colaborador. O app segue batendo (as marcações ficam
  // para o RH identificar); não há template nem alocação para mandar.
  if (vinc.estado === 'pendente') {
    return ok(res, { estado: 'pendente', colaborador: null, template: null, alocacao: null, marcacoes_hoje: [],
                     matricula_informada: vinc.matricula_informada || null, servidor_hora: new Date().toISOString(), fuso });
  }

  const templates = await sql`
    SELECT versao, vetores FROM template_facial
    WHERE colaborador_id = ${vinc.colaborador_id} AND estado = 'ativo'
    ORDER BY versao DESC LIMIT 1`;

  const a = await cercaVigente(sql, vinc.empresa_id, vinc.colaborador_id, dia);
  // Férias, afastamento, licença: o app avisa e não abre a câmera.
  const oc = await ocorrenciaVigente(sql, vinc.empresa_id, vinc.colaborador_id, dia);
  const bloqueio = oc && oc.bloqueia ? oc : null;
  const t = templates[0];

  // Batidas do dia já no servidor (de qualquer aparelho da pessoa), sem anuladas.
  const doDia = await sql`
    SELECT m.id_cliente, m.tipo, m.marcado_em, to_char(m.marcado_dia,'YYYY-MM-DD') AS marcado_dia
    FROM marcacao m
    WHERE m.empresa_id = ${vinc.empresa_id} AND m.colaborador_id = ${vinc.colaborador_id} AND m.marcado_dia = ${dia}
      AND NOT EXISTS (SELECT 1 FROM correcao co WHERE co.alvo_tipo='marcacao' AND co.alvo_id=m.id_cliente AND co.acao='rejeitar')
    ORDER BY m.marcado_em
    LIMIT 50`;
  const marcacoesHoje = doDia.map(m => ({
    id_cliente: m.id_cliente, tipo: m.tipo, marcado_em: new Date(m.marcado_em).toISOString(),
    marcado_dia: m.marcado_dia, pessoa_id: vinc.colaborador_id
  }));
  return ok(res, {
    estado: 'ativo',
    colaborador: { id: vinc.colaborador_id, nome: vinc.nome, papel: vinc.papel },
    template: t ? { versao: t.versao, vetores: t.vetores } : null,
    afastado: !!(a && a.afastado) || !!bloqueio,   // equipe de afastamento ou ocorrência que bloqueia: o app não deixa bater
    afastado_msg: bloqueio
      ? 'Você está em ' + bloqueio.rotulo.toLowerCase() + (bloqueio.fim ? ' até ' + bloqueio.fim.slice(8, 10) + '/' + bloqueio.fim.slice(5, 7) : '') + ' e não precisa registrar ponto.'
      : null,
    alocacao: (a && a.cerca_lat != null) ? {
      equipe_id: a.equipe_id, equipe_nome: a.equipe_nome, cerca_origem: a.cerca_origem,
      cerca: { lat: a.cerca_lat, lng: a.cerca_lng, raio_m: a.cerca_raio_m }
    } : null,
    marcacoes_hoje: marcacoesHoje,
    servidor_hora: new Date().toISOString(),
    fuso
  });
}
