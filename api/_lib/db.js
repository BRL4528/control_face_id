// Conexão com o Neon (Postgres serverless) via HTTP — sem pool, ideal para
// funções serverless efêmeras da Vercel. DATABASE_URL vem das env vars do
// projeto (nunca no bundle do cliente).
//
// Banco local de teste (DATABASE_URL em localhost/127.0.0.1): usa o driver `pg`
// (dependência de desenvolvimento) com a mesma interface do cliente Neon —
// sql`...`, sql.query(texto, params) e sql.transaction(...) — para rodar o
// painel e o app de ponta a ponta sem tocar no banco de produção.
import { neon } from '@neondatabase/serverless';

let _sql = null;

/** Cliente SQL com template tag: sql`SELECT ... WHERE id = ${id}` (parametrizado). */
export function db() {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não configurada');
  _sql = ehLocal(url) ? clienteLocal(url) : neon(url);
  return _sql;
}

export function novoId() {
  return globalThis.crypto.randomUUID();
}

export const ehLocal = url => /^postgres(ql)?:\/\/[^@]*@(localhost|127\.0\.0\.1)[:/]/.test(String(url));

/**
 * Cliente `pg` com a interface do Neon. A consulta do template é preguiçosa (como
 * no Neon): só roda no await, o que permite montar a lista de uma transação.
 */
function clienteLocal(url) {
  let pool = null;
  const obterPool = async () => {
    if (!pool) {
      const { default: pg } = await import('pg');
      pool = new pg.Pool({ connectionString: url, max: 5 });
    }
    return pool;
  };
  const montar = (partes, valores) => ({
    text: partes.reduce((t, p, i) => t + '$' + i + p),
    values: valores
  });
  const consulta = (texto, params, cliente) => {
    const q = { text: texto, values: params || [] };
    return {
      _consulta: q,
      then(ok, falha) {
        const exec = async () => (await (cliente || await obterPool()).query(q.text, q.values)).rows;
        return exec().then(ok, falha);
      },
      catch(falha) { return this.then(undefined, falha); }
    };
  };
  const tag = (cliente) => (partes, ...valores) => {
    const { text, values } = montar(partes, valores);
    return consulta(text, values, cliente);
  };
  const sql = tag(null);
  sql.query = (texto, params) => consulta(texto, params, null);
  sql.transaction = async (arg) => {
    const p = await obterPool();
    const c = await p.connect();
    try {
      await c.query('BEGIN');
      const lista = typeof arg === 'function' ? arg(tag(c)) : arg;
      const res = [];
      for (const item of lista) {
        const q = item._consulta;
        res.push((await c.query(q.text, q.values)).rows);
      }
      await c.query('COMMIT');
      return res;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  };
  return sql;
}
