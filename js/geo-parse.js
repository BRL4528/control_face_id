// Extração de coordenadas de texto colado — puro, sem I/O, para ser testável.
// Cobre dois casos que o RH vai colar:
//
//   1. Coordenadas soltas: "-20.4697, -54.6201" (o que o Google Maps mostra ao
//      clicar com o botão direito num ponto e copiar).
//   2. Link do Google Maps com lat/lng visível na URL:
//        .../@-20.4697,-54.6201,15z        (centro do mapa)
//        ...?q=-20.4697,-54.6201            (pino)
//        .../place/.../data=...!3d-20.46!4d-54.62  (destino)
//
// LIMITE HONESTO: links ENCURTADOS (maps.app.goo.gl/... , goo.gl/maps/...) NÃO
// contêm coordenadas — são um id que só o servidor do Google resolve. Para
// esses, devolvemos null com um motivo, e a UI orienta a abrir o link e colar as
// coordenadas de verdade. Não seguimos o redirect: sairia da origem e a CSP
// (connect-src) não permite falar com o Google.

const FAIXA_LAT = 90, FAIXA_LNG = 180;

function valida(lat, lng) {
  if (!isFinite(lat) || !isFinite(lng)) return null;
  if (Math.abs(lat) > FAIXA_LAT || Math.abs(lng) > FAIXA_LNG) return null;
  return { lat, lng };
}

/**
 * Tenta extrair { lat, lng } de um texto qualquer. Devolve o ponto, ou
 * { erro: 'motivo' } quando reconhece a intenção mas não consegue (link
 * encurtado), ou null quando não parece coordenada nenhuma.
 */
export function extrairCoordenadas(texto) {
  const t = String(texto || '').trim();
  if (!t) return null;

  // Link encurtado do Google: reconhece e explica por que não dá.
  if (/(goo\.gl\/maps|maps\.app\.goo\.gl)/i.test(t)) {
    return { erro: 'Link encurtado do Google não contém as coordenadas. Abra o link no Google Maps, clique com o botão direito no ponto e copie os números (ex.: -20.46, -54.62).' };
  }

  // Link do Google com @lat,lng (centro) — tem prioridade sobre ?q.
  let m = t.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) { const r = valida(parseFloat(m[1]), parseFloat(m[2])); if (r) return r; }

  // Parâmetros q= / ll= / destination= com "lat,lng".
  m = t.match(/[?&](?:q|ll|destination|center)=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) { const r = valida(parseFloat(m[1]), parseFloat(m[2])); if (r) return r; }

  // Formato !3dLAT!4dLNG que aparece no data= de alguns links de "place".
  const mlat = t.match(/!3d(-?\d+\.\d+)/), mlng = t.match(/!4d(-?\d+\.\d+)/);
  if (mlat && mlng) { const r = valida(parseFloat(mlat[1]), parseFloat(mlng[1])); if (r) return r; }

  // Coordenadas soltas "lat, lng" (com ou sem espaço; vírgula ou ponto-vírgula).
  m = t.match(/^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
  if (m) { const r = valida(parseFloat(m[1]), parseFloat(m[2])); if (r) return r; }

  return null;
}
