// Validações compartilhadas pelas rotas do RH.
//
//   • diaValido / horaValida: a regex sozinha deixa passar 2026-02-30 e 2026-13-45,
//     que estouram no Postgres como 500 com a mensagem do banco. Aqui o dia precisa
//     existir no calendário (ida e volta pelo Date em UTC).
//   • idsDaEmpresa / todosDaEmpresa: toda referência recebida no corpo (equipe_id,
//     colaborador_id, jornada_id...) é conferida contra a empresa do RH antes de
//     gravar. As FKs do banco não olham empresa_id, então sem isso a empresa B
//     podia ligar os registros dela a uma obra da empresa A.
//   • pessoasDistintas: recusa de ciência vale com duas testemunhas DIFERENTES.

const RX_DIA = /^\d{4}-\d{2}-\d{2}$/;
const RX_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 'YYYY-MM-DD' que existe no calendário (rejeita 2026-02-30, 2026-13-01). */
export function diaValido(s) {
  if (typeof s !== 'string' || !RX_DIA.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** 'HH:MM' de 00:00 a 23:59. */
export const horaValida = s => typeof s === 'string' && RX_HORA.test(s);

// Tabelas que podem ser referenciadas por id no corpo de uma rota do RH, com a
// coluna que diz se o registro está ativo. O nome da tabela nunca vem do cliente.
const TABELAS = {
  equipe:         'ativo',
  colaborador:    'ativo',
  jornada:        'ativa',
  local:          'ativo',
  plano_alocacao: 'ativo'
};

/** Lista de ids limpa: strings, sem vazios nem repetidos. */
export const listaDeIds = ids => [...new Set((Array.isArray(ids) ? ids : [ids]).filter(v => v != null && v !== '').map(String))];

/**
 * Dos `ids` informados, quais existem na tabela e são da empresa (com `ativos`,
 * só os ativos). Devolve um Set. Uma consulta só, qualquer que seja o tamanho.
 */
export async function idsDaEmpresa(sql, tabela, ids, empresaId, { ativos = false } = {}) {
  const colAtivo = TABELAS[tabela];
  if (!colAtivo) throw new Error('idsDaEmpresa: tabela não permitida: ' + tabela);
  const lista = listaDeIds(ids);
  if (!lista.length) return new Set();
  const filtroAtivo = ativos ? ` AND ${colAtivo} = true` : '';
  const r = await sql.query(`SELECT id FROM ${tabela} WHERE empresa_id = $1 AND id = ANY($2::text[])${filtroAtivo}`, [empresaId, lista]);
  const linhas = Array.isArray(r) ? r : (r && r.rows) || [];
  return new Set(linhas.map(l => l.id));
}

/**
 * Confere uma lista de referências. Devolve os ids que NÃO são da empresa
 * (vazio = tudo certo), para a rota responder 404 dizendo quais.
 */
export async function foraDaEmpresa(sql, tabela, ids, empresaId, opcoes) {
  const lista = listaDeIds(ids);
  if (!lista.length) return [];
  const validos = await idsDaEmpresa(sql, tabela, lista, empresaId, opcoes);
  return lista.filter(id => !validos.has(id));
}

/** Um id só: é da empresa? */
export async function daEmpresa(sql, tabela, id, empresaId, opcoes) {
  if (id == null || id === '') return false;
  return (await foraDaEmpresa(sql, tabela, [id], empresaId, opcoes)).length === 0;
}

/** Documento só com letras e dígitos, em minúsculas ('' quando não veio). */
export const documentoNormalizado = t => String((t && t.documento) || '').replace(/[^0-9a-z]/gi, '').toLowerCase();

/** Nome em minúsculas, sem acento e com os espaços reduzidos. */
export const nomeNormalizado = t => String((t && t.nome) || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Pessoas distintas de uma lista (testemunhas). Duas entradas são a mesma
 * pessoa quando o documento normalizado bate, ou quando o nome normalizado bate.
 */
export function pessoasDistintas(lista) {
  const out = [];
  const docs = new Set(), nomes = new Set();
  for (const t of Array.isArray(lista) ? lista : []) {
    const doc = documentoNormalizado(t), nome = nomeNormalizado(t);
    if ((doc && docs.has(doc)) || (nome && nomes.has(nome))) continue;
    if (doc) docs.add(doc);
    if (nome) nomes.add(nome);
    out.push(t);
  }
  return out;
}
