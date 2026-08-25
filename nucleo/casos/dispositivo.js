// Rotas de aparelho (dispositivo) que nao sao /efrat/marcacoes.

import { erroDe } from '../contexto.js';

// POST /efrat/carga — a carga de pessoas+templates que o aparelho baixa
// depois de ativo. docs/fase3-contrato.md §4.7; T-D3DC5C.
//
// Ambiguidade 2 do mapa (.central-agentes/handoffs/2026-08-25-mapa-25-rotas-api.md):
// o servidor falso tinha um ramo SEM `dispositivo_id` que devolvia uma carga
// fixa de demo, sem autenticacao nenhuma. Nao existe um so e2e que exercite
// esse ramo — nenhum spec chama /efrat/carga sem dispositivo_id (conferido
// por grep), acesso.spec.js so confere que a CONTAGEM de chamadas fica em 0
// (nunca o corpo da resposta anonima), e js/api.js:136 sempre manda
// dispositivo_id. Droppado aqui: a rota nasce exigindo AUTH.APARELHO, sem
// ramo demo. Reabrir o ramo demo e decisao do Orquestrador, nao inferencia
// minha de novo.
export async function obterCarga(ctx, req) {
  const erro = erroDe(ctx.cripto);
  const dispositivo = req.dispositivo;

  if (dispositivo.estado === 'pendente') {
    return { status: 403, corpo: erro('DISPOSITIVO_PENDENTE', 'dispositivo aguarda aprovacao') };
  }
  if (dispositivo.estado !== 'ativo') {
    return { status: 403, corpo: erro('DISPOSITIVO_INATIVO', 'dispositivo inativo') };
  }
  if (!dispositivo.equipes_ids || !dispositivo.equipes_ids.length) {
    return { status: 403, corpo: erro('DISPOSITIVO_SEM_ESCOPO', 'dispositivo sem equipes') };
  }

  // T-8ADD9C/§4.7: o app reporta o proprio modelo_id uma vez por sincronismo
  // — e o dado mais barato da secao, e forma a REFERENCIA (o modelo_id mais
  // recente visto no caminho do app). Tolerado ausente: cliente antigo nao
  // quebra o sincronismo por isso.
  //
  // Duas escritas, nao uma: definirReferenciaModeloApp SO move a referencia
  // (nucleo/memoria.js:336 -- de proposito, um metodo faz uma coisa).
  // registrarModeloObservado e quem alimenta a tabela de observacao
  // (primeira/ultima aparicao, origens) que o servidor falso pre-extracao
  // fazia nas DUAS junto (fechado no closure antigo `definirReferenciaModeloApp`).
  // Achado na auditoria dos blocos removidos (T-D3DC5C, pedido do
  // Orquestrador) -- nenhum e2e cobre estado.modelosObservados hoje, entao
  // essa perda era invisivel por construcao.
  if (req.corpo.modelo_id) {
    await ctx.repo.registrarModeloObservado(req.corpo.modelo_id, 'app', req.agoraIso);
    await ctx.repo.definirReferenciaModeloApp(req.corpo.modelo_id);
  }

  const pessoas = await ctx.repo.listarPessoas();
  return {
    status: 200,
    corpo: {
      ok: true, versao: dispositivo.configuracao_versao,
      gerado_em: req.agoraIso,
      escopo: { equipes_ids: [...dispositivo.equipes_ids] },
      pessoas: pessoas
        .filter(p => p.ativo && dispositivo.equipes_ids.includes(p.equipe_id))
        .map(p => ({
          pessoa_id: p.pessoa_id, nome: p.nome, equipe_id: p.equipe_id, papel: p.papel,
          template: { versao: p.versao, vetores: p.vetores }, miniatura: p.miniatura
        })),
      removidos_ids: [],
      request_id: ctx.cripto.uuid()
    }
  };
}
