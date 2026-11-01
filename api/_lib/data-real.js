// Data de calendário real no formato AAAA-MM-DD. O regex sozinho deixa passar
// 2026-02-30 e 2026-13-01, que estouram no Postgres e viram 500. O round-trip
// pelo Date (UTC) só devolve a mesma string quando o dia existe. Pura.
export function diaValido(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
