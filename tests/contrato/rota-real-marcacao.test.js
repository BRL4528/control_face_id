// A CORRIDA CONTRA A ROTA DE VERDADE — nucleo/casos/marcacao.js, com banco real.
//
// As outras corridas medem a API de aferição, que é instrumento meu. Esta mede
// o codigo que vai para producao: `enviarLote` do API-4, sem uma linha alterada.
//
// O ATALHO QUE TORNA ISSO POSSIVEL HOJE, sem esperar o adaptador do API-3:
// `enviarLote(ctx, req)` e funcao de `ctx.repo`. Entao basta um repositorio
// HIBRIDO — o minimo que a rota chama, com as DUAS operacoes de marcacao
// apontando para Postgres de verdade. O resto do estado pode ficar em memoria
// sem prejuizo, porque a janela de corrida da marcacao mora inteira em
// `marcacaoExiste` + `inserirMarcacaoSeAusente`. Estado alheio em memoria nao
// cria nem esconde essa janela.
//
// O QUE ISTO PROVA: se a rota passa com repositorio atomico e reprova com
// repositorio ingenuo, entao a camada de rota esta correta e a unica peca em
// aberto e o REPOSITORIO. Isso isola a pergunta exatamente onde o API-3 esta
// trabalhando.
//
// O QUE ISTO NAO PROVA: a pilha HTTP inteira — `enviarLote` e chamada direto.
// Justo, porque a corrida nao mora no parsing de requisicao.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { subirBanco, motivoIndisponivel, politicaDeAusencia } from './arnes/banco.js';
import { enviarLote } from '../../nucleo/casos/marcacao.js';

const impedimento = await motivoIndisponivel();
const { opcoes: pular, reprovar } = politicaDeAusencia(impedimento);

const SIMULTANEAS = 8;
const RODADAS = 5;

const APARELHO = { dispositivo_id: 'disp-rota', estado: 'ativo', apelido: 'Aparelho de teste' };
const PESSOAS = [{ pessoa_id: 'ps-rota', nome: 'Pessoa Teste', papel: 'colaborador', ativo: true }];

/** O minimo que `enviarLote` chama. Marcacao em Postgres; o resto, constante. */
function repositorioHibrido(pool, inserir) {
  return {
    async lerDispositivo() { return Object.assign({}, APARELHO); },
    async listarPessoas() { return PESSOAS.map(p => Object.assign({}, p)); },
    async incrementarRetidasPosRevogacao() { return 1; },
    async marcacaoExiste(idCliente) {
      const r = await pool.query('select 1 from marcacao_rota where id_cliente = $1', [idCliente]);
      return r.rowCount > 0;
    },
    inserirMarcacaoSeAusente: m => inserir(pool, m)
  };
}

const inserirAtomico = async (pool, m) => {
  const r = await pool.query(
    `insert into marcacao_rota (id_cliente, pessoa_id, marcado_em) values ($1,$2,$3)
     on conflict (id_cliente) do nothing returning id_cliente`,
    [m.id_cliente, m.pessoa_id, m.marcado_em]
  );
  return { inserida: r.rowCount === 1, marcacao: m };
};

const inserirIngenuo = async (pool, m) => {
  const existe = await pool.query('select 1 from marcacao_rota where id_cliente = $1', [m.id_cliente]);
  if (existe.rowCount > 0) return { inserida: false, marcacao: m };
  await pool.query(
    'insert into marcacao_rota (id_cliente, pessoa_id, marcado_em) values ($1,$2,$3)',
    [m.id_cliente, m.pessoa_id, m.marcado_em]
  );
  return { inserida: true, marcacao: m };
};

let banco;
const medido = {};

async function medir(pool, inserir, ddl) {
  await pool.query('drop table if exists marcacao_rota cascade');
  await pool.query(ddl);
  const repo = repositorioHibrido(pool, inserir);
  const ctx = { repo, cripto: { uuid: () => 'x' }, cfg: {} };

  let rodadasQuebradas = 0, piorAceitos = 0;
  for (let r = 0; r < RODADAS; r++) {
    const idCliente = `rota-${r}-${Math.random().toString(36).slice(2, 10)}`;
    const agoraMs = Date.now();
    const req = {
      corpo: {
        dispositivo_id: APARELHO.dispositivo_id,
        marcacoes: [{ id_cliente: idCliente, pessoa_id: 'ps-rota', marcado_em: new Date(agoraMs).toISOString(), veredito: 'aceito' }]
      },
      agoraMs, agoraIso: new Date(agoraMs).toISOString()
    };

    const respostas = await Promise.all(
      Array.from({ length: SIMULTANEAS }, () => enviarLote(ctx, req)));
    const itens = respostas.map(x => x.corpo.resultados[0].status);
    const aceitos = itens.filter(s => s === 'aceito').length;
    const duplicados = itens.filter(s => s === 'duplicado').length;
    const linhas = (await pool.query('select count(*)::int n from marcacao_rota where id_cliente=$1', [idCliente])).rows[0].n;

    piorAceitos = Math.max(piorAceitos, aceitos);
    if (aceitos !== 1 || duplicados !== SIMULTANEAS - 1 || linhas !== 1) rodadasQuebradas++;
  }
  return { rodadasQuebradas, piorAceitos };
}

const DDL_COM = `create table marcacao_rota (
  id_cliente text primary key, pessoa_id text not null, marcado_em timestamptz not null)`;
const DDL_SEM = `create table marcacao_rota (
  id_cliente text not null, pessoa_id text not null, marcado_em timestamptz not null)`;

before(async () => {
  if (impedimento) return;
  banco = await subirBanco();
  medido.atomico = await medir(banco.pool, inserirAtomico, DDL_COM);
  medido.ingenuo = await medir(banco.pool, inserirIngenuo, DDL_SEM);
  console.log(`\n[rota-real] nucleo/casos/marcacao.js, ${SIMULTANEAS} simultaneas, ${RODADAS} rodadas`);
  console.log(`  repo ATOMICO: ${medido.atomico.rodadasQuebradas}/${RODADAS} quebradas | pior caso ${medido.atomico.piorAceitos} aceito(s)`);
  console.log(`  repo INGENUO: ${medido.ingenuo.rodadasQuebradas}/${RODADAS} quebradas | pior caso ${medido.ingenuo.piorAceitos} aceito(s)`);
}, { timeout: 300000 });

after(async () => { if (banco) await banco.parar(); });

test('a rota real segura a dedup quando o repositorio e atomico', pular, () => {
  if (reprovar) assert.fail(reprovar);
  assert.equal(
    medido.atomico.rodadasQuebradas, 0,
    `nucleo/casos/marcacao.js REPROVOU com repositorio atomico — o defeito estaria na CAMADA DE ROTA, ` +
    `nao no repositorio. Pior caso: ${medido.atomico.piorAceitos} aceitos simultaneos.`
  );
});

test('a mesma rota REPROVA quando o repositorio e ler-depois-gravar', pular, () => {
  if (reprovar) assert.fail(reprovar);
  assert.equal(
    medido.ingenuo.rodadasQuebradas, RODADAS,
    'A rota passou mesmo com repositorio ingenuo. Entao este teste nao esta medindo a ' +
    'atomicidade do repositorio, e o verde do teste acima nao significa o que promete.'
  );
});
