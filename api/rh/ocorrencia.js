// Ocorrências do colaborador (férias, atestado, afastamento, licença, abono, viagem).
//
//   { acao: 'salvar', id?, colaborador_id, tipo, inicio, fim?, observacao?, anexo? }
//        cria (sem id) ou edita. anexo: data URL de imagem; null apaga; ausente mantém.
//   { acao: 'cancelar', id }               → estado 'cancelada' (o histórico fica)
//   { acao: 'aprovar' | 'recusar', id }    → decide a enviada pelo app (pendente)
//   { acao: 'anexo', id }                  → devolve a foto do documento
import { db, novoId } from '../_lib/db.js';
import { autenticarRh } from '../_lib/auth.js';
import { TIPOS_OCORRENCIA } from '../../js/ocorrencias.js';
import { anexoValido } from '../_lib/ocorrencia.js';
import { cors, ok, erro, corpo, exigeMetodo } from '../_lib/http.js';

const DIA = /^\d{4}-\d{2}-\d{2}$/;

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (exigeMetodo(req, res, 'POST')) return;
  const rh = autenticarRh(req);
  if (!rh) return erro(res, 401, 'SESSAO_INVALIDA', 'faça login novamente');
  const b = corpo(req);
  const sql = db();
  const emp = rh.empresa_id;

  if (b.acao === 'anexo') {
    const [o] = await sql`SELECT anexo FROM ocorrencia WHERE id=${String(b.id || '')} AND empresa_id=${emp} LIMIT 1`;
    if (!o) return erro(res, 404, 'OCORRENCIA_NAO_ENCONTRADA', 'ocorrência não encontrada');
    return ok(res, { anexo: o.anexo || null });
  }

  if (b.acao === 'cancelar' || b.acao === 'aprovar' || b.acao === 'recusar') {
    const novo = { cancelar: 'cancelada', aprovar: 'ativa', recusar: 'recusada' }[b.acao];
    const r = await sql`UPDATE ocorrencia SET estado=${novo}, decidida_por=${rh.sub}, decidida_em=now()
                        WHERE id=${String(b.id || '')} AND empresa_id=${emp}
                          AND (${b.acao} = 'cancelar' OR estado = 'pendente') RETURNING id`;
    if (!r[0]) return erro(res, 404, 'OCORRENCIA_NAO_ENCONTRADA', 'ocorrência não encontrada ou já decidida');
    return ok(res, { id: r[0].id, estado: novo });
  }

  if (b.acao !== 'salvar') return erro(res, 400, 'CORPO_INVALIDO', 'acao inválida');
  if (!TIPOS_OCORRENCIA[b.tipo]) return erro(res, 400, 'CORPO_INVALIDO', 'tipo inválido');
  if (!DIA.test(b.inicio || '')) return erro(res, 400, 'CORPO_INVALIDO', 'data de início obrigatória');
  const fim = b.fim ? String(b.fim) : null;
  if (fim && (!DIA.test(fim) || fim < b.inicio)) return erro(res, 400, 'CORPO_INVALIDO', 'a data final vem antes da inicial');
  const obs = b.observacao ? String(b.observacao).trim().slice(0, 1000) : null;
  if (b.anexo != null && !anexoValido(b.anexo)) return erro(res, 400, 'ANEXO_INVALIDO', 'foto inválida ou acima de 1 MB');
  const [c] = await sql`SELECT id FROM colaborador WHERE id=${String(b.colaborador_id || '')} AND empresa_id=${emp} LIMIT 1`;
  if (!c) return erro(res, 404, 'COLABORADOR_NAO_ENCONTRADO', 'colaborador não encontrado');

  if (b.id) {
    const mexeAnexo = b.anexo !== undefined;
    const r = await sql`UPDATE ocorrencia SET colaborador_id=${c.id}, tipo=${b.tipo}, inicio=${b.inicio}, fim=${fim}, observacao=${obs},
                          anexo = CASE WHEN ${mexeAnexo} THEN ${b.anexo || null} ELSE anexo END
                        WHERE id=${String(b.id)} AND empresa_id=${emp} RETURNING id`;
    if (!r[0]) return erro(res, 404, 'OCORRENCIA_NAO_ENCONTRADA', 'ocorrência não encontrada');
    return ok(res, { id: r[0].id, atualizada: true });
  }
  const id = novoId();
  await sql`INSERT INTO ocorrencia (id, empresa_id, colaborador_id, tipo, inicio, fim, observacao, anexo, criada_por)
            VALUES (${id}, ${emp}, ${c.id}, ${b.tipo}, ${b.inicio}, ${fim}, ${obs}, ${b.anexo || null}, ${rh.sub})`;
  return ok(res, { id, criada: true });
}
