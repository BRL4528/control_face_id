// Renovação diária da escala. Um plano sem prazo é materializado até 90 dias à
// frente NO MOMENTO em que é salvo — sem isto, três meses depois a escala
// acabaria em silêncio e o RH teria que re-salvar cada plano. Roda todo dia via
// Vercel Cron (vercel.json) e só COMPLETA o que falta (não recria nem apaga).
//
// Segurança: a Vercel envia `Authorization: Bearer $CRON_SECRET` quando a env
// existe. Com CRON_SECRET configurado, exigimos; sem ele, aceitamos (o endpoint
// só regrava a escala já definida, não expõe nem apaga dado) — mas configure.
import { db } from '../_lib/db.js';
import { ok, erro } from '../_lib/http.js';
import { materializarPlano, normalizarPlano } from '../_lib/escala.js';

export default async function handler(req, res) {
  const segredo = process.env.CRON_SECRET;
  if (segredo && (req.headers.authorization || '') !== 'Bearer ' + segredo) {
    return erro(res, 401, 'NAO_AUTORIZADO', 'cron secret inválido');
  }
  const sql = db();
  const hoje = new Date().toISOString().slice(0, 10);
  const planos = await sql`
    SELECT * FROM plano_alocacao
    WHERE ativo=true AND (vigencia_fim IS NULL OR vigencia_fim >= ${hoje}::date)`;

  let gravadas = 0;
  for (const p of planos) {
    const r = await materializarPlano(sql, normalizarPlano(p), hoje);
    gravadas += r.gravadas;
  }
  return ok(res, { dia: hoje, planos: planos.length, alocacoes_gravadas: gravadas });
}
