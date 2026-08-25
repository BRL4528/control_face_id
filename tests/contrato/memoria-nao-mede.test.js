// POR QUE O ARNÊS EXIGE BANCO — a prova, e não a alegação.
//
// Motivo de existir: um adaptador em memória (`nucleo/memoria.js`) é a coisa
// mais natural do mundo para testar contra, e uma corrida rodada contra ele
// devolve VERDE com qualquer implementação. Já aconteceu neste projeto: 20
// aprovações concorrentes e 25 lotes concorrentes contra o adaptador em
// memória, "exatamente 1 vencedor, nunca dois". O número é verdadeiro e não
// prova nada — e é convincente, que é o que o torna perigoso.
//
// Este arquivo mede as DUAS implementações lado a lado. O mesmo
// `if (existe) ... else grava`, byte por byte. A única diferença é onde o dado
// mora. E as asserções são invertidas de propósito:
//
//   em memória -> exige VERDE, para documentar que o teste ali não pode falhar
//   em banco   -> exige VERMELHO, porque é lá que a janela de corrida existe
//
// A lição que isso fixa, e que nenhuma quantidade de concorrência muda: em
// memória a janela entre ler e gravar tem LARGURA ZERO (uma thread, nenhum
// `await` no meio). Subir de 20 para 200 concorrentes não ajuda — não é
// pressão insuficiente, é uma janela que não existe. Só mudar onde o dado mora
// abre a janela.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { subirBanco, motivoIndisponivel, politicaDeAusencia } from './arnes/banco.js';

const impedimento = await motivoIndisponivel();
const { opcoes: pular, reprovar } = politicaDeAusencia(impedimento);

const SIMULTANEAS = 25;
const RODADAS = 5;

let banco;
const medido = {};

/** @returns {{rodadasQuebradas: number, piorCaso: number}} */
async function medir(inserir, contar) {
  let rodadasQuebradas = 0, piorCaso = 0;
  for (let r = 0; r < RODADAS; r++) {
    const id = `mem-vs-banco-${r}-${Math.random().toString(36).slice(2, 10)}`;
    const res = await Promise.all(
      Array.from({ length: SIMULTANEAS }, () => inserir({ id_cliente: id, pessoa_id: 'ps-arnes' })));
    const aceitos = res.filter(x => x.inserida).length;
    piorCaso = Math.max(piorCaso, aceitos);
    if (aceitos !== 1 || await contar(id) !== 1) rodadasQuebradas++;
  }
  return { rodadasQuebradas, piorCaso };
}

before(async () => {
  if (impedimento) return;
  banco = await subirBanco();
  await banco.pool.query('drop table if exists marcacao_mem_vs_banco cascade');
  // Sem índice: o banco não tem como recusar a segunda linha. É o par honesto
  // do Map, que também não tem.
  await banco.pool.query('create table marcacao_mem_vs_banco (id_cliente text not null, pessoa_id text)');

  const mapa = new Map();
  medido.memoria = await medir(
    // `async` como um adaptador de verdade, mas SEM E/S: é justamente a
    // ausência de E/S entre o `has` e o `set` que fecha a janela.
    async m => {
      if (mapa.has(m.id_cliente)) return { inserida: false };
      mapa.set(m.id_cliente, m);
      return { inserida: true };
    },
    async id => (mapa.has(id) ? 1 : 0)
  );

  medido.banco = await medir(
    async m => {
      const existe = await banco.pool.query('select 1 from marcacao_mem_vs_banco where id_cliente=$1', [m.id_cliente]);
      if (existe.rowCount > 0) return { inserida: false };
      await banco.pool.query('insert into marcacao_mem_vs_banco (id_cliente, pessoa_id) values ($1,$2)', [m.id_cliente, m.pessoa_id]);
      return { inserida: true };
    },
    async id => (await banco.pool.query('select count(*)::int n from marcacao_mem_vs_banco where id_cliente=$1', [id])).rows[0].n
  );

  console.log(`\n[memoria-vs-banco] mesmo ler-depois-gravar, ${SIMULTANEAS} simultaneas, ${RODADAS} rodadas`);
  console.log(`  em MEMORIA: ${medido.memoria.rodadasQuebradas}/${RODADAS} quebradas | pior caso ${medido.memoria.piorCaso} vencedor(es)`);
  console.log(`  em BANCO:   ${medido.banco.rodadasQuebradas}/${RODADAS} quebradas | pior caso ${medido.banco.piorCaso} vencedor(es)`);
}, { timeout: 300000 });

after(async () => { if (banco) await banco.parar(); });

test('em memoria, a corrida NAO pega o ler-depois-gravar — verde vazio', pular, () => {
  if (reprovar) assert.fail(reprovar);
  assert.equal(
    medido.memoria.rodadasQuebradas, 0,
    'O adaptador em memoria REPROVOU. Se isso acontecer, esta licao mudou e o ' +
    'arquivo precisa ser relido antes de confiar em qualquer numero daqui.'
  );
  assert.equal(medido.memoria.piorCaso, 1, 'em memoria o esperado e sempre exatamente 1 vencedor');
});

test('no mesmo codigo, em banco, a corrida PEGA — a janela existe la', pular, () => {
  if (reprovar) assert.fail(reprovar);
  assert.equal(
    medido.banco.rodadasQuebradas, RODADAS,
    'O ler-depois-gravar passou em BANCO. Ou as requisicoes nao correram de ' +
    'verdade, ou o pool serializou — em qualquer dos casos, nenhum numero ' +
    'deste arnes vale ate isso ser entendido.'
  );
  assert.ok(
    medido.banco.piorCaso > 1,
    `esperava mais de um vencedor simultaneo em banco, veio ${medido.banco.piorCaso}`
  );
});
