// Dados brutos para o relatório de horas por colaborador (o cálculo é puro e
// vive em js/regras.js::horasPorColaborador, coberto por testes de unidade).
//   POST { de:'YYYY-MM-DD', ate:'YYYY-MM-DD' }  (máx. 93 dias)
// Devolve as marcações do período já com o estado derivado da última correção
// do RH — 'aceita' | 'pendente' (em revisão, sem decisão) | 'rejeitada' — e as
// alocações do período (definem os dias previstos).
import { db } from '../_lib/db.js';
import { autenticarRh } from '../_lib/auth.js';
import { cors, ok, erro, corpo, exigeMetodo } from '../_lib/http.js';

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DIAS = 93;

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (exigeMetodo(req, res, 'POST')) return;
  const rh = autenticarRh(req);
  if (!rh) return erro(res, 401, 'SESSAO_INVALIDA', 'faça login novamente');

  const b = corpo(req);
  if (!DIA.test(b.de || '') || !DIA.test(b.ate || '')) return erro(res, 400, 'CORPO_INVALIDO', 'de e ate (YYYY-MM-DD) obrigatórios');
  if (b.de > b.ate) return erro(res, 400, 'CORPO_INVALIDO', 'a data inicial vem depois da final');
  if ((Date.parse(b.ate) - Date.parse(b.de)) / 86400000 + 1 > MAX_DIAS) {
    return erro(res, 400, 'PERIODO_LONGO', `período máximo de ${MAX_DIAS} dias`);
  }
  const sql = db();
  const [marcacoes, alocacoes] = await Promise.all([
    sql`SELECT m.colaborador_id AS pessoa_id, m.equipe_id, m.tipo, m.marcado_em,
               to_char(m.marcado_dia,'YYYY-MM-DD') AS marcado_dia,
               CASE
                 WHEN ult.acao = 'rejeitar' THEN 'rejeitada'
                 WHEN m.requer_revisao AND ult.acao IS NULL THEN 'pendente'
                 ELSE 'aceita'
               END AS estado
        FROM marcacao m
        LEFT JOIN LATERAL (
          SELECT co.acao FROM correcao co
          WHERE co.alvo_tipo = 'marcacao' AND co.alvo_id = m.id_cliente AND co.acao IN ('aprovar', 'rejeitar')
          ORDER BY co.criada_em DESC LIMIT 1) ult ON true
        WHERE m.empresa_id = ${rh.empresa_id} AND m.colaborador_id IS NOT NULL
          AND m.marcado_dia BETWEEN ${b.de}::date AND ${b.ate}::date
        ORDER BY m.marcado_em`,
    sql`SELECT to_char(a.dia,'YYYY-MM-DD') AS dia, a.colaborador_id, a.equipe_id
        FROM alocacao a
        WHERE a.empresa_id = ${rh.empresa_id} AND a.dia BETWEEN ${b.de}::date AND ${b.ate}::date`
  ]);
  return ok(res, { de: b.de, ate: b.ate, marcacoes, alocacoes });
}
