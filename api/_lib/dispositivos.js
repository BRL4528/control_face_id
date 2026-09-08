// Regras de estado do aparelho, compartilhadas pelas rotas do RH.
import { randomBytes } from 'node:crypto';

/**
 * Colaborador inativo (saiu da empresa) ⇒ aparelhos dele BLOQUEADOS; voltou a
 * ativo ⇒ aparelhos que só estavam bloqueados por isso voltam. Idempotente;
 * chamar depois de qualquer escrita que mude colaborador.ativo.
 */
export async function sincronizarBloqueios(sql, empresaId) {
  await sql`
    UPDATE dispositivo d SET estado='bloqueado', bloqueado_em=now(), motivo_bloqueio='colaborador_inativo'
    FROM colaborador c
    WHERE c.id=d.colaborador_id AND c.empresa_id=${empresaId} AND c.ativo=false AND d.estado<>'bloqueado'`;
  await sql`
    UPDATE dispositivo d SET estado='ativo', bloqueado_em=NULL, motivo_bloqueio=NULL
    FROM colaborador c
    WHERE c.id=d.colaborador_id AND c.empresa_id=${empresaId} AND c.ativo=true
      AND d.estado='bloqueado' AND d.motivo_bloqueio='colaborador_inativo'`;
}

/** Token curto para o link da empresa (/e/<token>): 8 chars [a-z0-9]. */
export function gerarLinkToken() {
  return randomBytes(8).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, 'x').slice(0, 8);
}
