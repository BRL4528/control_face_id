// Prova facial exigida nos atos do colaborador que valem como assinatura:
// assinar a folha (api/folha.js), dar ciência de advertência (api/evento.js) e
// confirmar EPI/ferramenta (api/almox.js).
//
// A prova vem da mesma captura 1:1 da batida: { score, liveness_ok, foto, ... }.
// O servidor exige o 1:1 (distância numérica dentro do limiar) e a foto da
// captura. A prova de vida (liveness_ok) continua só registrada, como na batida:
// reprovada não barra, fica como evidência para o RH.

export const LIMIAR_PADRAO = 0.45;   // mesmo default de js/config.js (limiarAceite)

const FOTO = /^data:image\/(jpeg|png|webp);base64,/;
const FOTO_MAX = 300000;

const num = v => (v == null || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);

/** Foto da captura em data URL (jpeg/png/webp, até ~300 KB) ou null. */
export function fotoValida(f) {
  return typeof f === 'string' && FOTO.test(f) && f.length <= FOTO_MAX ? f : null;
}

/** Limiar da empresa (config_empresa.dados.limiarAceite) com faixa segura. Puro. */
export function limiarValido(v) {
  const n = num(v);
  return n != null && n >= 0.2 && n <= 0.9 ? n : LIMIAR_PADRAO;
}

/**
 * Confere a prova recebida. Pura.
 *   ok:    { ok: true, score, foto, liveness_ok }
 *   falha: { ok: false, status, codigo, mensagem }  (400 PROVA_FACIAL_AUSENTE | 403 ROSTO_NAO_CONFERE)
 */
export function conferirProva(prova, limiar = LIMIAR_PADRAO) {
  const p = prova && typeof prova === 'object' ? prova : {};
  const score = num(p.score);
  const foto = fotoValida(p.foto);
  if (score == null || score < 0 || !foto) {
    return { ok: false, status: 400, codigo: 'PROVA_FACIAL_AUSENTE', mensagem: 'confirme com o rosto pela câmera do aplicativo' };
  }
  if (score > limiarValido(limiar)) {
    return { ok: false, status: 403, codigo: 'ROSTO_NAO_CONFERE', mensagem: 'o rosto não conferiu com o seu cadastro. Tente de novo, de frente e com boa luz' };
  }
  return { ok: true, score, foto, liveness_ok: p.liveness_ok === true };
}

/** Lê o limiar da empresa no banco. */
export async function limiarDaEmpresa(sql, empresaId) {
  const r = await sql`SELECT dados->>'limiarAceite' AS v FROM config_empresa WHERE empresa_id=${empresaId} LIMIT 1`;
  return limiarValido(r[0] && r[0].v);
}
