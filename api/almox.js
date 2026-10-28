// EPI e ferramentas no app: o colaborador confere o que recebeu e confirma com o
// rosto (captura 1:1 + prova de vida). Uma confirmação vale para todas as
// entregas listadas.
//
//   { acao: 'listar' }                 → entregas aguardando confirmação
//   { acao: 'confirmar', ids, prova }
import { db } from './_lib/db.js';
import { autenticarDispositivo } from './_lib/auth.js';
import { comTabelaNova } from './_lib/tabela-nova.js';
import { cors, ok, erro, corpo, exigeMetodo } from './_lib/http.js';

const num = v => (v == null || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);
const TERMO = 'Declaro que recebi os itens acima em perfeito estado, fui orientado sobre o uso e me comprometo a usá-los e conservá-los.';

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
      const entregas = await sql`
        SELECT e.id, e.quantidade, to_char(e.entregue_em,'YYYY-MM-DD') AS entregue_em, to_char(e.devolver_ate,'YYYY-MM-DD') AS devolver_ate,
               e.ca, i.nome, i.tipo
        FROM entrega e JOIN item i ON i.id = e.item_id
        WHERE e.colaborador_id=${vinc.colaborador_id} AND e.empresa_id=${vinc.empresa_id} AND e.estado='aguardando_ciencia'
        ORDER BY e.entregue_em`;
      return ok(res, { entregas, termo: TERMO });
    }
    if (b.acao !== 'confirmar') return erro(res, 400, 'CORPO_INVALIDO', 'acao inválida');
    const ids = (Array.isArray(b.ids) ? b.ids : []).map(String).slice(0, 100);
    if (!ids.length) return erro(res, 400, 'CORPO_INVALIDO', 'nada para confirmar');
    const p = b.prova || {};
    const foto = typeof p.foto === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(p.foto) && p.foto.length <= 300000 ? p.foto : null;
    const ciencia = {
      em: new Date().toISOString(), termo: TERMO, dispositivo_id: vinc.dispositivo_id,
      ua: String(req.headers['user-agent'] || '').slice(0, 300), score: num(p.score), liveness_ok: p.liveness_ok === true,
      lat: num(p.lat), lng: num(p.lng), precisao_m: num(p.precisao_m), foto
    };
    const r = await sql`UPDATE entrega SET estado='confirmada', ciencia=${JSON.stringify(ciencia)}::jsonb
                        WHERE id = ANY(${ids}) AND colaborador_id=${vinc.colaborador_id} AND empresa_id=${vinc.empresa_id}
                          AND estado='aguardando_ciencia' RETURNING id`;
    return ok(res, { confirmadas: r.length, em: ciencia.em });
  });
}
