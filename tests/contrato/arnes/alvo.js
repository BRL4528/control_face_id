// O PONTO DE PLUGUE. É aqui que "a suíte de contrato aponta para a API real"
// deixa de ser frase e vira variável de ambiente.
//
//   ARNES_ALVO=referencia:atomica   (padrão) API de aferição, repositório atômico
//   ARNES_ALVO=referencia:ingenua               idem, ler-depois-gravar SEM índice
//   ARNES_ALVO=referencia:ingenua-com-indice    idem, ler-depois-gravar COM índice
//   ARNES_ALVO=api                  a API DE VERDADE do API-4:
//                                     API_BASE=https://...   origem das rotas
//                                     ARNES_PG_URL=postgres://...  o banco dela
//
// O modo `api` não existe para ser bonito no futuro — é o único modo cuja
// medição VALE. Os modos `referencia:*` existem para AFERIR O INSTRUMENTO
// (ver calibracao.test.js), não para provar coisa alguma sobre o produto.
//
// O QUE NÃO EXISTE AQUI, DE PROPÓSITO: um modo `falso`. Apontar o arnês para
// tests/e2e/servidor-falso.js seria pedir ao réu que assinasse o próprio
// laudo. Pior: ele PASSARIA -- num `Map` não há `await` entre o `has` e o
// `set` (servidor-falso.js:946 e :963), então a atomicidade que estamos
// medindo ele ganha de graça por ser uma thread só. O verde não diria nada
// sobre a API, e diria com muita confiança.
import pg from 'pg';
import { subirBanco } from './banco.js';
import { subirApiReferencia } from './api-referencia/servidor.js';
import { VARIANTES, hashToken } from './api-referencia/repos.js';
import crypto from 'node:crypto';

const PESSOA = 'ps-arnes';
const DISPOSITIVO = 'disp-arnes';

/**
 * Abre um alvo pronto para medição.
 * @param {string} [spec] sobrepõe ARNES_ALVO (usado pela calibração)
 */
export async function abrirAlvo(spec, bancoCompartilhado) {
  const alvo = spec || process.env.ARNES_ALVO || 'referencia:atomica';

  if (alvo === 'api') return await alvoApiReal();
  if (alvo.startsWith('referencia:')) {
    return await alvoReferencia(alvo.slice('referencia:'.length), bancoCompartilhado);
  }
  throw new Error(`ARNES_ALVO desconhecido: ${alvo}`);
}

/** A API de verdade (API-4) sobre o banco de verdade (API-2/API-3). */
async function alvoApiReal() {
  const base = process.env.API_BASE;
  const url = process.env.ARNES_PG_URL;
  if (!base) throw new Error('ARNES_ALVO=api exige API_BASE (a origem das rotas do API-4).');
  if (!url) {
    // Sem acesso ao banco não dá para contar linhas, e sem contar linhas o
    // teste perde metade do poder: sobra só a conferência de respostas, que
    // é justamente a metade cega para "gravou duas vezes".
    throw new Error('ARNES_ALVO=api exige ARNES_PG_URL — sem ler o banco, a corrida só confere respostas e fica cega para escrita dupla.');
  }
  const pool = new pg.Pool({ connectionString: url, max: 12 });
  return montar({
    nome: 'api-real',
    base,
    pool,
    procedencia: `API real em ${base}, banco em ${url.replace(/:[^:@/]+@/, ':***@')}`,
    encerrarExtra: async () => { await pool.end(); }
  });
}

/** A API de aferição: HTTP mínimo + banco real + a variante de repositório pedida. */
async function alvoReferencia(variante, bancoCompartilhado) {
  const repoMarcacao = VARIANTES.marcacao.find(r => r.nome === variante);
  const repoConvite = VARIANTES.convite.find(r => r.nome === variante)
    // 'ingenua-com-indice' é uma distinção só de marcação (índice único em
    // id_cliente). No convite a variante ingênua é uma só, e é ela que vale.
    || VARIANTES.convite.find(r => r.nome === 'ingenua');
  if (!repoMarcacao) throw new Error(`variante de referencia desconhecida: ${variante}`);

  // A calibração passa UM banco para as três variantes: subir um container por
  // variante triplicaria o tempo sem mudar nada do que está sendo medido.
  const banco = bancoCompartilhado || await subirBanco();
  const api = await subirApiReferencia({ pool: banco.pool, repoMarcacao, repoConvite });

  // As variantes diferem no ESQUEMA (com e sem índice único), então a tabela
  // da variante anterior tem de sair antes. Só acontece no modo `referencia`,
  // nunca no modo `api` — soltar `drop table` perto de um banco de produção é
  // o tipo de conveniência que se cobra uma vez só.
  await banco.pool.query('drop table if exists marcacao, recadastro, convite cascade');
  await banco.pool.query(repoMarcacao.ddl);
  await banco.pool.query(repoConvite.ddl);

  return montar({
    nome: `referencia:${variante}`,
    base: api.base,
    pool: banco.pool,
    procedencia: `API de aferencia (marcacao=${repoMarcacao.nome}, convite=${repoConvite.nome}) sobre Postgres real ${banco.proprio ? 'em container descartavel' : 'externo'}`,
    // Quem trouxe o banco é quem o derruba: alvo que fecha container
    // emprestado deixa as variantes seguintes sem banco.
    encerrarExtra: async () => { await api.encerrar(); if (!bancoCompartilhado) await banco.parar(); }
  });
}

/** Sondas de leitura e semeadura comuns aos dois modos. */
function montar({ nome, base, pool, procedencia, encerrarExtra }) {
  return {
    nome,
    base,
    pool,
    procedencia,
    pessoaSemeada: PESSOA,
    dispositivoSemeado: DISPOSITIVO,

    /** Cria um convite vivo e devolve o token CLARO (que só existe aqui). */
    async semearConviteAberto() {
      const conviteId = 'cv-' + crypto.randomUUID().slice(0, 8);
      const token = crypto.randomBytes(32).toString('base64url');
      await pool.query(
        `insert into convite (convite_id, pessoa_id, token_hash, estado, expira_em)
         values ($1, $2, $3, 'aberto', now() + interval '1 hour')`,
        [conviteId, PESSOA, hashToken(token)]
      );
      return { conviteId, token };
    },

    /** Linhas REALMENTE gravadas para este id_cliente. A metade que enxerga escrita dupla. */
    async contarMarcacoes(idCliente) {
      const r = await pool.query('select count(*)::int as n from marcacao where id_cliente = $1', [idCliente]);
      return r.rows[0].n;
    },

    /** Templates gravados por este convite. Mais de um = ameaça 1.3 viva. */
    async contarRecadastros(conviteId) {
      const r = await pool.query('select count(*)::int as n from recadastro where convite_id = $1', [conviteId]);
      return r.rows[0].n;
    },

    encerrar: encerrarExtra
  };
}
