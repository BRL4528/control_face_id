// Emulacao do `sql` do @neondatabase/serverless sobre o driver `pg`.
//
// POR QUE ISTO EXISTE: servidor/persistencia/postgres.js fixa
// `const sql = neon(url)`, e o driver HTTP do Neon monta o endpoint a partir do
// host — apontar para um Postgres local devolve
// "Failed to parse URL from https://api.0.0.1/sql" (medido). Sem isto, o
// adaptador do API-3 so poderia ser exercitado contra Neon de verdade: nem em
// container descartavel, nem no CI, nem por quem o escreveu.
//
// Isto NAO e um segundo adaptador e nao substitui nada em producao. E uma peca
// de arnes que faz o adaptador REAL, sem uma linha alterada, falar com um
// Postgres qualquer. O que roda continua sendo o codigo do API-3.
//
// A costura definitiva e do outro lado e cabe numa linha —
// `criarRepositorioPostgres({ connectionString, sql })` com
// `const sql = sqlInjetado || neon(url)`. Enquanto ela nao existe, isto entra
// por baixo, via mock de modulo, sem pedir mudanca na vespera do teste.
//
// Formas de chamada que o adaptador usa (conferido: 40 e 7):
//   sql`SELECT ... ${valor}`        template tag
//   sql.query(texto, [valores])     SQL montado (SET dinamico)
// Nos dois casos o Neon devolve o ARRAY de linhas, nao um {rows}.
//
// A forma `sql(texto, valores)` NAO existe no driver do Neon, e o adaptador
// chegou a usa-la nos 7 metodos de SET dinamico — inclusive
// aprovarDispositivoPorCodigo, que gateia o teste. Teria lancado em execucao.
// Achado ao investigar por que este arnes nao conectava, e corrigido pelo
// API-3 em fdbd786. Por isso emular `sql(...)` aqui seria NOCIVO: aceitaria
// uma forma que a producao recusa, e o arnes ficaria verde sobre codigo que
// quebra no ar. A emulacao imita o driver, inclusive no que ele NAO aceita.

/** @param {import('pg').Pool} pool */
export function sqlSobrePg(pool) {
  async function sql(primeiro, ...resto) {
    if (typeof primeiro === 'string') {
      // Recusa deliberada: o driver do Neon nao aceita esta forma. Aceitar
      // aqui esconderia em teste um erro que so apareceria em producao.
      throw new TypeError(
        'sql(texto, valores) nao existe no driver do Neon — use sql`...` ou sql.query(texto, valores). ' +
        'Esta recusa e intencional: o arnes imita o driver, inclusive no que ele recusa.');
    }
    // Template tag: monta $1..$n na ordem das interpolacoes.
    let texto = primeiro[0];
    for (let i = 0; i < resto.length; i++) texto += '$' + (i + 1) + primeiro[i + 1];
    const r = await pool.query(texto, resto);
    return r.rows;
  }

  /** SQL montado em texto (SET dinamico). Devolve array de linhas, como o Neon. */
  sql.query = async (texto, valores) => (await pool.query(texto, valores || [])).rows;
  /** Texto cru sem parametros — mesma forma do driver. */
  sql.unsafe = async texto => (await pool.query(texto)).rows;

  return sql;
}
