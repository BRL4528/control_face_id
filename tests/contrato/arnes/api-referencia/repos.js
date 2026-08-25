// CALIBRAÇÃO DO ARNÊS — NÃO É A API DO PRODUTO.
//
// Estes repositórios existem por UMA razão: provar que os dois testes de
// corrida SABEM REPROVAR. Um teste que passa contra qualquer implementação não
// está medindo o que promete; a única forma de mostrar que ele mede é rodá-lo
// contra uma implementação que ele TEM de reprovar, e ver vermelho.
//
// Quem implementa a API de verdade é o API-3 (adaptador + migrations, contra
// `nucleo/repositorio.js`) e o API-4 (rotas). Nada aqui deve ser promovido,
// copiado ou importado por eles. É instrumento de aferição, e instrumento de
// aferição que vira produto deixa de aferir.
//
// ---------------------------------------------------------------------------
// POR QUE A CORRIDA É REAL, E NÃO ENCENADA
// ---------------------------------------------------------------------------
// A pergunta honesta sobre um teste de corrida é "você não plantou o `await`
// que faz o ingênuo perder?". Não. O `await` está lá porque `pg` fala TCP: no
// ingênuo, entre o SELECT e o INSERT há uma ida e volta de rede de verdade,
// e é ela que solta o event loop para a outra requisição entrar. Não há
// `setTimeout`, `sleep` nem `yield` em nenhum ingênuo deste arquivo.
//
// Foi por isso que o arnês roda em Postgres e não em `node:sqlite`: a API do
// `node:sqlite` é SÍNCRONA, o intervalo entre ler e gravar não existiria, e o
// ingênuo passaria — repetindo, num banco, exatamente a atomicidade de graça
// que o servidor falso ganha do Map. O arnês mediria o instrumento errado de
// novo, uma camada abaixo.
import crypto from 'node:crypto';

export const hashToken = t => crypto.createHash('sha256').update(String(t)).digest('hex');

// ===========================================================================
// MARCAÇÃO
// ===========================================================================
//
// As três variantes NÃO diferem só em código — diferem em ESQUEMA, e é esse o
// ponto. "Sem índice único, a dedup de marcação depende do cliente"
// (handoff da decisão, impossibilidade nº 2). Índice e código andam juntos:
// quem tem o índice escreve `on conflict`; quem não tem escreve `select` antes.

const COLUNAS = '(id_cliente, pessoa_id, marcado_em, requer_revisao, recebido_em)';
const VALORES = 'values ($1, $2, $3, $4, now())';

/** Índice único de verdade em id_cliente. */
const DDL_COM_INDICE = `
  create table if not exists marcacao (
    id_cliente     text primary key,
    pessoa_id      text        not null,
    marcado_em     timestamptz not null,
    requer_revisao boolean     not null default false,
    recebido_em    timestamptz not null default now()
  );`;

/** Sem índice nenhum — o banco não tem como recusar a segunda linha. */
const DDL_SEM_INDICE = `
  create table if not exists marcacao (
    id_cliente     text        not null,
    pessoa_id      text        not null,
    marcado_em     timestamptz not null,
    requer_revisao boolean     not null default false,
    recebido_em    timestamptz not null default now()
  );`;

/**
 * ATÔMICA — o que a API tem de fazer. Uma escrita; o índice único decide;
 * a rota lê o resultado. `inserida:false` é o `duplicado` do contrato.
 */
export const marcacaoAtomica = {
  nome: 'atomica',
  ddl: DDL_COM_INDICE,
  async inserirMarcacaoSeAusente(pool, m) {
    const r = await pool.query(
      `insert into marcacao ${COLUNAS} ${VALORES}
       on conflict (id_cliente) do nothing
       returning id_cliente`,
      [m.id_cliente, m.pessoa_id, m.marcado_em, !!m.requer_revisao]
    );
    return { inserida: r.rowCount === 1 };
  }
};

/**
 * INGÊNUA — o `if (existe) ... else grava` do servidor falso
 * (tests/e2e/servidor-falso.js:946 e :963) transposto para banco, SEM índice.
 * As duas requisições passam pelo SELECT juntas e as duas gravam: duas linhas,
 * dois `aceito`, ponto batido duas vezes. É o defeito trabalhista inteiro.
 */
export const marcacaoIngenua = {
  nome: 'ingenua',
  ddl: DDL_SEM_INDICE,
  async inserirMarcacaoSeAusente(pool, m) {
    const existe = await pool.query('select 1 from marcacao where id_cliente = $1', [m.id_cliente]);
    if (existe.rowCount > 0) return { inserida: false };
    await pool.query(
      `insert into marcacao ${COLUNAS} ${VALORES}`,
      [m.id_cliente, m.pessoa_id, m.marcado_em, !!m.requer_revisao]
    );
    return { inserida: true };
  }
};

/**
 * INGÊNUA COM ÍNDICE — a variante mais provável de nascer sem querer, e a
 * razão de ela estar aqui: o API-3 põe o índice único na migration (porque a
 * interface manda) e o API-4 porta a rota copiando o `if (existe)` do servidor
 * falso (porque é a fonte da verdade do comportamento). Cada metade está certa
 * sozinha.
 *
 * O dado fica salvo — o índice segura. Mas o perdedor da corrida leva uma
 * violação de unicidade, que vira 500, e 500 não é `duplicado`: o aparelho não
 * tira a marcação da fila e reenvia para sempre. Um teste que só conferisse
 * "quantas linhas ficaram no banco" daria VERDE aqui e deixaria passar.
 */
export const marcacaoIngenuaComIndice = {
  nome: 'ingenua-com-indice',
  ddl: DDL_COM_INDICE,
  async inserirMarcacaoSeAusente(pool, m) {
    const existe = await pool.query('select 1 from marcacao where id_cliente = $1', [m.id_cliente]);
    if (existe.rowCount > 0) return { inserida: false };
    await pool.query(
      `insert into marcacao ${COLUNAS} ${VALORES}`,
      [m.id_cliente, m.pessoa_id, m.marcado_em, !!m.requer_revisao]
    );
    return { inserida: true };
  }
};

// ===========================================================================
// CONVITE  —  ameaça 1.3
// ===========================================================================

const DDL_CONVITE = `
  create table if not exists convite (
    convite_id   text primary key,
    pessoa_id    text        not null,
    token_hash   text        not null unique,
    estado       text        not null,
    expira_em    timestamptz not null,
    consumido_em timestamptz
  );
  create table if not exists recadastro (
    template_id text primary key,
    pessoa_id   text        not null,
    convite_id  text        not null,
    criado_em   timestamptz not null default now()
  );`;

/**
 * ATÔMICA — compare-and-set. O estado só muda por um UPDATE condicionado ao
 * estado ANTERIOR, e a expiração entra na MESMA cláusula (conferir expiração
 * numa leitura anterior é a janela que o campo existe para fechar).
 *
 * Transação: consumir o convite e gravar o template são um fato só. CAS que
 * passa e template que falha consome o link sem cadastrar ninguém.
 */
export const conviteAtomico = {
  nome: 'atomica',
  ddl: DDL_CONVITE,
  async consumir(pool, { conviteId, agoraIso, templateId, pessoaId }) {
    const cx = await pool.connect();
    try {
      await cx.query('begin');
      const r = await cx.query(
        `update convite set estado = 'consumido', consumido_em = $2
          where convite_id = $1 and estado = any($3::text[]) and expira_em > $2
         returning convite_id`,
        [conviteId, agoraIso, ['emitido', 'aberto']]
      );
      if (r.rowCount !== 1) { await cx.query('rollback'); return { trocado: false }; }
      await cx.query(
        'insert into recadastro (template_id, pessoa_id, convite_id) values ($1, $2, $3)',
        [templateId, pessoaId, conviteId]
      );
      await cx.query('commit');
      return { trocado: true };
    } catch (e) {
      try { await cx.query('rollback'); } catch { /* conexão já foi */ }
      throw e;
    } finally {
      cx.release();
    }
  }
};

/**
 * INGÊNUA — lê o estado, decide em JS, grava depois. É a forma do servidor
 * falso (tests/e2e/servidor-falso.js:1597 lê `c`, :1660 grava `c.estado`), que
 * ali é segura só porque não existe `await` no meio.
 *
 * Aqui existe: o SELECT é rede. Duas requisições com o MESMO token veem
 * 'aberto' as duas, e as duas gravam template. É a ameaça 1.3 — cadastrar a
 * própria face no lugar de outro — viva, depois de a fase inteira ter sido
 * desenhada para fechá-la.
 */
export const conviteIngenuo = {
  nome: 'ingenua',
  ddl: DDL_CONVITE,
  async consumir(pool, { conviteId, agoraIso, templateId, pessoaId }) {
    const atual = await pool.query('select estado, expira_em from convite where convite_id = $1', [conviteId]);
    const linha = atual.rows[0];
    if (!linha) return { trocado: false };
    if (!['emitido', 'aberto'].includes(linha.estado)) return { trocado: false };
    if (new Date(linha.expira_em).getTime() <= Date.parse(agoraIso)) return { trocado: false };

    await pool.query(
      'insert into recadastro (template_id, pessoa_id, convite_id) values ($1, $2, $3)',
      [templateId, pessoaId, conviteId]
    );
    await pool.query(
      `update convite set estado = 'consumido', consumido_em = $2 where convite_id = $1`,
      [conviteId, agoraIso]
    );
    return { trocado: true };
  }
};

export const VARIANTES = {
  marcacao: [marcacaoAtomica, marcacaoIngenua, marcacaoIngenuaComIndice],
  convite: [conviteAtomico, conviteIngenuo]
};
