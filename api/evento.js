// Advertência/notificação no app do colaborador: ver e dar ciência pelo rosto
// (mesma captura 1:1 + prova de vida da batida). Ciência não é concordância.
//
//   { acao: 'listar' }          → aguardando ciência (com a foto do documento)
//   { acao: 'ciente', id, prova }
import { db } from './_lib/db.js';
import { autenticarDispositivo } from './_lib/auth.js';
import { comTabelaNova } from './_lib/tabela-nova.js';
import { cors, ok, erro, corpo, exigeMetodo } from './_lib/http.js';

const num = v => (v == null || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);
const TERMO_CIENCIA = 'Declaro que recebi e li este documento. Dar ciência não significa concordar com o conteúdo.';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (exigeMetodo(req, res, 'POST')) return;
  const vinc = await autenticarDispositivo(req);
  if (!vinc) return erro(res, 401, 'CREDENCIAL_INVALIDA', 'dispositivo não autenticado');
  if (vinc.bloqueado) return erro(res, 403, 'BLOQUEADO', 'este aparelho foi bloqueado pelo RH');
  if (!vinc.colaborador_id) return erro(res, 403, 'SEM_COLABORADOR', 'cadastro ainda não confirmado pelo RH');
  const b = corpo(req);
  const sql = db();

  return comTabelaNova(res, async () => {
    if (!b.acao || b.acao === 'listar') {
      const eventos = await sql`
        SELECT e.id, e.tipo, to_char(e.data,'YYYY-MM-DD') AS data, e.descricao, e.anexo, q.nome AS obra
        FROM evento e LEFT JOIN equipe q ON q.id = e.equipe_id
        WHERE e.colaborador_id=${vinc.colaborador_id} AND e.empresa_id=${vinc.empresa_id} AND e.estado='aguardando_ciencia'
        ORDER BY e.data`;
      return ok(res, { eventos, termo: TERMO_CIENCIA });
    }
    if (b.acao !== 'ciente') return erro(res, 400, 'CORPO_INVALIDO', 'acao inválida');
    const p = b.prova || {};
    const foto = typeof p.foto === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(p.foto) && p.foto.length <= 300000 ? p.foto : null;
    const ciencia = {
      em: new Date().toISOString(), termo: TERMO_CIENCIA, dispositivo_id: vinc.dispositivo_id,
      ua: String(req.headers['user-agent'] || '').slice(0, 300), score: num(p.score), liveness_ok: p.liveness_ok === true,
      lat: num(p.lat), lng: num(p.lng), precisao_m: num(p.precisao_m), foto
    };
    const r = await sql`UPDATE evento SET estado='ciente', ciencia=${JSON.stringify(ciencia)}::jsonb
                        WHERE id=${String(b.id || '')} AND colaborador_id=${vinc.colaborador_id} AND empresa_id=${vinc.empresa_id}
                          AND estado='aguardando_ciencia' RETURNING id`;
    if (!r[0]) return erro(res, 409, 'EVENTO_JA_RESOLVIDO', 'este registro já foi resolvido');
    return ok(res, { id: r[0].id, estado: 'ciente', em: ciencia.em });
  });
}
