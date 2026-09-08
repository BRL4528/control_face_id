// Geometria da cerca virtual. Puro — sem I/O — para ser testável em Node.

/** Distância em metros entre dois pontos (haversine). */
export function distanciaMetros(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const rad = g => (g * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * O ponto está dentro da cerca? Soma a imprecisão do GPS ao raio: um ponto a
 * 210 m com ±30 m de erro e raio 200 m ainda pode estar dentro — negar seria
 * injusto. Devolve { dentro, distancia_m }.
 */
export function dentroDaCerca(alocacao, lat, lng, precisaoM) {
  if (lat == null || lng == null) return { dentro: false, distancia_m: null };
  const d = distanciaMetros(alocacao.cerca_lat, alocacao.cerca_lng, lat, lng);
  const folga = Math.min(Number(precisaoM) || 0, 100); // GPS mente muito; teto de 100 m
  return { dentro: d <= alocacao.cerca_raio_m + folga, distancia_m: Math.round(d) };
}
