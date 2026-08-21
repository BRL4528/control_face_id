// Cliente da API do convite público (docs/fase3-contrato.md § 4.5). SÓ as
// duas rotas que a página pública tem permissão de chamar. O token é a
// credencial inteira — Authorization: Bearer — e nunca é credencial de RH
// nem de aparelho (não abre nada além destas duas rotas).
const cfg = () => window.EFRAT_CFG;

async function post(rota, corpo, { token, idempotencyKey, timeoutMs = 30000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const r = await fetch(cfg().apiBase + rota, {
      method: 'POST', headers, body: JSON.stringify(corpo || {}), signal: ctrl.signal
    });
    const txt = await r.text();
    let json = null;
    try { json = txt ? JSON.parse(txt) : null; } catch (e) { /* servidor devolveu não-JSON */ }
    return { ok: r.ok, status: r.status, json };
  } catch (e) {
    return { ok: false, status: 0, json: null, rede: true };
  } finally {
    clearTimeout(t);
  }
}

export const ApiFace = {
  abrir(token) { return post('/efrat/face/convite/abrir', {}, { token }); },
  enviar(token, dados, idempotencyKey) { return post('/efrat/face/convite/enviar', dados, { token, idempotencyKey }); }
};
