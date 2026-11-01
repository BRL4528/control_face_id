// Jornadas (turnos) da empresa. Cria, edita ou desativa uma jornada; e associa
// uma jornada + supervisor a uma equipe. Mesmo endpoint para os dois papéis:
//   • { nome, entrada, saida, tolerancia_min, intervalo_min, dias } → cria/edita jornada
//     `dias` (opcional): { "0".. "6": { entrada, saida, intervalo_min } } só dos dias
//     trabalhados (0 = domingo). Ausente ou null = segunda a sexta no horário base
//     (jornadas antigas); objeto vazio ou com saída <= entrada = 400.
//     tolerancia_min aceita 0; ausente ou vazio = 10.
//   • { equipe_id, jornada_id, supervisor_id } → associa à equipe
// Gestor de obra (perfil por obra) só associa, e só nas equipes das obras dele,
// com supervisor também das obras dele. Criar e editar jornada é do RH: a jornada
// vale para toda equipe que a usa, inclusive fora das obras do gestor.
import { db, novoId } from '../_lib/db.js';
import { autenticarRh } from '../_lib/auth.js';
import { exigeAcesso, noEscopo } from '../_lib/acesso.js';
import { obrasDe } from '../../js/acessos.js';
import { cors, ok, erro, corpo, exigeMetodo } from '../_lib/http.js';
import { horaValida, daEmpresa } from '../_lib/validar.js';

const DIAS_SEMANA = ['0', '1', '2', '3', '4', '5', '6'];

/**
 * Horário por dia da semana saneado. Devolve { dias } (null = legado, segunda a
 * sexta no horário base) ou { erro: 'mensagem' } quando o objeto veio inválido.
 * Nunca cai para null em silêncio quando `dias` veio como objeto: uma jornada
 * com os dias desmarcados virava segunda a sexta sem ninguém perceber.
 */
export function sanearDias(dias) {
  if (dias === undefined || dias === null) return { dias: null };
  if (typeof dias !== 'object' || Array.isArray(dias)) return { erro: 'dias inválidos' };
  const out = {};
  for (const k of DIAS_SEMANA) {
    const d = dias[k];
    if (!d) continue;   // dia não trabalhado
    if (!horaValida(d.entrada) || !horaValida(d.saida)) return { erro: 'horário inválido no dia ' + k };
    if (d.saida <= d.entrada) return { erro: 'saída antes da entrada no dia ' + k + ' (turno que vira a noite ainda não é suportado)' };
    out[k] = { entrada: d.entrada, saida: d.saida };
    if (d.intervalo_min != null && d.intervalo_min !== '') out[k].intervalo_min = Math.max(0, Math.min(Number(d.intervalo_min) || 0, 240));
  }
  if (!Object.keys(out).length) return { erro: 'marque ao menos um dia de trabalho' };
  return { dias: out };
}

/** Tolerância em minutos: 0 vale; ausente, vazio ou não numérico = 10; teto 120. */
export function toleranciaDe(v) {
  const n = Number(v);
  if (v === '' || v == null || !Number.isFinite(n)) return 10;
  return Math.max(0, Math.min(Math.round(n), 120));
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (exigeMetodo(req, res, 'POST')) return;
  const rh = autenticarRh(req);
  if (!rh) return erro(res, 401, 'SESSAO_INVALIDA', 'faça login novamente');
  const b = corpo(req);
  const sql = db();
  const acesso = await exigeAcesso(res, sql, rh, 'ponto', true);
  if (!acesso) return;
  const obras = obrasDe(acesso);   // gestor de obra: só as obras dele

  // Modo associação: liga a equipe a uma jornada/supervisor (qualquer um pode ser null).
  if (b.equipe_id && !b.nome) {
    const equipeId = String(b.equipe_id);
    const jornadaId = b.jornada_id ? String(b.jornada_id) : null;
    const supervisorId = b.supervisor_id ? String(b.supervisor_id) : null;
    if (obras && !obras.includes(equipeId)) return erro(res, 403, 'SEM_PERMISSAO', 'equipe fora das suas obras');
    const [eq] = await sql`SELECT jornada_id, supervisor_id FROM equipe WHERE id=${equipeId} AND empresa_id=${rh.empresa_id} LIMIT 1`;
    if (!eq) return erro(res, 404, 'EQUIPE_NAO_ENCONTRADA', 'equipe não encontrada');
    // Referência NOVA tem de ser da mesma empresa: jornada ativa e supervisor ativo
    // (e, para o gestor de obra, das obras dele). A tela manda os dois campos juntos,
    // então o que não mudou passa, mesmo que tenha sido desativado depois.
    if (jornadaId && jornadaId !== eq.jornada_id && !(await daEmpresa(sql, 'jornada', jornadaId, rh.empresa_id, { ativos: true }))) {
      return erro(res, 404, 'JORNADA_NAO_ENCONTRADA', 'jornada não encontrada');
    }
    if (supervisorId && supervisorId !== eq.supervisor_id) {
      if (!(await daEmpresa(sql, 'colaborador', supervisorId, rh.empresa_id, { ativos: true }))) return erro(res, 404, 'COLABORADOR_NAO_ENCONTRADO', 'supervisor não encontrado');
      if (!(await noEscopo(sql, acesso, rh.empresa_id, supervisorId))) return erro(res, 403, 'SEM_PERMISSAO', 'supervisor fora das suas obras');
    }
    await sql`UPDATE equipe SET jornada_id=${jornadaId}, supervisor_id=${supervisorId}
              WHERE id=${equipeId} AND empresa_id=${rh.empresa_id}`;
    return ok(res, { equipe_id: equipeId, associado: true });
  }

  // Modo jornada: cria ou edita. A jornada é da empresa inteira: só o RH altera.
  if (obras) return erro(res, 403, 'SEM_PERMISSAO', 'só o RH altera jornadas');
  const nome = String(b.nome || '').trim();
  if (!nome) return erro(res, 400, 'CORPO_INVALIDO', 'nome obrigatório');
  const entrada = horaValida(b.entrada) ? b.entrada : '07:00';
  const saida = horaValida(b.saida) ? b.saida : '17:00';
  const tol = toleranciaDe(b.tolerancia_min);
  const sd = sanearDias(b.dias);
  if (sd.erro) return erro(res, 400, 'CORPO_INVALIDO', sd.erro);
  const diasJson = sd.dias ? JSON.stringify(sd.dias) : null;
  const intervalo = b.intervalo_min === 0 || b.intervalo_min === '0' ? 0 : Math.max(0, Math.min(Number(b.intervalo_min) || 60, 240));

  if (b.jornada_id) {
    const r = await sql`UPDATE jornada SET nome=${nome}, entrada=${entrada}, saida=${saida},
              tolerancia_min=${tol}, intervalo_min=${intervalo}, dias=${diasJson}::jsonb, ativa=${b.ativa === false ? false : true}
              WHERE id=${b.jornada_id} AND empresa_id=${rh.empresa_id} RETURNING id`;
    if (!r[0]) return erro(res, 404, 'JORNADA_NAO_ENCONTRADA', 'jornada não encontrada');
    return ok(res, { jornada_id: b.jornada_id, atualizado: true });
  }
  const id = novoId();
  await sql`INSERT INTO jornada (id, empresa_id, nome, entrada, saida, tolerancia_min, intervalo_min, dias)
            VALUES (${id}, ${rh.empresa_id}, ${nome}, ${entrada}, ${saida}, ${tol}, ${intervalo}, ${diasJson}::jsonb)`;
  return ok(res, { jornada_id: id, criado: true });
}
