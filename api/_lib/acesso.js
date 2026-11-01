// Controle de acesso do painel no servidor. O perfil é lido do banco a cada
// requisição (não do token): usuário desativado ou com perfil trocado perde o
// acesso na hora. to_jsonb(u) faz a leitura funcionar antes da migração das
// colunas perfil/obras (aí todo mundo é administrador, como antes).
import { pode, obrasDe } from '../../js/acessos.js';
import { erro } from './http.js';

export async function acessoDe(sql, rh) {
  const [u] = await sql`SELECT ativo, to_jsonb(u)->>'perfil' AS perfil, to_jsonb(u)->'obras' AS obras
                        FROM usuario_rh u WHERE id=${rh.sub} AND empresa_id=${rh.empresa_id} LIMIT 1`;
  if (!u || !u.ativo) return null;
  return { perfil: u.perfil || null, obras: Array.isArray(u.obras) ? u.obras : [] };
}

/**
 * Barra a requisição sem permissão. Devolve o acesso (para escopo por obra) ou
 * null quando já respondeu 401/403.
 */
export async function exigeAcesso(res, sql, rh, modulo, editar) {
  const a = await acessoDe(sql, rh);
  if (!a) { erro(res, 401, 'SESSAO_INVALIDA', 'faça login novamente'); return null; }
  if (!pode(a, modulo, editar)) { erro(res, 403, 'SEM_PERMISSAO', 'seu perfil não tem acesso a esta função'); return null; }
  return a;
}

/** O colaborador está nas obras visíveis do acesso? (sempre, para quem não é por obra) */
export async function noEscopo(sql, acesso, empresaId, colaboradorId) {
  const obras = obrasDe(acesso);
  if (!obras) return true;
  const [c] = await sql`SELECT equipe_padrao FROM colaborador WHERE id=${colaboradorId} AND empresa_id=${empresaId} LIMIT 1`;
  return !!(c && obras.includes(c.equipe_padrao));
}

/**
 * O que /rh/dados manda para cada perfil (o painel calcula espelho e central no
 * cliente, então o que sai aqui é o que o perfil enxerga). A rota nem consulta o
 * que o perfil não vê.
 *
 *   marcacoes  batidas com GPS, foto e score: quem vê operação, ponto ou relatórios
 *   jornadas   idem (espelho, pendências, central)
 *   alocacoes  escala do dia e planos: só operação
 *   ocorrencias
 *     'completas'  quem tem o módulo ocorrências (com observação e as pendentes);
 *                  a observação de ATESTADO é dado de saúde: só sai para quem vê
 *                  'saude' (gestor de obra e SST recebem sem ela)
 *     'resumo'     quem vê ponto/relatórios/operação sem o módulo (leitura): só
 *                  { id, colaborador_id, tipo, inicio, fim, estado } das que não
 *                  estão pendentes, o bastante para o espelho mostrar férias e
 *                  atestado no dia, sem observação nem anexo
 *     null         nada (almox)
 */
export function visaoDados(acesso) {
  const vePonto = pode(acesso, 'operacao') || pode(acesso, 'ponto') || pode(acesso, 'relatorios');
  return {
    marcacoes: vePonto,
    jornadas: vePonto,
    alocacoes: pode(acesso, 'operacao'),
    ocorrencias: pode(acesso, 'ocorrencias') ? 'completas' : vePonto ? 'resumo' : null,
    observacaoAtestado: pode(acesso, 'saude')
  };
}

/** Recorta a lista de ocorrências conforme visaoDados(acesso).ocorrencias. */
export function ocorrenciasVisiveis(ocorrencias, visao) {
  const lista = Array.isArray(ocorrencias) ? ocorrencias : [];
  if (!visao || !visao.ocorrencias) return [];
  if (visao.ocorrencias === 'resumo') {
    return lista.filter(o => o.estado !== 'pendente')
      .map(({ id, colaborador_id, tipo, inicio, fim, estado }) => ({ id, colaborador_id, tipo, inicio, fim, estado }));
  }
  if (visao.observacaoAtestado) return lista;
  return lista.map(o => o.tipo === 'atestado' ? Object.assign({}, o, { observacao: null }) : o);
}
