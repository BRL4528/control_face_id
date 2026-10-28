// Folha de ponto no app do colaborador. Autenticado pela credencial do aparelho:
// a pessoa só vê e responde as próprias folhas.
//
//   { acao: 'listar' }                          → folhas aguardando + últimas respondidas
//   { acao: 'assinar', id, hash, prova }        → assina (hash = o que ele viu)
//   { acao: 'contestar', id, hash, motivo }     → não concorda; vai para o RH
//
// prova: { score, liveness_ok, lat, lng, precisao_m, foto, deriva_ms } da mesma
// captura 1:1 + prova de vida da batida. Rosto que não confere é barrado no app;
// aqui guardamos a evidência e o termo aceito.
import { db } from './_lib/db.js';
import { autenticarDispositivo } from './_lib/auth.js';
import { TERMO_ASSINATURA } from './_lib/folha.js';
import { cors, ok, erro, corpo, exigeMetodo } from './_lib/http.js';

const num = v => (v == null || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (exigeMetodo(req, res, 'POST')) return;
  const vinc = await autenticarDispositivo(req);
  if (!vinc) return erro(res, 401, 'CREDENCIAL_INVALIDA', 'dispositivo não autenticado');
  if (vinc.bloqueado) return erro(res, 403, 'BLOQUEADO', 'este aparelho foi bloqueado pelo RH');
  if (!vinc.colaborador_id) return erro(res, 403, 'SEM_COLABORADOR', 'cadastro ainda não confirmado pelo RH');

  const b = corpo(req);
  const sql = db();

  if (!b.acao || b.acao === 'listar') {
    const folhas = await sql`
      SELECT id, mes, estado, hash, conteudo, respondida_em, contestacao
      FROM folha_assinatura
      WHERE colaborador_id=${vinc.colaborador_id} AND empresa_id=${vinc.empresa_id}
      ORDER BY (estado='aguardando') DESC, mes DESC LIMIT 6`;
    return ok(res, { folhas, termo: TERMO_ASSINATURA });
  }

  if (b.acao !== 'assinar' && b.acao !== 'contestar') return erro(res, 400, 'CORPO_INVALIDO', 'acao inválida');
  const [f] = await sql`SELECT id, estado, hash FROM folha_assinatura
                        WHERE id=${String(b.id || '')} AND colaborador_id=${vinc.colaborador_id} AND empresa_id=${vinc.empresa_id} LIMIT 1`;
  if (!f) return erro(res, 404, 'FOLHA_NAO_ENCONTRADA', 'folha não encontrada');
  if (f.estado === 'assinada') return erro(res, 409, 'JA_ASSINADA', 'esta folha já foi assinada');
  // O RH pode ter refeito a folha depois que o app baixou: assinar exige o conteúdo atual.
  if (b.hash !== f.hash) return erro(res, 409, 'FOLHA_ALTERADA', 'a folha foi atualizada pelo RH; confira de novo');

  if (b.acao === 'contestar') {
    const motivo = String(b.motivo || '').trim().slice(0, 1000);
    if (!motivo) return erro(res, 400, 'CORPO_INVALIDO', 'diga o que não confere');
    await sql`UPDATE folha_assinatura SET estado='contestada', contestacao=${motivo}, respondida_em=now()
              WHERE id=${f.id}`;
    return ok(res, { id: f.id, estado: 'contestada' });
  }

  const p = b.prova || {};
  const foto = typeof p.foto === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(p.foto) && p.foto.length <= 300000 ? p.foto : null;
  const assinatura = {
    em: new Date().toISOString(), hash: f.hash, termo: TERMO_ASSINATURA,
    dispositivo_id: vinc.dispositivo_id, ua: String(req.headers['user-agent'] || '').slice(0, 300),
    score: num(p.score), liveness_ok: p.liveness_ok === true, deriva_ms: num(p.deriva_ms),
    lat: num(p.lat), lng: num(p.lng), precisao_m: num(p.precisao_m), foto
  };
  await sql`UPDATE folha_assinatura SET estado='assinada', assinatura=${JSON.stringify(assinatura)}::jsonb,
            respondida_em=now(), contestacao=NULL WHERE id=${f.id} AND estado <> 'assinada'`;
  return ok(res, { id: f.id, estado: 'assinada', em: assinatura.em });
}
