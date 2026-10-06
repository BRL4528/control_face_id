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

/** Deslocamento (ms) do fuso em relação ao UTC num instante: local = UTC + offset. */
function offsetDoFuso(instanteMs, fuso) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: fuso, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(instanteMs)).reduce((a, x) => (a[x.type] = x.value, a), {});
  const comoUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return comoUtc - Math.floor(instanteMs / 1000) * 1000;
}

/** 'YYYY-MM-DD' + 'HH:MM' no relógio do fuso da empresa → ISO em UTC. null se inválido. */
export function instanteNoFuso(dia, hora, fuso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia || ''), h = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hora || '');
  if (!m || !h) return null;
  const z = fuso || 'America/Campo_Grande';
  try {
    const alvo = Date.UTC(+m[1], +m[2] - 1, +m[3], +h[1], +h[2]);
    let t = alvo - offsetDoFuso(alvo, z);
    t = alvo - offsetDoFuso(t, z);   // 2ª passada: vale também na virada de horário de verão
    return new Date(t).toISOString();
  } catch { return null; }
}
