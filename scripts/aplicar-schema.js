// Aplica db/schema.sql no banco apontado por DATABASE_URL, sem depender de psql.
// Usa o driver que o próprio app usa. Uso:
//
//   DATABASE_URL="postgres://..." node scripts/aplicar-schema.js
//
// O schema é idempotente (CREATE TABLE IF NOT EXISTS / CREATE OR REPLACE), então
// rodar de novo não quebra nada. Executa numa transação: ou tudo aplica, ou nada.
import { neon } from '@neondatabase/serverless';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

// Divide o SQL em comandos por ';', mas trata blocos $$...$$ como indivisíveis
// (o corpo da função tem ';' que não terminam o comando). Remove comentários de
// linha ('-- ...') para eles não confundirem a contagem de '$$'.
function dividirSql(texto) {
  const semComentarios = texto.split('\n').map(l => l.replace(/--.*$/, '')).join('\n');
  const cmds = [];
  let atual = '', dentroDolar = false;
  for (let i = 0; i < semComentarios.length; i++) {
    const c = semComentarios[i];
    if (c === '$' && semComentarios[i + 1] === '$') { dentroDolar = !dentroDolar; atual += '$$'; i++; continue; }
    if (c === ';' && !dentroDolar) { if (atual.trim()) cmds.push(atual.trim()); atual = ''; continue; }
    atual += c;
  }
  if (atual.trim()) cmds.push(atual.trim());
  return cmds;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('✗ Defina DATABASE_URL'); process.exit(1); }

  const sqlText = await readFile(join(raiz, 'db', 'schema.sql'), 'utf8');
  const sql = neon(url);

  // O driver HTTP do Neon roda UM comando por chamada — não aceita várias
  // instruções juntas. Dividimos o arquivo em statements, respeitando os blocos
  // $$...$$ (corpo da função PL/pgSQL, que tem ';' internos que NÃO separam).
  const statements = dividirSql(sqlText);
  console.log('Aplicando db/schema.sql (' + statements.length + ' comandos)…');
  for (const s of statements) {
    try { await sql.query(s); }
    catch (e) { console.error('✗ falhou em:', s.slice(0, 60).replace(/\s+/g, ' '), '\n  ', e.message); throw e; }
  }

  // Confere que as tabelas nasceram.
  const t = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' ORDER BY table_name`;
  console.log('✓ Schema aplicado. Tabelas:', t.map(r => r.table_name).join(', '));
}

main().catch(e => { console.error('✗', e.message); process.exit(1); });
