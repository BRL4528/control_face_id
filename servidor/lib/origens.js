// Quem pode falar com esta origem, e como a resposta diz isso.
//
// A API e a TERCEIRA origem do projeto. As outras duas — o app do operador e a
// pagina publica de cadastro — sao clientes CROSS-ORIGIN dela. Isso e o desenho,
// nao um efeito colateral: origem separada e o que mantem o IndexedDB do
// aparelho (a credencial de 256 bits, js/store.js) fora do alcance da pagina
// publica, e o que mantem a API fora do handler de fetch do sw.js do app
// (docs/vercel-na-frente-do-n8n.md descreve o bug que a mesma origem criaria:
// resposta de marcacao servida do cache mentiria sobre ponto registrado).
//
// A lista vem de ORIGENS_PERMITIDAS (env var da Vercel), separada por virgula,
// e NAO de arquivo commitado: hostname de cliente muda sem republicar codigo.
//
// Nunca '*'. Com '*' o navegador nem envia credencial, e qualquer pagina da
// internet passaria a poder chamar as rotas anonimas do convite a partir do
// navegador do colaborador. Ha guarda de CI conferindo que '*' nao volta.

export function origensPermitidas() {
  return (process.env.ORIGENS_PERMITIDAS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

// Devolve os cabecalhos de CORS para ESTA requisicao, ou {} se a origem nao
// esta na lista. Vary: Origin sempre — sem ele, um cache intermediario poderia
// servir a uma origem a resposta liberada para outra.
export function cabecalhosCors(origem) {
  const base = { 'Vary': 'Origin' };
  if (!origem || !origensPermitidas().includes(origem)) return base;
  return {
    ...base,
    'Access-Control-Allow-Origin': origem,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    // Os TRES que o contrato usa. Faltando Authorization e Idempotency-Key, o
    // preflight barra toda chamada autenticada cross-origin — e esta API e
    // cross-origin por desenho, entao seria toda chamada real. A lista espelha
    // CABECALHOS_ACEITOS de nucleo/http.js; se divergirem, a de la manda nas
    // rotas do contrato e esta so vale para /api/saude.
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key',
    'Access-Control-Max-Age': '600'
  };
}

export function aplicarCors(req, res) {
  const cabecalhos = cabecalhosCors(req.headers.origin);
  for (const [k, v] of Object.entries(cabecalhos)) res.setHeader(k, v);
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return true; }
  return false;
}
