// Migração dos ajustes do RH da Efrat (04/11/2026): equipe com ponto opcional e
// vetor do rosto da batida na zona cinzenta (reforço do cadastro ao aprovar).
// Idempotente (IF NOT EXISTS). O código no ar funciona antes dela: só não mostra
// o "ponto opcional" nem guarda o vetor até rodar.
//   node --env-file=.env.local scripts/migrar-2026-11-04.mjs
import { db } from '../api/_lib/db.js';

const sql = db();
const passos = [
  ['equipe.ponto_opcional', () => sql`ALTER TABLE equipe ADD COLUMN IF NOT EXISTS ponto_opcional boolean NOT NULL DEFAULT false`],
  ['marcacao_descritor', () => sql`CREATE TABLE IF NOT EXISTS marcacao_descritor (
    id_cliente text PRIMARY KEY REFERENCES marcacao(id_cliente) ON DELETE CASCADE,
    empresa_id text NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    colaborador_id text NOT NULL REFERENCES colaborador(id) ON DELETE CASCADE,
    vetor jsonb NOT NULL, criado_em timestamptz NOT NULL DEFAULT now())`]
];
for (const [nome, q] of passos) { await q(); console.log('ok', nome); }
console.log('migração ok');
