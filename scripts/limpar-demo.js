// Deixa uma empresa rodando SÓ com o que veio do Bitrix: desativa colaboradores e
// equipes sem vínculo (bitrix_contact_id / bitrix_stage_id nulos), encerra as
// escalas dessas equipes, tira os inativos das escalas que continuam e bloqueia
// os aparelhos deles. Nada é apagado de verdade: marcação é imutável (trigger) e
// o histórico das pessoas demo fica visível como "inativo".
//
//   node --env-file=.env.local scripts/limpar-demo.js <link_token|empresa_id> [--executar] [--manter=MAT1,MAT2]
//
// Sem --executar é só prévia (DRY RUN). --manter preserva matrículas (ex.: o
// aparelho de teste do dono da conta).
import { neon } from '@neondatabase/serverless';
import { materializarPlano, normalizarPlano } from '../api/_lib/escala.js';
import { sincronizarBloqueios } from '../api/_lib/dispositivos.js';

const args = process.argv.slice(2);
const alvo = args.find(a => !a.startsWith('--'));
const executar = args.includes('--executar');
const manter = (args.find(a => a.startsWith('--manter=')) || '--manter=').slice(9).split(',').map(s => s.trim()).filter(Boolean);
if (!alvo) { console.error('uso: node --env-file=.env.local scripts/limpar-demo.js <link_token|empresa_id> [--executar] [--manter=MAT,...]'); process.exit(1); }
if (!process.env.DATABASE_URL) { console.error('✗ Defina DATABASE_URL'); process.exit(1); }

const sql = neon(process.env.DATABASE_URL);
const [emp] = await sql`SELECT id, nome, fuso FROM empresa WHERE link_token=${alvo} OR id=${alvo} LIMIT 1`;
if (!emp) { console.error('✗ empresa não encontrada:', alvo); process.exit(1); }
const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: emp.fuso || 'America/Campo_Grande', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
console.log((executar ? 'EXECUTANDO' : 'PRÉVIA (sem gravar)') + ' — empresa', emp.nome, '(' + emp.id + ') — hoje', hoje, manter.length ? '— mantendo ' + manter.join(', ') : '');

const colabs = await sql`SELECT id, nome, matricula FROM colaborador WHERE empresa_id=${emp.id} AND bitrix_contact_id IS NULL AND ativo=true AND NOT (matricula = ANY(${manter}::text[])) ORDER BY nome`;
const equipes = await sql`SELECT id, nome FROM equipe WHERE empresa_id=${emp.id} AND bitrix_stage_id IS NULL AND ativo=true ORDER BY nome`;
const planosDemo = await sql`SELECT pl.id, pl.nome FROM plano_alocacao pl JOIN equipe e ON e.id=pl.equipe_id WHERE pl.empresa_id=${emp.id} AND pl.ativo AND e.bitrix_stage_id IS NULL`;
console.log('\nColaboradores a desativar (' + colabs.length + '):', colabs.map(c => c.nome + ' [' + c.matricula + ']').join(', ') || '—');
console.log('Equipes a desativar (' + equipes.length + '):', equipes.map(e => e.nome).join(', ') || '—');
console.log('Escalas a encerrar (' + planosDemo.length + '):', planosDemo.map(p => p.nome).join(' | ') || '—');

if (!executar) { console.log('\nPrévia concluída. Rode de novo com --executar para aplicar.'); process.exit(0); }

if (colabs.length) await sql`UPDATE colaborador SET ativo=false WHERE id = ANY(${colabs.map(c => c.id)}::text[])`;
await sincronizarBloqueios(sql, emp.id);

for (const p of planosDemo) {
  await sql`DELETE FROM alocacao WHERE plano_id=${p.id} AND empresa_id=${emp.id} AND dia >= ${hoje}::date AND origem='plano'`;
  await sql`UPDATE plano_alocacao SET ativo=false, atualizado_em=now() WHERE id=${p.id}`;
}

// Inativos saem das escalas que continuam (ex.: equipe do Bitrix adotada pelo nome) e o futuro é regravado.
const inativos = (await sql`SELECT id FROM colaborador WHERE empresa_id=${emp.id} AND ativo=false`).map(c => c.id);
const planosVivos = inativos.length ? await sql`SELECT * FROM plano_alocacao WHERE empresa_id=${emp.id} AND ativo=true AND colaboradores && ${inativos}::text[]` : [];
for (const p of planosVivos) {
  const novo = (p.colaboradores || []).filter(c => !inativos.includes(c));
  const [row] = await sql`UPDATE plano_alocacao SET colaboradores=${novo}, atualizado_em=now() WHERE id=${p.id} RETURNING *`;
  const r = await materializarPlano(sql, normalizarPlano(row), hoje, { recriar: true });
  console.log('escala', p.nome + ':', (p.colaboradores || []).length, '→', novo.length, 'membros;', r.gravadas, 'alocações regravadas');
}
const futuras = inativos.length ? await sql`DELETE FROM alocacao WHERE empresa_id=${emp.id} AND dia >= ${hoje}::date AND colaborador_id = ANY(${inativos}::text[]) RETURNING id` : [];
if (equipes.length) await sql`UPDATE equipe SET ativo=false WHERE id = ANY(${equipes.map(e => e.id)}::text[])`;

const [r] = await sql`SELECT
  (SELECT count(*) FROM colaborador WHERE empresa_id=${emp.id} AND ativo) AS colab_ativos,
  (SELECT count(*) FROM colaborador WHERE empresa_id=${emp.id} AND ativo AND bitrix_contact_id IS NOT NULL) AS colab_ativos_bitrix,
  (SELECT count(*) FROM equipe WHERE empresa_id=${emp.id} AND ativo) AS equipes_ativas,
  (SELECT count(*) FROM equipe WHERE empresa_id=${emp.id} AND ativo AND bitrix_stage_id IS NOT NULL) AS equipes_ativas_bitrix,
  (SELECT count(*) FROM plano_alocacao WHERE empresa_id=${emp.id} AND ativo) AS escalas_ativas,
  (SELECT count(*) FROM dispositivo WHERE empresa_id=${emp.id} AND ativo AND estado='bloqueado') AS aparelhos_bloqueados`;
console.log('\n✓ Feito. Alocações futuras de inativos removidas:', futuras.length);
console.log('  Colaboradores ativos:', r.colab_ativos, '(do Bitrix:', r.colab_ativos_bitrix + ')');
console.log('  Equipes ativas:', r.equipes_ativas, '(do Bitrix:', r.equipes_ativas_bitrix + ')');
console.log('  Escalas ativas:', r.escalas_ativas, '| aparelhos bloqueados:', r.aparelhos_bloqueados);
