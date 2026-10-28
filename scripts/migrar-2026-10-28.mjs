// Migração das fases 5–7 (28/10/2026): advertências/acidentes, EPI/ferramentas e
// perfis de acesso. Idempotente (IF NOT EXISTS): pode rodar de novo sem efeito.
//   node --env-file=.env.local scripts/migrar-2026-10-28.mjs
import { db } from '../api/_lib/db.js';

const sql = db();
const passos = [
  ['evento', () => sql`CREATE TABLE IF NOT EXISTS evento (
    id text PRIMARY KEY, empresa_id text NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    colaborador_id text NOT NULL REFERENCES colaborador(id) ON DELETE CASCADE, equipe_id text REFERENCES equipe(id) ON DELETE SET NULL,
    tipo text NOT NULL, data date NOT NULL, hora text, descricao text NOT NULL, anexo text,
    dados jsonb NOT NULL DEFAULT '{}'::jsonb, cat_anexo text, estado text NOT NULL, ciencia jsonb,
    criado_em timestamptz NOT NULL DEFAULT now(), criado_por text REFERENCES usuario_rh(id))`],
  ['ix_evento_empresa', () => sql`CREATE INDEX IF NOT EXISTS ix_evento_empresa ON evento (empresa_id, tipo, estado)`],
  ['ix_evento_colab', () => sql`CREATE INDEX IF NOT EXISTS ix_evento_colab ON evento (colaborador_id, estado)`],
  ['item', () => sql`CREATE TABLE IF NOT EXISTS item (
    id text PRIMARY KEY, empresa_id text NOT NULL REFERENCES empresa(id) ON DELETE CASCADE, tipo text NOT NULL, nome text NOT NULL,
    ca text, ca_validade date, vida_util_dias integer, codigo text, ativo boolean NOT NULL DEFAULT true,
    criado_em timestamptz NOT NULL DEFAULT now())`],
  ['ix_item_empresa', () => sql`CREATE INDEX IF NOT EXISTS ix_item_empresa ON item (empresa_id, tipo)`],
  ['entrega', () => sql`CREATE TABLE IF NOT EXISTS entrega (
    id text PRIMARY KEY, empresa_id text NOT NULL REFERENCES empresa(id) ON DELETE CASCADE, item_id text NOT NULL REFERENCES item(id),
    colaborador_id text NOT NULL REFERENCES colaborador(id) ON DELETE CASCADE, equipe_id text REFERENCES equipe(id) ON DELETE SET NULL,
    quantidade integer NOT NULL DEFAULT 1, entregue_em date NOT NULL, devolver_ate date, devolvido_em date, ca text, observacao text,
    estado text NOT NULL DEFAULT 'aguardando_ciencia', ciencia jsonb, criado_em timestamptz NOT NULL DEFAULT now(),
    criado_por text REFERENCES usuario_rh(id))`],
  ['ix_entrega_colab', () => sql`CREATE INDEX IF NOT EXISTS ix_entrega_colab ON entrega (colaborador_id, estado)`],
  ['ix_entrega_empresa', () => sql`CREATE INDEX IF NOT EXISTS ix_entrega_empresa ON entrega (empresa_id, estado)`],
  ['usuario_rh.perfil', () => sql`ALTER TABLE usuario_rh ADD COLUMN IF NOT EXISTS perfil text`],
  ['usuario_rh.obras', () => sql`ALTER TABLE usuario_rh ADD COLUMN IF NOT EXISTS obras jsonb`]
];
for (const [nome, q] of passos) { await q(); console.log('ok', nome); }
console.log('migração ok');
