// Aplica servidor/persistencia/migrations/*.sql, em ordem, uma vez cada.
//
// Conexao DIRETA (nao pooled): migration muda schema, e PgBouncer em modo
// transacao (o -pooler) nao sustenta o `SET`/estado de sessao que DDL as
// vezes precisa. Use DATABASE_URL_UNPOOLED; cai para DATABASE_URL so se a
// unpooled nao estiver definida (setup local com uma unica string).
//
// node servidor/persistencia/migrar.js

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Pool } from '@neondatabase/serverless';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PASTA_MIGRATIONS = path.join(DIR, 'migrations');

async function main() {
  const conexao = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!conexao) throw new Error('defina DATABASE_URL_UNPOOLED (ou DATABASE_URL) antes de migrar');

  const pool = new Pool({ connectionString: conexao });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS efrat_migracoes (
        arquivo text PRIMARY KEY,
        aplicada_em timestamptz NOT NULL DEFAULT now()
      )
    `);

    const aplicadas = new Set(
      (await pool.query('SELECT arquivo FROM efrat_migracoes')).rows.map(r => r.arquivo)
    );

    const arquivos = readdirSync(PASTA_MIGRATIONS)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const arquivo of arquivos) {
      if (aplicadas.has(arquivo)) {
        console.log('ja aplicada:', arquivo);
        continue;
      }
      const sql = readFileSync(path.join(PASTA_MIGRATIONS, arquivo), 'utf8');
      console.log('aplicando:', arquivo);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO efrat_migracoes (arquivo) VALUES ($1)', [arquivo]);
        await client.query('COMMIT');
      } catch (erro) {
        await client.query('ROLLBACK');
        throw new Error(`falhou em ${arquivo}: ${erro.message}`, { cause: erro });
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
}

main().then(() => {
  console.log('migracoes em dia.');
  process.exit(0);
}).catch(erro => {
  console.error(erro);
  process.exit(1);
});
