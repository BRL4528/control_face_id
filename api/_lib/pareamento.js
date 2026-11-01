// Regras puras do pareamento do celular (api/parear.js). Separadas do handler
// para teste de unidade, sem banco.
//
// O dispositivo_id é gerado no próprio celular e não é segredo: quem o conhece
// NÃO pode re-parear o aparelho de outra pessoa ou de outra empresa. Só o dono
// (mesma credencial, mesma empresa) mexe na linha que já existe.

/**
 * Decide o que fazer com um pedido de pareamento.
 *   existente: linha atual do dispositivo ou null:
 *              { empresa_id, colab_empresa_id, credencial_hash, estado, ativo, colaborador_id }
 *   alvo:      { empresaId, hash }: empresa pedida e hash da credencial enviada.
 * Devolve:
 *   'novo'      não existe: cria pendente;
 *   'conflito'  existe com outra empresa ou outra credencial: 409, não altera nada;
 *   'bloqueado' é o próprio aparelho, bloqueado pelo RH: 403;
 *   'ja_ativo'  é o próprio aparelho, já ativo e com colaborador: nada a mudar;
 *   'pendente'  é o próprio aparelho, pendente ou desativado: volta a pendente.
 */
export function decidirPareamento(existente, alvo) {
  if (!existente) return 'novo';
  const empresaAtual = existente.empresa_id || existente.colab_empresa_id || null;
  if (empresaAtual && empresaAtual !== alvo.empresaId) return 'conflito';
  if (!existente.credencial_hash || existente.credencial_hash !== alvo.hash) return 'conflito';
  if (existente.estado === 'bloqueado') return 'bloqueado';
  if (existente.ativo && existente.estado === 'ativo' && existente.colaborador_id) return 'ja_ativo';
  return 'pendente';
}
