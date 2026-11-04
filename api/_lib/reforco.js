// Reforço do cadastro facial pela batida aprovada (04/11/2026). A batida que caiu
// na zona cinzenta traz o vetor do rosto (tabela marcacao_descritor). Quando o RH
// confirma que é a pessoa e marca "usar esta foto", o vetor entra no template
// ativo como nova versão: o 1:1 do app passa a reconhecer a pessoa naquela luz,
// óculos ou ângulo, e a mesma situação deixa de virar pendência.
import { novoId } from './db.js';
import { euclidiana } from '../../js/regras.js';

export const DIM = 128;
export const MAX_VETORES = 8;     // o 1º (cadastro original) fica sempre; sai o reforço mais antigo
export const LIMIAR_REFORCO = 0.58;   // = limiarCinza: acima disso nem o app aceitaria a batida

/** Vetor de rosto válido (128 números finitos) ou null. Pura. */
export function vetorValido(v) {
  return Array.isArray(v) && v.length === DIM && v.every(x => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 10) ? v : null;
}

/**
 * Vetores do template com o novo vetor. Pura. Recusa vetor longe demais de todos os
 * do cadastro (outra pessoa ou foto ruim: não envenena o template) e vetor quase
 * igual a um que já existe (não acrescenta nada).
 *   { vetores } | { erro: 'longe' | 'repetido' | 'invalido' }
 */
export function reforcarVetores(atuais, novo) {
  const v = vetorValido(novo);
  const base = (atuais || []).filter(vetorValido);
  if (!v || !base.length) return { erro: 'invalido' };
  const menor = Math.min(...base.map(x => euclidiana(x, v)));
  if (menor > LIMIAR_REFORCO) return { erro: 'longe' };
  if (menor < 0.05) return { erro: 'repetido' };
  const vetores = base.concat([v]);
  while (vetores.length > MAX_VETORES) vetores.splice(1, 1);
  return { vetores };
}

/**
 * Aplica o reforço da batida `idCliente` (já confirmada pelo RH) no template ativo
 * do colaborador. O vetor da batida é apagado depois de usado (dado biométrico não
 * fica sobrando). Tabela ausente (migração pendente) = sem reforço, sem erro.
 * Devolve 'reforcado' | 'sem_vetor' | 'sem_cadastro' | 'longe' | 'repetido' | 'invalido'.
 */
export async function reforcarCadastro(sql, empresaId, colaboradorId, idCliente) {
  let linha;
  try {
    [linha] = await sql`SELECT vetor FROM marcacao_descritor
                        WHERE id_cliente=${idCliente} AND empresa_id=${empresaId} AND colaborador_id=${colaboradorId} LIMIT 1`;
  } catch (e) { return 'sem_vetor'; }
  if (!linha) return 'sem_vetor';
  const [atual] = await sql`SELECT versao, vetores, miniatura_url, coerencia FROM template_facial
                            WHERE colaborador_id=${colaboradorId} AND estado='ativo' ORDER BY versao DESC LIMIT 1`;
  if (!atual) return 'sem_cadastro';
  const r = reforcarVetores(atual.vetores, linha.vetor);
  await sql`DELETE FROM marcacao_descritor WHERE id_cliente=${idCliente}`;
  if (r.erro) return r.erro;
  const versao = Number(atual.versao) + 1;
  await sql.transaction(txn => [
    txn`UPDATE template_facial SET estado='substituido' WHERE colaborador_id=${colaboradorId} AND estado='ativo'`,
    txn`INSERT INTO template_facial (id, colaborador_id, versao, vetores, miniatura_url, coerencia, estado, origem)
        VALUES (${novoId()}, ${colaboradorId}, ${versao}, ${JSON.stringify(r.vetores)}, ${atual.miniatura_url}, ${atual.coerencia}, 'ativo', 'reforco')`
  ]);
  return 'reforcado';
}

/** Descarta o vetor de uma batida (rejeitada ou decidida sem reforço). Tabela ausente: nada. */
export async function descartarVetor(sql, idCliente) {
  try { await sql`DELETE FROM marcacao_descritor WHERE id_cliente=${idCliente}`; } catch (e) { /* migração pendente */ }
}
