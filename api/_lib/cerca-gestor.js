// O gestor visita as equipes: com o parâmetro `gestorQualquerCerca` ligado (padrão),
// a batida dele vale em QUALQUER perímetro da empresa (locais ativos e cercas de
// escala do dia), não só no da própria equipe. Fora de todos os perímetros continua
// indo para revisão. Devolve o perímetro que contém o ponto (o mais próximo do
// centro) ou null.
import { dentroDaCerca } from './geo.js';

export async function configGestorQualquerCerca(sql, empresaId) {
  const r = await sql`SELECT dados->>'gestorQualquerCerca' AS v FROM config_empresa WHERE empresa_id=${empresaId} LIMIT 1`;
  return !(r[0] && r[0].v === 'false');   // ausente = ligado
}

export async function perimetroDoPonto(sql, empresaId, dia, lat, lng, precisaoM) {
  if (lat == null || lng == null) return null;
  const perimetros = await sql`
    SELECT l.nome, l.lat AS cerca_lat, l.lng AS cerca_lng, l.raio_m AS cerca_raio_m
      FROM local l WHERE l.empresa_id=${empresaId} AND l.ativo=true
    UNION
    SELECT COALESCE(e.nome, 'escala do dia'), a.cerca_lat, a.cerca_lng, a.cerca_raio_m
      FROM alocacao a LEFT JOIN equipe e ON e.id=a.equipe_id
      WHERE a.empresa_id=${empresaId} AND a.dia=${dia}::date`;
  let melhor = null;
  for (const p of perimetros) {
    const r = dentroDaCerca(p, lat, lng, precisaoM);
    if (r.dentro && (!melhor || r.distancia_m < melhor.distancia_m)) melhor = { nome: p.nome, distancia_m: r.distancia_m };
  }
  return melhor;
}
