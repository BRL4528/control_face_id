// Fechamento e assinatura da folha de ponto pelo RH.
//
//   { acao: 'fechar', mes, folhas: [{ colaborador_id, conteudo }] }
//        Congela a folha de cada um (conteudo vem de regras.js::folhaDoMes, calculado
//        no painel) e manda para assinatura no app. Folha já assinada não é
//        sobrescrita; aguardando ou contestada é substituída pelo conteúdo novo.
//   { acao: 'listar', mes }  → situação e conteúdo congelado de cada folha do mês (sem a foto)
import { db, novoId } from '../_lib/db.js';
import { autenticarRh } from '../_lib/auth.js';
import { hashDaFolha } from '../_lib/folha.js';
import { cors, ok, erro, corpo, exigeMetodo } from '../_lib/http.js';

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (exigeMetodo(req, res, 'POST')) return;
  const rh = autenticarRh(req);
  if (!rh) return erro(res, 401, 'SESSAO_INVALIDA', 'faça login novamente');
  const b = corpo(req);
  if (!MES.test(b.mes || '')) return erro(res, 400, 'CORPO_INVALIDO', 'mes (YYYY-MM) obrigatório');
  const sql = db();

  if (b.acao === 'listar') {
    const folhas = await sql`
      SELECT f.id, f.colaborador_id, f.estado, f.hash, f.fechada_em, f.respondida_em, f.contestacao,
             f.conteudo, f.assinatura - 'foto' AS assinatura
      FROM folha_assinatura f
      WHERE f.empresa_id=${rh.empresa_id} AND f.mes=${b.mes}`;
    return ok(res, { mes: b.mes, folhas });
  }

  if (b.acao !== 'fechar') return erro(res, 400, 'CORPO_INVALIDO', 'acao inválida');
  const lista = Array.isArray(b.folhas) ? b.folhas.slice(0, 500) : [];
  if (!lista.length) return erro(res, 400, 'CORPO_INVALIDO', 'nenhuma folha');
  const ids = [...new Set(lista.map(f => String(f.colaborador_id || '')))];
  const validos = new Set((await sql`SELECT id FROM colaborador WHERE empresa_id=${rh.empresa_id} AND id = ANY(${ids})`).map(r => r.id));

  let enviadas = 0, ja_assinadas = 0;
  for (const f of lista) {
    if (!validos.has(f.colaborador_id) || !f.conteudo || typeof f.conteudo !== 'object') continue;
    const conteudo = Object.assign({}, f.conteudo, { mes: b.mes });
    const hash = hashDaFolha(conteudo);
    const r = await sql`
      INSERT INTO folha_assinatura (id, empresa_id, colaborador_id, mes, conteudo, hash, fechada_por)
      VALUES (${novoId()}, ${rh.empresa_id}, ${f.colaborador_id}, ${b.mes}, ${JSON.stringify(conteudo)}::jsonb, ${hash}, ${rh.sub})
      ON CONFLICT (empresa_id, colaborador_id, mes) DO UPDATE SET
        conteudo=EXCLUDED.conteudo, hash=EXCLUDED.hash, estado='aguardando', fechada_em=now(),
        fechada_por=EXCLUDED.fechada_por, respondida_em=NULL, assinatura=NULL, contestacao=NULL
      WHERE folha_assinatura.estado <> 'assinada'
      RETURNING id`;
    if (r.length) enviadas++; else ja_assinadas++;
  }
  return ok(res, { mes: b.mes, enviadas, ja_assinadas });
}
