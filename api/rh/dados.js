// Painel do RH numa chamada: equipes, colaboradores, marcações do período,
// alocações de hoje e pendências. Os indicadores e o espelho de ponto são
// calculados no cliente (js/regras.js), como no piloto — as mesmas funções que
// os testes de unidade cobrem.
import { db } from '../_lib/db.js';
import { autenticarRh } from '../_lib/auth.js';
import { cors, ok, erro, exigeMetodo } from '../_lib/http.js';

function diaNoFuso(d, fuso) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); }
  catch { return d.toISOString().slice(0, 10); }
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (exigeMetodo(req, res, 'POST')) return;

  const rh = autenticarRh(req);
  if (!rh) return erro(res, 401, 'SESSAO_INVALIDA', 'faça login novamente');

  const dias = Math.min(Math.max(Number((req.body || {}).dias) || 30, 1), 365);
  const empresa = rh.empresa_id;
  const sql = db();

  const [equipes, pessoas, marcacoes, alocacoes, locais, jornadas, empresaRow, configRow, usuariosRh, correcoes, planos] = await Promise.all([
    sql`SELECT id AS equipe_id, nome, ativo, jornada_id, supervisor_id FROM equipe WHERE empresa_id = ${empresa} ORDER BY nome`,
    sql`SELECT c.id AS pessoa_id, c.nome, c.matricula, c.papel, c.equipe_padrao AS equipe_id, c.ativo,
               EXISTS(SELECT 1 FROM template_facial t WHERE t.colaborador_id = c.id AND t.estado='ativo') AS tem_biometria,
               (SELECT miniatura_url FROM template_facial t WHERE t.colaborador_id=c.id AND t.estado='ativo' ORDER BY versao DESC LIMIT 1) AS miniatura
        FROM colaborador c WHERE c.empresa_id = ${empresa} ORDER BY c.nome`,
    sql`SELECT m.id_cliente, m.colaborador_id AS pessoa_id, m.equipe_id, m.tipo, m.origem, m.veredito,
               m.marcado_em, to_char(m.marcado_dia,'YYYY-MM-DD') AS marcado_dia, m.deriva_ms AS deriva_relogio_ms, m.dentro_cerca,
               m.distancia_cerca_m, m.lat, m.lng, m.foto_url AS foto_auditoria, m.requer_revisao, m.score,
               (m.requer_revisao AND NOT EXISTS(
                  SELECT 1 FROM correcao co WHERE co.alvo_tipo='marcacao' AND co.alvo_id=m.id_cliente)) AS pendente
        FROM marcacao m
        WHERE m.empresa_id = ${empresa} AND m.marcado_dia >= (CURRENT_DATE - ${dias}::int)
        ORDER BY m.marcado_em DESC`,
    // Alocações de uma janela em torno de hoje (ontem..+30): cobre as tabs de dia
    // e os alertas de planejamento (pessoa em 2 equipes, sem plano futuro).
    sql`SELECT to_char(a.dia,'YYYY-MM-DD') AS dia, a.colaborador_id, a.equipe_id, a.cerca_lat, a.cerca_lng, a.cerca_raio_m,
               a.origem, a.plano_id
        FROM alocacao a
        WHERE a.empresa_id = ${empresa} AND a.dia BETWEEN (CURRENT_DATE - 1) AND (CURRENT_DATE + 30)`,
    sql`SELECT id AS local_id, nome, lat, lng, raio_m FROM local
        WHERE empresa_id = ${empresa} AND ativo = true ORDER BY nome`,
    sql`SELECT id AS jornada_id, nome, to_char(entrada,'HH24:MI') AS entrada, to_char(saida,'HH24:MI') AS saida,
               tolerancia_min, ativa FROM jornada WHERE empresa_id = ${empresa} ORDER BY nome`,
    sql`SELECT nome, fuso FROM empresa WHERE id = ${empresa} LIMIT 1`,
    sql`SELECT dados FROM config_empresa WHERE empresa_id = ${empresa} LIMIT 1`,
    sql`SELECT id AS usuario_id, usuario, nome, ativo, trocar_senha,
               to_char(criado_em,'YYYY-MM-DD') AS criado_em FROM usuario_rh
        WHERE empresa_id = ${empresa} ORDER BY usuario`,
    // Trilha de auditoria: decisões do RH, com nome de quem decidiu e da pessoa alvo.
    sql`SELECT co.id, co.alvo_tipo, co.alvo_id, co.acao, co.motivo, co.criada_em,
               u.nome AS usuario_rh_nome, u.usuario AS usuario_rh_login,
               c.nome AS pessoa_nome
        FROM correcao co
        LEFT JOIN usuario_rh u ON u.id = co.usuario_rh_id
        LEFT JOIN marcacao m ON (co.alvo_tipo='marcacao' AND m.id_cliente = co.alvo_id)
        LEFT JOIN colaborador c ON c.id = m.colaborador_id
        WHERE co.empresa_id = ${empresa}
        ORDER BY co.criada_em DESC LIMIT 500`,
    // Planos de alocação recorrente ativos (para a aba Planos e os alertas).
    sql`SELECT id AS plano_id, nome, equipe_id, colaboradores, cerca_lat, cerca_lng, cerca_raio_m,
               dias_semana, to_char(vigencia_inicio,'YYYY-MM-DD') AS vigencia_inicio,
               to_char(vigencia_fim,'YYYY-MM-DD') AS vigencia_fim, ativo
        FROM plano_alocacao WHERE empresa_id = ${empresa} AND ativo = true ORDER BY criado_em DESC`
  ]);

  // "Hoje" no fuso da EMPRESA, não em UTC: às 21h em Campo Grande já é amanhã em
  // UTC e o painel inteiro (cercas do dia, exceções, mapa) mudaria de dia às 20h.
  const fuso = (empresaRow[0] && empresaRow[0].fuso) || 'America/Campo_Grande';
  const hoje = diaNoFuso(new Date(), fuso);
  // a.dia já vem 'YYYY-MM-DD' (to_char); antes era Date e String(Date).slice(0,10)
  // dava "Tue Sep 08" — a lista de hoje saía sempre vazia (mapa sem cercas).
  const alocacoesHoje = alocacoes.filter(a => a.dia === hoje);

  return ok(res, {
    usuario: { nome: rh.nome, usuario: rh.usuario },
    empresa_id: empresa,   // o app do colaborador usa como "código da empresa" no pareamento
    empresa: empresaRow[0] || { nome: '', fuso: 'America/Campo_Grande' },
    config: (configRow[0] && configRow[0].dados) || {},
    periodo_dias: dias,
    servidor_hora: new Date().toISOString(),
    hoje,                     // 'YYYY-MM-DD' no fuso da empresa — o front usa este, não o UTC
    equipes, pessoas, marcacoes, locais, jornadas, planos,
    usuarios_rh: usuariosRh, correcoes,
    alocacoes,                 // janela ontem..+30 (tabs de dia + alertas de planejamento)
    alocacoes_hoje: alocacoesHoje,
    recadastros: []  // recadastro pendente entra quando o autocadastro do gestor existir
  });
}
