// Importação de colaboradores por planilha (xlsx/xls/csv) — ex.: a planilha
// "Empregados" do RH do cliente. Duas etapas, sempre com prévia:
//
//   • acao 'analisar' { arquivo_b64, nome_arquivo }: lê a planilha NO SERVIDOR
//     (o parser não vai para o app do celular), acha a linha de cabeçalho,
//     mapeia as colunas por nome (Código/Matrícula, Nome, Local de alocação/Equipe,
//     Status) e devolve as linhas normalizadas + resumo (novos, atualizados,
//     equipes que seriam criadas, linhas ignoradas). Nada é gravado.
//   • acao 'importar' { linhas, criar_equipes }: upsert em lote por (empresa,
//     matrícula) num único INSERT via unnest — 1000 linhas em poucas queries,
//     dentro do teto de 15 s da function. Não mexe em biometria nem em escala.
//   • GET ?modelo=1: baixa a planilha MODELO (aba Colaboradores com exemplos +
//     aba Instruções), com os cabeçalhos exatos que o 'analisar' reconhece.
import XLSX from 'xlsx';
import { db, novoId } from '../_lib/db.js';
import { autenticarRh } from '../_lib/auth.js';
import { cors, ok, erro, corpo, exigeMetodo } from '../_lib/http.js';
import { sincronizarBloqueios } from '../_lib/dispositivos.js';

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_LINHAS = 5000;

// Cabeçalho → papel da coluna. Ordem importa: o primeiro que casar vence.
const MAPA = [
  ['matricula', /^(c[oó]digo|matr[ií]cula|id|registro)\b/i],
  ['nome',      /^nome(\s+completo)?$|^colaborador$|^funcion[aá]rio$|^empregado$/i],
  ['equipe',    /local\s+de\s+aloca|^equipe|^obra|^setor|^lota[çc][ãa]o/i],
  ['status',    /^status|^situa[çc][ãa]o|^ativo$/i],
  ['funcao',    /^fun[çc][ãa]o|^cargo/i]
];

function limpar(v) { return v == null ? '' : String(v).replace(/\s+/g, ' ').trim(); }
// Célula só com traço/ponto/"n/a" é placeholder de vazio, não um nome de equipe.
function textoOuNulo(v) { const t = limpar(v); return !t || /^[-–—._/]+$/.test(t) || /^(n\/a|na|nenhum[ao]?|sem)$/i.test(t) ? null : t; }

function mapearColunas(cab) {
  const cols = {};
  cab.forEach((h, i) => {
    const t = limpar(h);
    if (!t) return;
    for (const [papel, re] of MAPA) if (!(papel in cols) && re.test(t)) { cols[papel] = { indice: i, titulo: t }; break; }
  });
  return cols;
}

function ativoDe(status) {
  const s = limpar(status).toLowerCase();
  if (!s) return true;                       // sem coluna/valor: assume ativo
  return /^ativ/.test(s) || s === 'sim' || s === 's' || s === 'true' || s === '1';
}

/** Planilha → { colunas, linhas, ignoradas }. Puro; testável sem banco. */
export function analisarPlanilha(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false, raw: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error('planilha vazia');
  const matriz = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });

  // Cabeçalho = primeira linha com 3+ células preenchidas que contenha nome e matrícula.
  let iCab = -1, colunas = {};
  for (let i = 0; i < Math.min(matriz.length, 20); i++) {
    const c = mapearColunas(matriz[i] || []);
    if (matriz[i].filter(limpar).length >= 3 && c.nome && c.matricula) { iCab = i; colunas = c; break; }
  }
  if (iCab < 0) throw new Error('não achei as colunas de matrícula (Código) e Nome no cabeçalho');

  const linhas = [], ignoradas = [], vistas = new Map();
  for (let i = iCab + 1; i < matriz.length && linhas.length < MAX_LINHAS; i++) {
    const r = matriz[i] || [];
    const pega = p => colunas[p] ? limpar(r[colunas[p].indice]) : '';
    const matricula = pega('matricula').replace(/\.0+$/, '');
    const nome = pega('nome');
    if (!matricula && !nome) continue;                                  // linha em branco
    if (!matricula) { ignoradas.push({ linha: i + 1, nome, motivo: 'sem matrícula' }); continue; }
    if (!nome) { ignoradas.push({ linha: i + 1, matricula, motivo: 'sem nome' }); continue; }
    if (vistas.has(matricula)) { ignoradas.push({ linha: i + 1, matricula, nome, motivo: 'matrícula repetida (linha ' + vistas.get(matricula) + ')' }); continue; }
    vistas.set(matricula, i + 1);
    linhas.push({ linha: i + 1, matricula, nome, equipe: textoOuNulo(pega('equipe')), status: pega('status') || null,
                  ativo: ativoDe(pega('status')), funcao: textoOuNulo(pega('funcao')) });
  }
  const cols = {}; for (const k of Object.keys(colunas)) cols[k] = colunas[k].titulo;
  return { aba: wb.SheetNames[0], colunas: cols, linhas, ignoradas };
}

/** Planilha modelo para o RH preencher — cabeçalhos casam com MAPA. */
export function planilhaModelo() {
  const wb = XLSX.utils.book_new();
  const dados = XLSX.utils.aoa_to_sheet([
    ['Matrícula', 'Nome', 'Equipe', 'Status'],
    ['1001', 'MARIA DA SILVA', 'Obra Norte', 'Ativo'],
    ['1002', 'JOSÉ PEREIRA', 'Obra Norte', 'Ativo'],
    ['1003', 'ANA SOUZA', 'Escritório', 'Inativo']
  ]);
  dados['!cols'] = [{ wch: 12 }, { wch: 34 }, { wch: 26 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, dados, 'Colaboradores');
  const instr = XLSX.utils.aoa_to_sheet([
    ['Como preencher'],
    [''],
    ['Matrícula', 'Obrigatória. Identifica a pessoa: quem já existe com a mesma matrícula é ATUALIZADO, não duplicado. É também o que o colaborador digita ao ativar o ponto no celular.'],
    ['Nome', 'Obrigatório. Nome completo.'],
    ['Equipe', 'Opcional. Nome da equipe (obra, frente, setor). Se já existir uma equipe com esse nome, a pessoa entra nela; se não existir, o sistema oferece criar na prévia. Vazio = sem equipe (não tira de uma equipe já vinculada no sistema).'],
    ['Status', 'Opcional. "Ativo" ou "Inativo". Vazio = Ativo. Inativo não consegue bater ponto.'],
    [''],
    ['Regras', 'Linha sem matrícula ou sem nome é ignorada. Matrícula repetida na planilha: só a primeira vale. Biometria, escala e ajustes de dia nunca são alterados pela importação.'],
    ['Formato', 'Salve como .xlsx ou .csv. Só a primeira aba é lida. Os títulos das colunas podem ficar em qualquer ordem, mas mantenha os nomes (Matrícula/Código, Nome, Equipe/Local de alocação, Status).']
  ]);
  instr['!cols'] = [{ wch: 14 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(wb, instr, 'Instruções');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  const rh = autenticarRh(req);
  if (!rh) return erro(res, 401, 'SESSAO_INVALIDA', 'faça login novamente');

  if (req.method === 'GET') {
    if (!(req.query && req.query.modelo)) return erro(res, 400, 'CORPO_INVALIDO', 'use ?modelo=1');
    const buf = planilhaModelo();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="modelo-colaboradores.xlsx"');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).end(buf);
    return;
  }
  if (exigeMetodo(req, res, 'POST')) return;
  const b = corpo(req);
  const sql = db();

  if (b.acao === 'analisar') {
    if (!b.arquivo_b64) return erro(res, 400, 'CORPO_INVALIDO', 'arquivo_b64 obrigatório');
    const buf = Buffer.from(String(b.arquivo_b64), 'base64');
    if (buf.length > MAX_BYTES) return erro(res, 413, 'ARQUIVO_GRANDE', 'planilha acima de 4 MB');
    let an;
    try { an = analisarPlanilha(buf); }
    catch (e) { return erro(res, 400, 'PLANILHA_INVALIDA', 'não consegui ler a planilha: ' + e.message); }

    const mats = an.linhas.map(l => l.matricula);
    const existentes = mats.length ? await sql`SELECT matricula, nome, ativo FROM colaborador WHERE empresa_id=${rh.empresa_id} AND matricula = ANY(${mats}::text[])` : [];
    const porMat = new Map(existentes.map(e => [e.matricula, e]));
    const equipes = await sql`SELECT id, nome FROM equipe WHERE empresa_id=${rh.empresa_id} AND ativo=true`;
    const eqNomes = new Set(equipes.map(e => e.nome.toLowerCase()));
    const equipesNovas = [...new Set(an.linhas.filter(l => l.equipe && l.ativo).map(l => l.equipe))].filter(n => !eqNomes.has(n.toLowerCase())).sort();

    for (const l of an.linhas) l.existe = porMat.has(l.matricula);
    const resumo = {
      total: an.linhas.length,
      novos: an.linhas.filter(l => !l.existe).length,
      atualizados: an.linhas.filter(l => l.existe).length,
      inativos: an.linhas.filter(l => !l.ativo).length,
      com_equipe: an.linhas.filter(l => l.equipe).length,
      equipes_novas: equipesNovas,
      ignoradas: an.ignoradas
    };
    return ok(res, { aba: an.aba, colunas: an.colunas, linhas: an.linhas, resumo });
  }

  if (b.acao === 'importar') {
    const linhas = Array.isArray(b.linhas) ? b.linhas.slice(0, MAX_LINHAS) : [];
    if (!linhas.length) return erro(res, 400, 'CORPO_INVALIDO', 'nenhuma linha para importar');
    const criarEquipes = b.criar_equipes !== false;

    // 1) Equipes: cria as que faltam (por nome, sem diferenciar maiúsculas) e mapeia nome → id.
    const nomesEq = [...new Set(linhas.map(l => textoOuNulo(l.equipe)).filter(Boolean))];
    const antes = new Set((await sql`SELECT lower(nome) AS n FROM equipe WHERE empresa_id=${rh.empresa_id}`).map(e => e.n));
    if (criarEquipes && nomesEq.length) {
      const ids = nomesEq.map(() => novoId());
      await sql.query(
        `INSERT INTO equipe (id, empresa_id, nome)
         SELECT t.id, $1, t.nome FROM unnest($2::text[], $3::text[]) AS t(id, nome)
         WHERE NOT EXISTS (SELECT 1 FROM equipe e WHERE e.empresa_id=$1 AND lower(e.nome)=lower(t.nome))`,
        [rh.empresa_id, ids, nomesEq]);
    }
    const equipes = await sql`SELECT id, nome FROM equipe WHERE empresa_id=${rh.empresa_id} AND ativo=true`;
    const eqId = new Map(equipes.map(e => [e.nome.toLowerCase(), e.id]));

    // 2) Colaboradores em lote: novo insere; existente atualiza nome/ativo e só troca
    //    a equipe se a planilha trouxer uma (não apaga vínculo feito à mão no sistema).
    const ids = [], mats = [], nomes = [], eqs = [], ativos = [];
    for (const l of linhas) {
      const m = limpar(l.matricula), n = limpar(l.nome);
      if (!m || !n) continue;
      ids.push(novoId()); mats.push(m); nomes.push(n);
      const eqNome = textoOuNulo(l.equipe);
      eqs.push(eqNome ? (eqId.get(eqNome.toLowerCase()) || null) : null);
      ativos.push(l.ativo !== false);
    }
    const LOTE = 500; let criados = 0, atualizados = 0;
    for (let i = 0; i < ids.length; i += LOTE) {
      const r = await sql.query(
        `INSERT INTO colaborador (id, empresa_id, nome, matricula, papel, equipe_padrao, ativo)
         SELECT t.id, $1, t.nome, t.matricula, 'colaborador', t.equipe, t.ativo
         FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::boolean[]) AS t(id, matricula, nome, equipe, ativo)
         ON CONFLICT (empresa_id, matricula) DO UPDATE SET
           nome=EXCLUDED.nome, ativo=EXCLUDED.ativo,
           equipe_padrao=COALESCE(EXCLUDED.equipe_padrao, colaborador.equipe_padrao)
         RETURNING (xmax = 0) AS inserido`,
        [rh.empresa_id, ids.slice(i, i + LOTE), mats.slice(i, i + LOTE), nomes.slice(i, i + LOTE), eqs.slice(i, i + LOTE), ativos.slice(i, i + LOTE)]);
      for (const row of (r.rows || r)) { if (row.inserido) criados++; else atualizados++; }
    }
    await sincronizarBloqueios(sql, rh.empresa_id);   // Status 'Inativo' na planilha bloqueia o aparelho
    const equipesCriadas = criarEquipes ? nomesEq.filter(n => !antes.has(n.toLowerCase())).length : 0;
    return ok(res, { criados, atualizados, equipes_criadas: equipesCriadas, total: ids.length });
  }

  return erro(res, 400, 'CORPO_INVALIDO', "acao deve ser 'analisar' ou 'importar'");
}
