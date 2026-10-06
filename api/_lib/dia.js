// "Dia" de uma marcação no fuso da EMPRESA. O dia em UTC vira "amanhã" às 20h em
// Campo Grande e jogava a hora extra da noite no dia seguinte (cerca, relatório).
export function diaNoFuso(quando, fuso) {
  const d = new Date(quando);
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: fuso || 'America/Campo_Grande', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); }
  catch { return d.toISOString().slice(0, 10); }
}

export async function fusoDaEmpresa(sql, empresaId) {
  const r = await sql`SELECT fuso FROM empresa WHERE id=${empresaId} LIMIT 1`;
  return (r[0] && r[0].fuso) || 'America/Campo_Grande';
}
