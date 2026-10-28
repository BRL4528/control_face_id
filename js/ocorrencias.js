// Catálogo de ocorrências do colaborador (férias, atestado, afastamento, viagem...).
// Módulo puro, sem DOM: usado pelo painel (regras.js, rh.js) e pelo servidor
// (api/_lib/ocorrencia.js), para a regra de cada tipo existir num lugar só.
//
//   abona     o dia não tem previsto nem conta falta; na folha sai o rótulo `folha`
//   bloqueia  o app não deixa bater ponto no período
//   semCerca  a batida vale fora da cerca (trabalho externo)
//   foto      pede foto do documento
export const TIPOS_OCORRENCIA = {
  ferias:           { rotulo: 'Férias', folha: 'FÉRIAS', abona: true, bloqueia: true },
  atestado:         { rotulo: 'Atestado médico', folha: 'ATESTADO', abona: true, foto: true },
  afastamento_inss: { rotulo: 'Afastamento INSS', folha: 'AFASTADO INSS', abona: true, bloqueia: true, foto: true },
  licenca:          { rotulo: 'Licença (maternidade, paternidade, outras)', folha: 'LICENÇA', abona: true, bloqueia: true, foto: true },
  abono:            { rotulo: 'Falta justificada / abono', folha: 'ABONADO', abona: true },
  viagem:           { rotulo: 'Viagem / trabalho externo', folha: 'EXTERNO', semCerca: true }
};

const PRIORIDADE = ['afastamento_inss', 'licenca', 'ferias', 'atestado', 'abono', 'viagem'];

/**
 * Ocorrência ativa da pessoa no dia ('YYYY-MM-DD'), ou null. Entre duas no mesmo dia
 * vale a de maior efeito (afastamento > licença > férias > atestado > abono > viagem).
 * `ocorrencias`: [{ colaborador_id, tipo, inicio, fim|null, estado }].
 */
export function ocorrenciaDoDia(ocorrencias, pessoaId, dia) {
  let melhor = null;
  for (const o of (ocorrencias || [])) {
    if (o.colaborador_id !== pessoaId || o.estado !== 'ativa' || !TIPOS_OCORRENCIA[o.tipo]) continue;
    if (o.inicio > dia || (o.fim && o.fim < dia)) continue;
    if (!melhor || PRIORIDADE.indexOf(o.tipo) < PRIORIDADE.indexOf(melhor.tipo)) melhor = o;
  }
  return melhor;
}
