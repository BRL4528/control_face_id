// EPI e ferramentas pelo RH / almoxarifado (regras em js/almox.js).
//
//   { acao: 'listar' }                       → itens e entregas (sem a foto da confirmação)
//   { acao: 'salvar_item', id?, tipo, nome, ca?, ca_validade?, vida_util_dias?, codigo?, ativo? }
//   { acao: 'entregar', item_id, colaboradores: [id...], equipe_id?, quantidade?, entregue_em, devolver_ate?, observacao? }
//        uma entrega por colaborador; vai para o app confirmar com o rosto.
//        Resposta traz aviso 'ca_vencido' quando o CA do EPI já venceu na data da
//        entrega (não bloqueia: o EPI pode ter sido adquirido na vigência do CA)
//   { acao: 'devolver', id, devolvido_em }   → baixa: ferramenta devolvida, ou EPI
//        devolvido/trocado (a entrega sai dos alertas e continua na ficha NR-6).
//        Uma vez só: entrega já devolvida → 409 ENTREGA_JA_DEVOLVIDA
//   { acao: 'cancelar', id, motivo? }        → só a que ainda aguarda a ciência no app
//        (lançada por engano). Confirmada pelo rosto ou devolvida é histórico da
//        ficha NR-6: 409 ENTREGA_NAO_CANCELAVEL, o caminho é a baixa ('devolver')
import { db, novoId } from '../_lib/db.js';
import { autenticarRh } from '../_lib/auth.js';
import { comTabelaNova } from '../_lib/tabela-nova.js';
import { TIPOS_ITEM } from '../../js/almox.js';
import { exigeAcesso } from '../_lib/acesso.js';
import { cors, ok, erro, corpo, exigeMetodo } from '../_lib/http.js';
import { diaValido, daEmpresa, listaDeIds } from '../_lib/validar.js';
const txt = (v, n) => v == null ? null : (String(v).trim().slice(0, n) || null);

/** O CA do EPI já estava vencido no dia da entrega? (mesma regra de js/almox.js) */
export const caVencidoNaEntrega = (item, entregueEm) =>
  !!(item && item.tipo === 'epi' && item.ca_validade && item.ca_validade < entregueEm);

/** Por que a entrega não pode ser cancelada (texto do 409 ENTREGA_NAO_CANCELAVEL). */
export function motivoNaoCancelavel(estado) {
  if (estado === 'confirmada') return 'entrega já confirmada pelo colaborador fica na ficha de EPI; para tirar de uso, registre a devolução';
  if (estado === 'devolvida') return 'entrega já devolvida fica na ficha de EPI e não pode ser cancelada';
  if (estado === 'cancelada') return 'esta entrega já foi cancelada';
  return 'esta entrega não pode ser cancelada';
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (exigeMetodo(req, res, 'POST')) return;
  const rh = autenticarRh(req);
  if (!rh) return erro(res, 401, 'SESSAO_INVALIDA', 'faça login novamente');
  const b = corpo(req);
  const sql = db();
  const emp = rh.empresa_id;
  if (!(await exigeAcesso(res, sql, rh, 'almox', !!b.acao && b.acao !== 'listar'))) return;

  return comTabelaNova(res, async () => {
    if (!b.acao || b.acao === 'listar') {
      const [itens, entregas] = await Promise.all([
        sql`SELECT id, tipo, nome, ca, to_char(ca_validade,'YYYY-MM-DD') AS ca_validade, vida_util_dias, codigo, ativo
            FROM item WHERE empresa_id=${emp} ORDER BY tipo, lower(nome)`,
        sql`SELECT id, item_id, colaborador_id, equipe_id, quantidade, to_char(entregue_em,'YYYY-MM-DD') AS entregue_em,
                   to_char(devolver_ate,'YYYY-MM-DD') AS devolver_ate, to_char(devolvido_em,'YYYY-MM-DD') AS devolvido_em,
                   ca, observacao, estado, ciencia - 'foto' AS ciencia
            FROM entrega WHERE empresa_id=${emp} AND estado <> 'cancelada' ORDER BY entregue_em DESC LIMIT 3000`
      ]);
      return ok(res, { itens, entregas });
    }

    if (b.acao === 'salvar_item') {
      if (!TIPOS_ITEM[b.tipo]) return erro(res, 400, 'CORPO_INVALIDO', 'tipo inválido');
      const nome = txt(b.nome, 120);
      if (!nome) return erro(res, 400, 'CORPO_INVALIDO', 'nome obrigatório');
      if (b.ca_validade && !diaValido(b.ca_validade)) return erro(res, 400, 'CORPO_INVALIDO', 'validade do CA inválida');
      const caVal = b.ca_validade || null;
      const vida = Number(b.vida_util_dias) > 0 ? Math.min(Math.round(Number(b.vida_util_dias)), 3650) : null;
      if (b.id) {
        const r = await sql`UPDATE item SET tipo=${b.tipo}, nome=${nome}, ca=${txt(b.ca, 30)}, ca_validade=${caVal}, vida_util_dias=${vida},
                              codigo=${txt(b.codigo, 60)}, ativo=${b.ativo !== false} WHERE id=${String(b.id)} AND empresa_id=${emp} RETURNING id`;
        if (!r[0]) return erro(res, 404, 'ITEM_NAO_ENCONTRADO', 'item não encontrado');
        return ok(res, { id: r[0].id, atualizado: true });
      }
      const id = novoId();
      await sql`INSERT INTO item (id, empresa_id, tipo, nome, ca, ca_validade, vida_util_dias, codigo)
                VALUES (${id}, ${emp}, ${b.tipo}, ${nome}, ${txt(b.ca, 30)}, ${caVal}, ${vida}, ${txt(b.codigo, 60)})`;
      return ok(res, { id, criado: true });
    }

    if (b.acao === 'entregar') {
      const [it] = await sql`SELECT id, tipo, ca, to_char(ca_validade,'YYYY-MM-DD') AS ca_validade
                             FROM item WHERE id=${String(b.item_id || '')} AND empresa_id=${emp} AND ativo LIMIT 1`;
      if (!it) return erro(res, 404, 'ITEM_NAO_ENCONTRADO', 'item não encontrado');
      if (!b.entregue_em) return erro(res, 400, 'CORPO_INVALIDO', 'data da entrega obrigatória');
      if (!diaValido(b.entregue_em)) return erro(res, 400, 'CORPO_INVALIDO', 'data da entrega inválida');
      if (it.tipo === 'ferramenta' && b.devolver_ate && !diaValido(b.devolver_ate)) return erro(res, 400, 'CORPO_INVALIDO', 'data para devolver inválida');
      const devolver = it.tipo === 'ferramenta' && b.devolver_ate ? b.devolver_ate : null;
      if (devolver && devolver < b.entregue_em) return erro(res, 400, 'CORPO_INVALIDO', 'devolver até não pode ser antes da entrega');
      const ids = listaDeIds(Array.isArray(b.colaboradores) ? b.colaboradores : []).slice(0, 300);
      if (!ids.length) return erro(res, 400, 'CORPO_INVALIDO', 'escolha ao menos um colaborador');
      // A obra da entrega tem de ser desta empresa (a FK aceita equipe de outra).
      const equipeId = b.equipe_id ? String(b.equipe_id) : null;
      if (equipeId && !(await daEmpresa(sql, 'equipe', equipeId, emp))) return erro(res, 404, 'EQUIPE_NAO_ENCONTRADA', 'equipe não encontrada');
      const achados = await sql`SELECT id, ativo FROM colaborador WHERE empresa_id=${emp} AND id = ANY(${ids}::text[])`;
      const daqui = new Set(achados.map(r => r.id));
      const fora = ids.filter(id => !daqui.has(id));
      if (fora.length) return erro(res, 404, 'COLABORADOR_NAO_ENCONTRADO', 'colaborador não encontrado', { colaboradores: fora });
      // Desligado não recebe EPI nem ferramenta (o app dele está bloqueado e não confirma).
      const inativos = achados.filter(r => !r.ativo).map(r => r.id);
      if (inativos.length) return erro(res, 400, 'COLABORADOR_INATIVO', 'colaborador desligado não recebe entrega', { colaboradores: inativos });
      const qtd = Math.max(1, Math.min(Number(b.quantidade) || 1, 999));
      for (const c of ids) {
        await sql`INSERT INTO entrega (id, empresa_id, item_id, colaborador_id, equipe_id, quantidade, entregue_em, devolver_ate, ca, observacao, criado_por)
                  VALUES (${novoId()}, ${emp}, ${it.id}, ${c}, ${equipeId}, ${qtd}, ${b.entregue_em}, ${devolver}, ${it.ca}, ${txt(b.observacao, 500)}, ${rh.sub})`;
      }
      return ok(res, Object.assign({ entregas: ids.length }, caVencidoNaEntrega(it, b.entregue_em) ? { aviso: 'ca_vencido' } : {}));
    }

    if (b.acao === 'cancelar') {
      const id = String(b.id || '');
      const r = await sql`UPDATE entrega SET estado='cancelada'
                          WHERE id=${id} AND empresa_id=${emp} AND estado='aguardando_ciencia' RETURNING id`;
      if (!r[0]) {
        const [en] = await sql`SELECT estado FROM entrega WHERE id=${id} AND empresa_id=${emp} LIMIT 1`;
        if (!en) return erro(res, 404, 'ENTREGA_NAO_ENCONTRADA', 'entrega não encontrada');
        return erro(res, 409, 'ENTREGA_NAO_CANCELAVEL', motivoNaoCancelavel(en.estado), { estado: en.estado });
      }
      // Quem cancelou e por quê ficam na auditoria (a entrega sai da lista e da ficha).
      const motivo = String(b.motivo || '').trim().slice(0, 500);
      await sql`INSERT INTO correcao (id, empresa_id, alvo_tipo, alvo_id, acao, motivo, usuario_rh_id)
                VALUES (${novoId()}, ${emp}, 'entrega', ${r[0].id}, 'cancelar', ${motivo || 'lançada por engano, antes da confirmação no app'}, ${rh.sub})`;
      return ok(res, { id: r[0].id });
    }

    // Baixa da entrega (ferramenta devolvida, EPI devolvido ou trocado).
    if (b.acao === 'devolver') {
      if (b.devolvido_em && !diaValido(b.devolvido_em)) return erro(res, 400, 'CORPO_INVALIDO', 'data da devolução inválida');
      const data = b.devolvido_em || new Date().toISOString().slice(0, 10);
      const [en] = await sql`SELECT id, estado, to_char(entregue_em,'YYYY-MM-DD') AS entregue_em FROM entrega
                             WHERE id=${String(b.id || '')} AND empresa_id=${emp} AND estado <> 'cancelada' LIMIT 1`;
      if (!en) return erro(res, 404, 'ENTREGA_NAO_ENCONTRADA', 'entrega não encontrada');
      // A data da baixa não se reescreve: uma devolução por entrega.
      if (en.estado === 'devolvida') return erro(res, 409, 'ENTREGA_JA_DEVOLVIDA', 'esta entrega já foi devolvida');
      if (data < en.entregue_em) return erro(res, 400, 'CORPO_INVALIDO', 'a devolução não pode ser antes da entrega');
      const r = await sql`UPDATE entrega SET estado='devolvida', devolvido_em=${data}
                          WHERE id=${en.id} AND empresa_id=${emp} AND estado NOT IN ('cancelada','devolvida') AND entregue_em <= ${data}::date RETURNING id`;
      // Corrida com outra baixa ou cancelamento: quem chegou primeiro vale.
      if (!r[0]) return erro(res, 409, 'ENTREGA_JA_DEVOLVIDA', 'esta entrega já foi devolvida ou cancelada');
      return ok(res, { id: r[0].id, devolvido_em: data });
    }
    return erro(res, 400, 'CORPO_INVALIDO', 'acao inválida');
  });
}
