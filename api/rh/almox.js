// EPI e ferramentas pelo RH / almoxarifado (regras em js/almox.js).
//
//   { acao: 'listar' }                       → itens e entregas (sem a foto da confirmação)
//   { acao: 'salvar_item', id?, tipo, nome, ca?, ca_validade?, vida_util_dias?, codigo?, ativo? }
//   { acao: 'entregar', item_id, colaboradores: [id...], equipe_id?, quantidade?, entregue_em, devolver_ate?, observacao? }
//        uma entrega por colaborador; vai para o app confirmar com o rosto
//   { acao: 'devolver', id, devolvido_em }   → ferramenta devolvida
//   { acao: 'cancelar', id }
import { db, novoId } from '../_lib/db.js';
import { autenticarRh } from '../_lib/auth.js';
import { comTabelaNova } from '../_lib/tabela-nova.js';
import { TIPOS_ITEM } from '../../js/almox.js';
import { cors, ok, erro, corpo, exigeMetodo } from '../_lib/http.js';

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const txt = (v, n) => v == null ? null : (String(v).trim().slice(0, n) || null);

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (exigeMetodo(req, res, 'POST')) return;
  const rh = autenticarRh(req);
  if (!rh) return erro(res, 401, 'SESSAO_INVALIDA', 'faça login novamente');
  const b = corpo(req);
  const sql = db();
  const emp = rh.empresa_id;

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
      const caVal = DIA.test(b.ca_validade || '') ? b.ca_validade : null;
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
      const [it] = await sql`SELECT id, tipo, ca FROM item WHERE id=${String(b.item_id || '')} AND empresa_id=${emp} AND ativo LIMIT 1`;
      if (!it) return erro(res, 404, 'ITEM_NAO_ENCONTRADO', 'item não encontrado');
      if (!DIA.test(b.entregue_em || '')) return erro(res, 400, 'CORPO_INVALIDO', 'data da entrega obrigatória');
      const devolver = it.tipo === 'ferramenta' && DIA.test(b.devolver_ate || '') ? b.devolver_ate : null;
      const ids = [...new Set((Array.isArray(b.colaboradores) ? b.colaboradores : []).map(String))].slice(0, 300);
      if (!ids.length) return erro(res, 400, 'CORPO_INVALIDO', 'escolha ao menos um colaborador');
      const validos = (await sql`SELECT id FROM colaborador WHERE empresa_id=${emp} AND id = ANY(${ids})`).map(r => r.id);
      const qtd = Math.max(1, Math.min(Number(b.quantidade) || 1, 999));
      for (const c of validos) {
        await sql`INSERT INTO entrega (id, empresa_id, item_id, colaborador_id, equipe_id, quantidade, entregue_em, devolver_ate, ca, observacao, criado_por)
                  VALUES (${novoId()}, ${emp}, ${it.id}, ${c}, ${b.equipe_id || null}, ${qtd}, ${b.entregue_em}, ${devolver}, ${it.ca}, ${txt(b.observacao, 500)}, ${rh.sub})`;
      }
      return ok(res, { entregas: validos.length });
    }

    if (b.acao === 'devolver' || b.acao === 'cancelar') {
      const data = DIA.test(b.devolvido_em || '') ? b.devolvido_em : new Date().toISOString().slice(0, 10);
      const r = b.acao === 'devolver'
        ? await sql`UPDATE entrega SET estado='devolvida', devolvido_em=${data} WHERE id=${String(b.id || '')} AND empresa_id=${emp} AND estado <> 'cancelada' RETURNING id`
        : await sql`UPDATE entrega SET estado='cancelada' WHERE id=${String(b.id || '')} AND empresa_id=${emp} RETURNING id`;
      if (!r[0]) return erro(res, 404, 'ENTREGA_NAO_ENCONTRADA', 'entrega não encontrada');
      return ok(res, { id: r[0].id });
    }
    return erro(res, 400, 'CORPO_INVALIDO', 'acao inválida');
  });
}
