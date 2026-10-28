// Ocorrência vigente de um colaborador num dia, para o app (bloqueio de batida) e
// para a batida (trabalho externo dispensa a cerca). Regras em js/ocorrencias.js.
import { TIPOS_OCORRENCIA, ocorrenciaDoDia } from '../../js/ocorrencias.js';

export async function ocorrenciaVigente(sql, empresaId, colaboradorId, dia) {
  const linhas = await sql`
    SELECT colaborador_id, tipo, to_char(inicio,'YYYY-MM-DD') AS inicio, to_char(fim,'YYYY-MM-DD') AS fim, estado
    FROM ocorrencia
    WHERE empresa_id=${empresaId} AND colaborador_id=${colaboradorId} AND estado='ativa'
      AND inicio <= ${dia}::date AND (fim IS NULL OR fim >= ${dia}::date)`;
  const o = ocorrenciaDoDia(linhas, colaboradorId, dia);
  return o ? Object.assign({}, o, TIPOS_OCORRENCIA[o.tipo]) : null;
}

/** Foto do documento: data URL de imagem até ~1 MB (o painel e o app reduzem antes de enviar). */
export const anexoValido = a => typeof a === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(a) && a.length <= 1500000;
