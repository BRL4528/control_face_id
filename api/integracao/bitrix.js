// POST /api/integracao/bitrix — recebe do n8n o snapshot do pipeline
// "Gerenciamento de Equipe" e aplica na empresa dona do token (ver
// api/_lib/bitrix.js e docs/INTEGRACAO_BITRIX_GERENCIAMENTO_EQUIPE.md).
//
// Autenticação: `Authorization: Bearer <token de integração>`, gerado pelo RH em
// Configurações (/rh/config acao 'novo_token_integracao'). Só o sha256 fica no
// banco; um token alcança só a própria empresa.
//
// Corpo: { acao:'snapshot', etapas:[{id,nome,ordem,final?,sem_equipe?}],
//          cards:[{id,etapa,fechado,alterado_em,titulo,contato:{id,nome,telefone}}],
//          confirmar_vazio? }
// Resposta: resumo do que mudou + avisos (inconsistências para o RH ver no Bitrix).
import { db } from '../_lib/db.js';
import { hashCredencial } from '../_lib/auth.js';
import { cors, ok, erro, corpo, exigeMetodo } from '../_lib/http.js';
import { normalizarSnapshot, aplicarSnapshot, SnapshotInvalido } from '../_lib/bitrix.js';

function diaNoFuso(d, fuso) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); }
  catch { return d.toISOString().slice(0, 10); }
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (exigeMetodo(req, res, 'POST')) return;

  const a = String(req.headers.authorization || '');
  const token = a.startsWith('Bearer ') ? a.slice(7) : '';
  if (!token) return erro(res, 401, 'NAO_AUTORIZADO', 'token de integração ausente');
  const sql = db();
  const emp = await sql`SELECT id, fuso FROM empresa WHERE integracao_token_hash=${hashCredencial(token)} LIMIT 1`;
  if (!emp[0]) return erro(res, 401, 'NAO_AUTORIZADO', 'token de integração inválido');
  const empresaId = emp[0].id;

  const b = corpo(req);
  if (b.acao !== 'snapshot') return erro(res, 400, 'CORPO_INVALIDO', "acao deve ser 'snapshot'");

  const hoje = diaNoFuso(new Date(), emp[0].fuso || 'America/Campo_Grande');
  let resultado;
  try {
    const snap = normalizarSnapshot(b);
    resultado = await aplicarSnapshot(sql, empresaId, snap, hoje, { confirmarVazio: b.confirmar_vazio === true });
  } catch (e) {
    if (e instanceof SnapshotInvalido) return erro(res, e.codigo === 'SNAPSHOT_VAZIO' ? 409 : 400, e.codigo, e.message);
    throw e;
  }

  // Estado da última sincronização para a tela Configurações (merge no jsonb;
  // os parâmetros anti-fraude que já estão lá ficam intactos).
  const estado = { integracao_bitrix: { ultima_sync: new Date().toISOString(), origem: 'bitrix', resumo: {
    equipes: resultado.equipes, colaboradores: resultado.colaboradores,
    planos_ajustados: resultado.planos_ajustados, cards_abertos: resultado.cards_abertos
  }, avisos: resultado.avisos.slice(0, 50) } };
  await sql`
    INSERT INTO config_empresa (empresa_id, dados, atualizada_em)
    VALUES (${empresaId}, ${JSON.stringify(estado)}, now())
    ON CONFLICT (empresa_id) DO UPDATE SET dados = config_empresa.dados || EXCLUDED.dados, atualizada_em=now()`;

  return ok(res, resultado);
}
