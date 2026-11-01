// Ocorrências do colaborador (férias, atestado, afastamento, licença, abono, viagem).
//
//   { acao: 'salvar', id?, colaborador_id, tipo, inicio, fim?, observacao?, anexo? }
//        cria (sem id) ou edita. anexo: data URL de imagem; null apaga; ausente mantém.
//        Só a ocorrência 'ativa' é editável (409 OCORRENCIA_NAO_EDITAVEL nas outras).
//   { acao: 'cancelar', id, motivo? }      → estado 'cancelada' (o histórico fica). Só a
//        ativa ou a pendente; quem aprovou continua registrado (decidida_por não é
//        sobrescrito) e o cancelamento vai para a auditoria (correcao).
//   { acao: 'aprovar' | 'recusar', id }    → decide a enviada pelo app (pendente)
//   Estado que não admite a ação → 409 OCORRENCIA_JA_DECIDIDA.
//   { acao: 'anexo', id }                  → devolve a foto do documento
import { db, novoId } from '../_lib/db.js';
import { autenticarRh } from '../_lib/auth.js';
import { TIPOS_OCORRENCIA } from '../../js/ocorrencias.js';
import { anexoValido } from '../_lib/ocorrencia.js';
import { exigeAcesso } from '../_lib/acesso.js';
import { cors, ok, erro, corpo, exigeMetodo } from '../_lib/http.js';
import { diaValido } from '../_lib/validar.js';

// De que estado cada decisão sai e para qual vai.
const TRANSICOES = {
  cancelar: { de: ['ativa', 'pendente'], para: 'cancelada' },
  aprovar:  { de: ['pendente'], para: 'ativa' },
  recusar:  { de: ['pendente'], para: 'recusada' }
};

/**
 * A ação vale para a ocorrência neste estado? Devolve { para } ou { erro } (texto
 * do 409). Pura.
 */
export function transicaoOcorrencia(acao, estado) {
  const t = TRANSICOES[acao];
  if (!t) return { erro: 'acao inválida' };
  if (t.de.includes(estado)) return { para: t.para };
  if (acao === 'cancelar') return { erro: 'só a ocorrência ativa ou pendente pode ser cancelada (esta está ' + estado + ')' };
  return { erro: 'esta ocorrência já foi decidida (está ' + estado + ')' };
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (exigeMetodo(req, res, 'POST')) return;
  const rh = autenticarRh(req);
  if (!rh) return erro(res, 401, 'SESSAO_INVALIDA', 'faça login novamente');
  const b = corpo(req);
  const sql = db();
  const emp = rh.empresa_id;
  // Foto de atestado é dado de saúde: só quem vê o módulo saúde (RH, administrador).
  if (!(await exigeAcesso(res, sql, rh, b.acao === 'anexo' ? 'saude' : 'ocorrencias', b.acao !== 'anexo'))) return;

  if (b.acao === 'anexo') {
    const [o] = await sql`SELECT anexo FROM ocorrencia WHERE id=${String(b.id || '')} AND empresa_id=${emp} LIMIT 1`;
    if (!o) return erro(res, 404, 'OCORRENCIA_NAO_ENCONTRADA', 'ocorrência não encontrada');
    return ok(res, { anexo: o.anexo || null });
  }

  if (TRANSICOES[b.acao]) {
    const id = String(b.id || '');
    const [o] = await sql`SELECT estado FROM ocorrencia WHERE id=${id} AND empresa_id=${emp} LIMIT 1`;
    if (!o) return erro(res, 404, 'OCORRENCIA_NAO_ENCONTRADA', 'ocorrência não encontrada');
    const t = transicaoOcorrencia(b.acao, o.estado);
    if (t.erro) return erro(res, 409, 'OCORRENCIA_JA_DECIDIDA', t.erro, { estado: o.estado });
    const cancelar = b.acao === 'cancelar';
    // Cancelar não apaga quem aprovou ou lançou a decisão: só preenche se estiver vazio.
    // O estado de partida vai no WHERE: duas decisões ao mesmo tempo, só uma vale.
    const r = await sql`UPDATE ocorrencia SET estado=${t.para},
                          decidida_por = CASE WHEN ${cancelar} THEN COALESCE(decidida_por, ${rh.sub}) ELSE ${rh.sub} END,
                          decidida_em  = CASE WHEN ${cancelar} THEN COALESCE(decidida_em, now()) ELSE now() END
                        WHERE id=${id} AND empresa_id=${emp} AND estado=${o.estado} RETURNING id`;
    if (!r[0]) return erro(res, 409, 'OCORRENCIA_JA_DECIDIDA', 'a ocorrência mudou enquanto você decidia; atualize a tela');
    if (cancelar) {
      const motivo = String(b.motivo || '').trim().slice(0, 500);
      await sql`INSERT INTO correcao (id, empresa_id, alvo_tipo, alvo_id, acao, motivo, usuario_rh_id)
                VALUES (${novoId()}, ${emp}, 'ocorrencia', ${id}, 'cancelar', ${'estado anterior: ' + o.estado + (motivo ? '. ' + motivo : '')}, ${rh.sub})`;
    }
    return ok(res, { id: r[0].id, estado: t.para });
  }

  if (b.acao !== 'salvar') return erro(res, 400, 'CORPO_INVALIDO', 'acao inválida');
  if (!TIPOS_OCORRENCIA[b.tipo]) return erro(res, 400, 'CORPO_INVALIDO', 'tipo inválido');
  if (!b.inicio) return erro(res, 400, 'CORPO_INVALIDO', 'data de início obrigatória');
  if (!diaValido(b.inicio)) return erro(res, 400, 'CORPO_INVALIDO', 'data de início inválida');
  const fim = b.fim ? String(b.fim) : null;
  if (fim && !diaValido(fim)) return erro(res, 400, 'CORPO_INVALIDO', 'data final inválida');
  if (fim && fim < b.inicio) return erro(res, 400, 'CORPO_INVALIDO', 'a data final vem antes da inicial');
  const obs = b.observacao ? String(b.observacao).trim().slice(0, 1000) : null;
  if (b.anexo != null && !anexoValido(b.anexo)) return erro(res, 400, 'ANEXO_INVALIDO', 'foto inválida ou acima de 1 MB');
  const [c] = await sql`SELECT id FROM colaborador WHERE id=${String(b.colaborador_id || '')} AND empresa_id=${emp} LIMIT 1`;
  if (!c) return erro(res, 404, 'COLABORADOR_NAO_ENCONTRADO', 'colaborador não encontrado');

  if (b.id) {
    const mexeAnexo = b.anexo !== undefined;
    const r = await sql`UPDATE ocorrencia SET colaborador_id=${c.id}, tipo=${b.tipo}, inicio=${b.inicio}, fim=${fim}, observacao=${obs},
                          anexo = CASE WHEN ${mexeAnexo} THEN ${b.anexo || null} ELSE anexo END
                        WHERE id=${String(b.id)} AND empresa_id=${emp} AND estado='ativa' RETURNING id`;
    if (!r[0]) {
      // Cancelada, recusada ou pendente (decide-se em aprovar/recusar) não se edita.
      const [o] = await sql`SELECT estado FROM ocorrencia WHERE id=${String(b.id)} AND empresa_id=${emp} LIMIT 1`;
      if (o) return erro(res, 409, 'OCORRENCIA_NAO_EDITAVEL', 'só a ocorrência ativa pode ser editada (esta está ' + o.estado + ')');
      return erro(res, 404, 'OCORRENCIA_NAO_ENCONTRADA', 'ocorrência não encontrada');
    }
    return ok(res, { id: r[0].id, atualizada: true });
  }
  const id = novoId();
  await sql`INSERT INTO ocorrencia (id, empresa_id, colaborador_id, tipo, inicio, fim, observacao, anexo, criada_por)
            VALUES (${id}, ${emp}, ${c.id}, ${b.tipo}, ${b.inicio}, ${fim}, ${obs}, ${b.anexo || null}, ${rh.sub})`;
  return ok(res, { id, criada: true });
}
