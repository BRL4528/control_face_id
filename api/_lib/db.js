// Conexão com o Neon (Postgres serverless) via HTTP — sem pool, ideal para
// funções serverless efêmeras da Vercel. DATABASE_URL vem das env vars do
// projeto (nunca no bundle do cliente).
import { neon } from '@neondatabase/serverless';

let _sql = null;

/** Cliente SQL com template tag: sql`SELECT ... WHERE id = ${id}` (parametrizado). */
export function db() {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não configurada');
  _sql = neon(url);
  return _sql;
}

export function novoId() {
  return globalThis.crypto.randomUUID();
}
