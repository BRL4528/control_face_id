// Advertências, notificações e acidentes de trabalho (catálogo em js/eventos.js).
//
//   { acao: 'listar' }                                   → todos, sem fotos
//   { acao: 'salvar', id?, colaborador_id, equipe_id, tipo, data, hora?, descricao, anexo?, dados? }
//        advertência/notificação nasce 'aguardando_ciencia' (vai para o app);
//        acidente nasce 'aguardando_cat'. dados: { testemunhas: [...], afastamento, obito }
//   { acao: 'cat', id, numero, data, anexo? }            → acidente concluído
//   { acao: 'recusa', id, testemunhas: [{ nome, documento }, ...], observacao? }
//        colaborador se recusou a dar ciência: vale com duas testemunhas
//   { acao: 'cancelar', id }
//   { acao: 'anexo', id, qual: 'anexo' | 'cat' }         → foto/documento
import { db, novoId } from '../_lib/db.js';
import { autenticarRh } from '../_lib/auth.js';
import { anexoValido } from '../_lib/ocorrencia.js';
import { comTabelaNova } from '../_lib/tabela-nova.js';
import { TIPOS_EVENTO } from '../../js/eventos.js';
import { exigeAcesso, noEscopo } from '../_lib/acesso.js';
import { obrasDe } from '../../js/acessos.js';
import { cors, ok, erro, corpo, exigeMetodo } from '../_lib/http.js';

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const txt = (v, n) => v == null ? '' : String(v).trim().slice(0, n);
const pessoasTexto = lista => (Array.isArray(lista) ? lista : []).map(t => ({ nome: txt(t && t.nome, 120), documento: txt(t && t.documento, 40) })).filter(t => t.nome).slice(0, 5);

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (exigeMetodo(req, res, 'POST')) return;
  const rh = autenticarRh(req);
  if (!rh) return erro(res, 401, 'SESSAO_INVALIDA', 'faça login novamente');
  const b = corpo(req);
  const sql = db();
  const emp = rh.empresa_id;
  const id = String(b.id || '');

  const leitura = !b.acao || b.acao === 'listar' || b.acao === 'anexo';
  const acesso = await exigeAcesso(res, sql, rh, 'eventos', !leitura);
  if (!acesso) return;
  const obras = obrasDe(acesso);   // gestor de obra: só as obras dele

  return comTabelaNova(res, async () => {
    if (obras && id) {
      const [e] = await sql`SELECT equipe_id FROM evento WHERE id=${id} AND empresa_id=${emp} LIMIT 1`;
      if (e && !obras.includes(e.equipe_id)) return erro(res, 403, 'SEM_PERMISSAO', 'registro fora das suas obras');
    }
    if (!b.acao || b.acao === 'listar') {
      const eventos = await sql`
        SELECT id, colaborador_id, equipe_id, tipo, to_char(data,'YYYY-MM-DD') AS data, hora, descricao, dados, estado,
               (anexo IS NOT NULL) AS tem_anexo, (cat_anexo IS NOT NULL) AS tem_cat, ciencia - 'foto' AS ciencia, criado_em
        FROM evento WHERE empresa_id=${emp} ORDER BY data DESC, criado_em DESC LIMIT 1000`;
      return ok(res, { eventos: obras ? eventos.filter(e => obras.includes(e.equipe_id)) : eventos });
    }

    if (b.acao === 'anexo') {
      const [e] = await sql`SELECT anexo, cat_anexo FROM evento WHERE id=${id} AND empresa_id=${emp} LIMIT 1`;
      if (!e) return erro(res, 404, 'EVENTO_NAO_ENCONTRADO', 'registro não encontrado');
      return ok(res, { anexo: (b.qual === 'cat' ? e.cat_anexo : e.anexo) || null });
    }

    if (b.acao === 'cancelar') {
      const r = await sql`UPDATE evento SET estado='cancelado' WHERE id=${id} AND empresa_id=${emp} RETURNING id`;
      if (!r[0]) return erro(res, 404, 'EVENTO_NAO_ENCONTRADO', 'registro não encontrado');
      return ok(res, { id, estado: 'cancelado' });
    }

    if (b.acao === 'cat') {
      if (!txt(b.numero, 40) || !DIA.test(b.data || '')) return erro(res, 400, 'CORPO_INVALIDO', 'número e data da CAT obrigatórios');
      if (b.anexo != null && !anexoValido(b.anexo)) return erro(res, 400, 'ANEXO_INVALIDO', 'foto inválida ou acima de 1 MB');
      const cat = { numero: txt(b.numero, 40), data: b.data, registrada_em: new Date().toISOString(), por: rh.nome || rh.usuario };
      const r = await sql`UPDATE evento SET estado='concluido', dados = dados || ${JSON.stringify({ cat })}::jsonb,
                            cat_anexo = COALESCE(${b.anexo || null}, cat_anexo)
                          WHERE id=${id} AND empresa_id=${emp} AND tipo='acidente' RETURNING id`;
      if (!r[0]) return erro(res, 404, 'EVENTO_NAO_ENCONTRADO', 'acidente não encontrado');
      return ok(res, { id, estado: 'concluido' });
    }

    if (b.acao === 'recusa') {
      const testemunhas = pessoasTexto(b.testemunhas);
      if (testemunhas.length < 2) return erro(res, 400, 'CORPO_INVALIDO', 'informe duas testemunhas');
      const recusa = { testemunhas, observacao: txt(b.observacao, 500), em: new Date().toISOString(), por: rh.nome || rh.usuario };
      const r = await sql`UPDATE evento SET estado='recusou', dados = dados || ${JSON.stringify({ recusa })}::jsonb
                          WHERE id=${id} AND empresa_id=${emp} AND estado='aguardando_ciencia' RETURNING id`;
      if (!r[0]) return erro(res, 409, 'EVENTO_JA_RESOLVIDO', 'este registro não está aguardando ciência');
      return ok(res, { id, estado: 'recusou' });
    }

    if (b.acao !== 'salvar') return erro(res, 400, 'CORPO_INVALIDO', 'acao inválida');
    const tipo = TIPOS_EVENTO[b.tipo];
    if (!tipo) return erro(res, 400, 'CORPO_INVALIDO', 'tipo inválido');
    if (!DIA.test(b.data || '')) return erro(res, 400, 'CORPO_INVALIDO', 'data obrigatória');
    const descricao = txt(b.descricao, 4000);
    if (!descricao) return erro(res, 400, 'CORPO_INVALIDO', 'descreva o que aconteceu');
    if (b.anexo != null && !anexoValido(b.anexo)) return erro(res, 400, 'ANEXO_INVALIDO', 'foto inválida ou acima de 1 MB');
    const [c] = await sql`SELECT id FROM colaborador WHERE id=${String(b.colaborador_id || '')} AND empresa_id=${emp} LIMIT 1`;
    if (!c) return erro(res, 404, 'COLABORADOR_NAO_ENCONTRADO', 'colaborador não encontrado');
    if (obras && (!obras.includes(b.equipe_id) || !(await noEscopo(sql, acesso, emp, c.id)))) return erro(res, 403, 'SEM_PERMISSAO', 'fora das suas obras');
    const equipeId = b.equipe_id ? String(b.equipe_id) : null;
    const d = b.dados || {};
    const dados = { testemunhas: pessoasTexto(d.testemunhas), afastamento: d.afastamento === true, obito: d.obito === true };
    const hora = /^\d{2}:\d{2}$/.test(b.hora || '') ? b.hora : null;

    if (id) {
      const mexeAnexo = b.anexo !== undefined;
      const r = await sql`UPDATE evento SET colaborador_id=${c.id}, equipe_id=${equipeId}, data=${b.data}, hora=${hora}, descricao=${descricao},
                            dados = dados || ${JSON.stringify(dados)}::jsonb,
                            anexo = CASE WHEN ${mexeAnexo} THEN ${b.anexo || null} ELSE anexo END
                          WHERE id=${id} AND empresa_id=${emp} AND estado <> 'cancelado' RETURNING id`;
      if (!r[0]) return erro(res, 404, 'EVENTO_NAO_ENCONTRADO', 'registro não encontrado');
      return ok(res, { id, atualizado: true });
    }
    const novo = novoId();
    await sql`INSERT INTO evento (id, empresa_id, colaborador_id, equipe_id, tipo, data, hora, descricao, anexo, dados, estado, criado_por)
              VALUES (${novo}, ${emp}, ${c.id}, ${equipeId}, ${b.tipo}, ${b.data}, ${hora}, ${descricao}, ${b.anexo || null},
                      ${JSON.stringify(dados)}::jsonb, ${tipo.cat ? 'aguardando_cat' : 'aguardando_ciencia'}, ${rh.sub})`;
    return ok(res, { id: novo, criado: true });
  });
}
