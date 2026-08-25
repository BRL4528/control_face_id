// A AFERIÇÃO DO INSTRUMENTO.
//
// Regra dura do cartão: "o teste tem que ser capaz de FALHAR contra uma
// implementação ler-depois-gravar. Se passar contra as duas implementações,
// ele não está medindo o que promete."
//
// Este arquivo é essa regra virada em teste automático, e não em parágrafo de
// relatório. Ele roda as DUAS corridas contra TRÊS implementações e exige:
//
//   atomica              -> VERDE nas duas. Índice único + compare-and-set.
//   ingenua              -> VERMELHA nas duas. Ler-depois-gravar, sem índice.
//   ingenua-com-indice   -> VERMELHA na marcação. O banco segura o dado, mas a
//                           resposta ao aparelho vira 500 em vez de `duplicado`.
//
// Repare no sentido das asserções nas duas últimas: aqui, PASSAR É FALHAR.
// Se um dia a corrida deixar de pegar o ingênuo, este arquivo fica vermelho e
// avisa que o instrumento cegou -- em vez de os testes de corrida ficarem
// verdes por não medirem mais nada, que é a falha silenciosa que o cartão
// manda evitar.
//
// Custo: sobe UM container de Postgres e o reaproveita nas três variantes.
// Não usa Playwright e não usa navegador -- não disputa a pista.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrirAlvo } from './arnes/alvo.js';
import { subirBanco, motivoIndisponivel, politicaDeAusencia } from './arnes/banco.js';
import { corridaMarcacao, corridaConvite, corridaAprovacao, relatar } from './arnes/corridas.js';

const impedimento = await motivoIndisponivel();
const { opcoes: pular, reprovar } = politicaDeAusencia(impedimento);

let banco;
const medido = {};

before(async () => {
  if (impedimento) return;
  banco = await subirBanco();

  for (const variante of ['atomica', 'ingenua', 'ingenua-com-indice']) {
    const alvo = await abrirAlvo(`referencia:${variante}`, banco);
    try {
      medido[variante] = {
        procedencia: alvo.procedencia,
        marcacao: await corridaMarcacao(alvo),
        convite: await corridaConvite(alvo),
        aprovacao: await corridaAprovacao(alvo)
      };
    } finally {
      await alvo.encerrar();
    }
    console.log(`\n[calibracao] ${variante}\n  ${relatar(medido[variante].marcacao)}\n  ${relatar(medido[variante].convite)}\n  ${relatar(medido[variante].aprovacao)}`);
  }
}, { timeout: 300000 });

after(async () => { if (banco) await banco.parar(); });

// ---------------------------------------------------------------------------
// 1. A implementação correta passa. Sem isto, o teste é só um alarme quebrado
//    que grita para tudo -- reprovar todo mundo não é medir.
// ---------------------------------------------------------------------------
test('atomica: marcacao duplicada NAO acontece sob concorrencia', pular, () => {
  if (reprovar) assert.fail(reprovar);
  assert.equal(medido.atomica.marcacao.quebrou, false, relatar(medido.atomica.marcacao));
});

test('atomica: convite NAO e consumido duas vezes em paralelo', pular, () => {
  if (reprovar) assert.fail(reprovar);
  assert.equal(medido.atomica.convite.quebrou, false, relatar(medido.atomica.convite));
});

test('atomica: um codigo de aprovacao NAO ativa por duas telas ao mesmo tempo', pular, () => {
  if (reprovar) assert.fail(reprovar);
  assert.equal(medido.atomica.aprovacao.quebrou, false, relatar(medido.atomica.aprovacao));
});

// ---------------------------------------------------------------------------
// 2. A implementação ler-depois-gravar REPROVA. É esta metade que dá valor à
//    de cima: verde contra a atômica só significa alguma coisa porque existe
//    uma implementação que fica vermelha.
// ---------------------------------------------------------------------------
test('ingenua: a corrida de marcacao PEGA o ler-depois-gravar', pular, () => {
  if (reprovar) assert.fail(reprovar);
  assert.equal(
    medido.ingenua.marcacao.quebrou, true,
    'A corrida de marcacao passou contra ler-depois-gravar SEM indice unico. ' +
    'O teste nao mede o que promete: ou as requisicoes nao chegaram simultaneas ' +
    '(pool serializando? poucas simultaneas?), ou a sonda de contagem de linhas cegou.'
  );
});

test('ingenua: a corrida de convite PEGA o ler-depois-gravar (ameaca 1.3)', pular, () => {
  if (reprovar) assert.fail(reprovar);
  assert.equal(
    medido.ingenua.convite.quebrou, true,
    'A corrida de convite passou contra ler-depois-gravar. Uso unico so vale sob ' +
    'corrida — se este teste nao pega o ingenuo, ele nao esta fechando a ameaca 1.3, ' +
    'esta so registrando que o caminho sequencial funciona.'
  );
});

test('ingenua-com-indice: indice unico salva o DADO, e o teste ainda reprova pela RESPOSTA', pular, () => {
  if (reprovar) assert.fail(reprovar);
  const v = medido['ingenua-com-indice'].marcacao;
  assert.equal(
    v.quebrou, true,
    'O indice unico segurou a linha e o teste deu verde. Um teste que so conta linhas ' +
    'aprova esta variante — e ela responde 500 ao aparelho em vez de `duplicado`, ' +
    'entao a marcacao nunca sai da fila do aparelho e e reenviada para sempre.'
  );
  // A prova de que reprovou pelo motivo CERTO: o dado ficou íntegro (uma linha
  // só, graças ao índice) e a quebra está na resposta. Sem esta conferência, a
  // asserção acima estaria satisfeita por qualquer quebra, inclusive por uma
  // linha duplicada — que é o defeito da OUTRA variante.
  const linhasSempreUm = v.quebras.every(q => q.linhas === 1);
  assert.equal(
    linhasSempreUm, true,
    'Esperava dado integro (1 linha) e falha so na resposta; vieram linhas duplicadas: ' + relatar(v)
  );
});

test('ingenua: a corrida de aprovacao PEGA o ler-depois-gravar (prova de posse)', pular, () => {
  if (reprovar) assert.fail(reprovar);
  const v = medido.ingenua.aprovacao;
  assert.equal(
    v.quebrou, true,
    'A corrida de aprovacao passou contra ler-depois-gravar. Sem ela, duas telas de RH ' +
    'aprovam o mesmo codigo de uso unico e a prova de posse fisica deixa de provar.'
  );
});
