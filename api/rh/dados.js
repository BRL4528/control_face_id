// Painel do RH numa chamada: equipes, colaboradores, marcações do período,
// alocações de hoje e pendências. Os indicadores e o espelho de ponto são
// calculados no cliente (js/regras.js), como no piloto — as mesmas funções que
// os testes de unidade cobrem.
import { db } from '../_lib/db.js';
import { autenticarRh } from '../_lib/auth.js';
import { acessoDe } from '../_lib/acesso.js';
import { pode, obrasDe, perfilDe, PERFIS } from '../../js/acessos.js';
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
  const acesso = await acessoDe(sql, rh);
  if (!acesso) return erro(res, 401, 'SESSAO_INVALIDA', 'faça login novamente');

  const [equipes, pessoas, marcacoes, alocacoes, locais, jornadas, empresaRow, configRow, usuariosRh, correcoes, planos, aparelhosPendentes, papeis, ocorrencias] = await Promise.all([
    sql`SELECT id AS equipe_id, nome, ativo, jornada_id, supervisor_id, local_id, bitrix_stage_id, afastamento FROM equipe WHERE empresa_id = ${empresa} ORDER BY nome`,
    sql`SELECT c.id AS pessoa_id, c.nome, c.matricula, c.papel, c.equipe_padrao AS equipe_id, c.ativo, c.bitrix_contact_id,
               to_char(c.criado_em,'YYYY-MM-DD') AS desde,
               EXISTS(SELECT 1 FROM template_facial t WHERE t.colaborador_id = c.id AND t.estado='ativo') AS tem_biometria,
               (SELECT miniatura_url FROM template_facial t WHERE t.colaborador_id=c.id AND t.estado='ativo' ORDER BY versao DESC LIMIT 1) AS miniatura
        FROM colaborador c WHERE c.empresa_id = ${empresa} ORDER BY c.nome`,
    sql`SELECT m.id_cliente, m.colaborador_id AS pessoa_id, m.equipe_id, m.tipo, m.origem, m.veredito,
               m.marcado_em, to_char(m.marcado_dia,'YYYY-MM-DD') AS marcado_dia, m.deriva_ms AS deriva_relogio_ms, m.dentro_cerca,
               m.distancia_cerca_m, m.lat, m.lng, m.foto_url AS foto_auditoria, m.requer_revisao, m.score, m.liveness_ok,
               (m.requer_revisao AND NOT EXISTS(
                  SELECT 1 FROM correcao co WHERE co.alvo_tipo='marcacao' AND co.alvo_id=m.id_cliente)) AS pendente,
               EXISTS(SELECT 1 FROM correcao co WHERE co.alvo_tipo='marcacao' AND co.alvo_id=m.id_cliente AND co.acao='rejeitar') AS anulada,
               m.motivo
        FROM marcacao m
        WHERE m.empresa_id = ${empresa} AND m.colaborador_id IS NOT NULL
          AND m.marcado_dia >= (CURRENT_DATE - ${dias}::int)
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
               tolerancia_min, intervalo_min, dias, ativa FROM jornada WHERE empresa_id = ${empresa} ORDER BY nome`,
    sql`SELECT nome, fuso, link_token, (integracao_token_hash IS NOT NULL) AS integracao_ativa FROM empresa WHERE id = ${empresa} LIMIT 1`,
    sql`SELECT dados FROM config_empresa WHERE empresa_id = ${empresa} LIMIT 1`,
    sql`SELECT id AS usuario_id, usuario, nome, ativo, trocar_senha, to_jsonb(u)->>'perfil' AS perfil, to_jsonb(u)->'obras' AS obras,
               to_char(criado_em,'YYYY-MM-DD') AS criado_em FROM usuario_rh u
        WHERE empresa_id = ${empresa} ORDER BY usuario`,
    // Trilha de auditoria: decisões do RH, com nome de quem decidiu e da pessoa alvo.
    sql`SELECT co.id, co.alvo_tipo, co.alvo_id, co.acao, co.motivo, co.criada_em,
               u.nome AS usuario_rh_nome, u.usuario AS usuario_rh_login,
               c.nome AS pessoa_nome, m.origem AS marcacao_origem
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
        FROM plano_alocacao WHERE empresa_id = ${empresa} AND ativo = true ORDER BY criado_em DESC`,
    // Aparelhos que bateram ponto pelo link da empresa e o RH ainda não identificou,
    // com as marcações deles (sem colaborador) para o RH ver hora, GPS e foto.
    sql`SELECT d.id AS dispositivo_id, d.matricula_informada, d.ua, d.pareado_em, d.visto_em,
               d.cadastro->>'miniatura_url' AS miniatura,
               COALESCE((SELECT json_agg(json_build_object(
                   'id_cliente', m.id_cliente, 'tipo', m.tipo, 'marcado_em', m.marcado_em,
                   'marcado_dia', to_char(m.marcado_dia,'YYYY-MM-DD'), 'lat', m.lat, 'lng', m.lng,
                   'precisao_m', m.precisao_m, 'liveness_ok', m.liveness_ok, 'foto_url', m.foto_url)
                 ORDER BY m.marcado_em DESC)
                 FROM marcacao m WHERE m.dispositivo_id = d.id AND m.colaborador_id IS NULL AND m.requer_revisao
                   AND NOT EXISTS (SELECT 1 FROM correcao co WHERE co.alvo_tipo='marcacao' AND co.alvo_id=m.id_cliente)), '[]'::json) AS marcacoes
        FROM dispositivo d
        WHERE d.empresa_id = ${empresa} AND d.estado = 'pendente' AND d.ativo = true
        ORDER BY d.pareado_em DESC`,
    // Papéis personalizados + quantos colaboradores usam cada um.
    sql`SELECT p.id, p.nome, p.ativo, (SELECT count(*)::int FROM colaborador c WHERE c.empresa_id = p.empresa_id AND c.papel = p.id) AS em_uso
        FROM papel p WHERE p.empresa_id = ${empresa} ORDER BY lower(p.nome)`,
    // Ocorrências que tocam o período (ou em aberto) e as pendentes; a foto vem à parte.
    sql`SELECT id, colaborador_id, tipo, to_char(inicio,'YYYY-MM-DD') AS inicio, to_char(fim,'YYYY-MM-DD') AS fim,
               observacao, estado, origem, (anexo IS NOT NULL) AS tem_anexo, criada_em
        FROM ocorrencia
        WHERE empresa_id = ${empresa} AND estado <> 'cancelada'
          AND (estado = 'pendente' OR fim IS NULL OR fim >= (CURRENT_DATE - ${dias}::int - 31))
        ORDER BY inicio DESC LIMIT 2000`
  ]);

  // "Hoje" no fuso da EMPRESA, não em UTC: às 21h em Campo Grande já é amanhã em
  // UTC e o painel inteiro (cercas do dia, exceções, mapa) mudaria de dia às 20h.
  const fuso = (empresaRow[0] && empresaRow[0].fuso) || 'America/Campo_Grande';
  const hoje = diaNoFuso(new Date(), fuso);
  // a.dia já vem 'YYYY-MM-DD' (to_char); antes era Date e String(Date).slice(0,10)
  // dava "Tue Sep 08" — a lista de hoje saía sempre vazia (mapa sem cercas).
  // Perfil por obra (gestor de obra): o painel inteiro recorta para as obras dele.
  const obras = obrasDe(acesso);
  let eqs = equipes, pes = pessoas, mar = marcacoes, alo = alocacoes, ocs = ocorrencias, pla = planos;
  if (obras) {
    const ok_ = new Set(obras);
    eqs = equipes.filter(e => ok_.has(e.equipe_id));
    pes = pessoas.filter(p => ok_.has(p.equipe_id));
    const ids = new Set(pes.map(p => p.pessoa_id));
    mar = marcacoes.filter(m => ids.has(m.pessoa_id));
    alo = alocacoes.filter(a => ids.has(a.colaborador_id));
    ocs = ocorrencias.filter(o => ids.has(o.colaborador_id));
    pla = planos.filter(p => ok_.has(p.equipe_id));
  }
  const alocacoesHoje = alo.filter(a => a.dia === hoje);
  const verConfig = pode(acesso, 'config');

  return ok(res, {
    usuario: { id: rh.sub, nome: rh.nome, usuario: rh.usuario },
    empresa_id: empresa,   // o app do colaborador usa como "código da empresa" no pareamento
    empresa: empresaRow[0] || { nome: '', fuso: 'America/Campo_Grande', link_token: null },
    aparelhos_pendentes: obras || !pode(acesso, 'ponto', true) ? [] : aparelhosPendentes,
    acesso: { perfil: perfilDe(acesso), rotulo: PERFIS[perfilDe(acesso)].rotulo, obras },
    config: (configRow[0] && configRow[0].dados) || {},
    periodo_dias: dias,
    servidor_hora: new Date().toISOString(),
    hoje,                     // 'YYYY-MM-DD' no fuso da empresa — o front usa este, não o UTC
    equipes: eqs, pessoas: pes, marcacoes: mar, locais, jornadas, planos: pla, papeis, ocorrencias: ocs,
    usuarios_rh: verConfig ? usuariosRh : [], correcoes: verConfig ? correcoes : [],
    alocacoes: alo,            // janela ontem..+30 (tabs de dia + alertas de planejamento)
    alocacoes_hoje: alocacoesHoje,
    recadastros: []  // recadastro pendente entra quando o autocadastro do gestor existir
  });
}
