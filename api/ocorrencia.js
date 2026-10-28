// Atestado enviado pelo colaborador no app: foto do documento, data e quantos dias.
// Nasce 'pendente' e só abona depois que o RH aprova (aba Ocorrências).
//
//   { acao: 'enviar', inicio, dias, anexo, observacao? }
//   { acao: 'listar' } → as últimas enviadas por ele, com a situação
import { db, novoId } from './_lib/db.js';
import { autenticarDispositivo } from './_lib/auth.js';
import { anexoValido } from './_lib/ocorrencia.js';
import { cors, ok, erro, corpo, exigeMetodo } from './_lib/http.js';

const DIA = /^\d{4}-\d{2}-\d{2}$/;

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (exigeMetodo(req, res, 'POST')) return;
  const vinc = await autenticarDispositivo(req);
  if (!vinc) return erro(res, 401, 'CREDENCIAL_INVALIDA', 'dispositivo não autenticado');
  if (vinc.bloqueado) return erro(res, 403, 'BLOQUEADO', 'este aparelho foi bloqueado pelo RH');
  if (!vinc.colaborador_id) return erro(res, 403, 'SEM_COLABORADOR', 'cadastro ainda não confirmado pelo RH');
  const b = corpo(req);
  const sql = db();

  if (!b.acao || b.acao === 'listar') {
    const lista = await sql`SELECT id, tipo, to_char(inicio,'YYYY-MM-DD') AS inicio, to_char(fim,'YYYY-MM-DD') AS fim, estado, criada_em
                            FROM ocorrencia WHERE colaborador_id=${vinc.colaborador_id} AND empresa_id=${vinc.empresa_id} AND origem='app'
                            ORDER BY criada_em DESC LIMIT 5`;
    return ok(res, { ocorrencias: lista });
  }
  if (b.acao !== 'enviar') return erro(res, 400, 'CORPO_INVALIDO', 'acao inválida');
  if (!DIA.test(b.inicio || '')) return erro(res, 400, 'CORPO_INVALIDO', 'data do atestado obrigatória');
  const dias = Math.max(1, Math.min(Number(b.dias) || 1, 365));
  if (!anexoValido(b.anexo)) return erro(res, 400, 'ANEXO_INVALIDO', 'tire a foto do atestado');
  const fim = new Date(Date.parse(b.inicio + 'T12:00:00Z') + (dias - 1) * 86400000).toISOString().slice(0, 10);
  const id = novoId();
  await sql`INSERT INTO ocorrencia (id, empresa_id, colaborador_id, tipo, inicio, fim, observacao, anexo, estado, origem)
            VALUES (${id}, ${vinc.empresa_id}, ${vinc.colaborador_id}, 'atestado', ${b.inicio}, ${fim},
                    ${b.observacao ? String(b.observacao).trim().slice(0, 500) : null}, ${b.anexo}, 'pendente', 'app')`;
  return ok(res, { id, estado: 'pendente', inicio: b.inicio, fim });
}
