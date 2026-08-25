// ALVO 2 DO CARTÃO — convite consumido DUAS VEZES em paralelo.
//
// Uso único só vale sob corrida. Sequencial, qualquer implementação acerta:
// a primeira consome, a segunda vê 'consumido' e recusa. A ameaça 1.3
// (cadastrar a própria face no lugar de outro) morre ou vive AQUI, no caso em
// que as duas requisições leem 'aberto' juntas.
//
// Contrato conferido, nas DUAS metades:
//   respostas -> exatamente um 200 `recebido`, o resto 409 CONVITE_CONSUMIDO
//   banco     -> exatamente UM template gravado para aquele convite
// A segunda metade é a que importa para a ameaça: duas respostas 200 são
// visíveis, mas dois templates gravados são o dano.
//
// PARA VALER, ESTE TESTE PRECISA RODAR COM ARNES_ALVO=api.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrirAlvo } from './arnes/alvo.js';
import { motivoIndisponivel, politicaDeAusencia } from './arnes/banco.js';
import { corridaConvite, relatar } from './arnes/corridas.js';

const impedimento = await motivoIndisponivel();
const { opcoes: pular, reprovar } = politicaDeAusencia(impedimento);

let alvo, veredito;

before(async () => {
  if (impedimento) return;
  alvo = await abrirAlvo();
  console.log(`[arnes] procedencia: ${alvo.procedencia}`);
  if (alvo.nome !== 'api-real') {
    console.log('[arnes] AVISO: alvo de AFERICAO, nao a API do produto. Verde aqui NAO e prova sobre a API. Use ARNES_ALVO=api.');
  }
  veredito = await corridaConvite(alvo);
}, { timeout: 300000 });

after(async () => { if (alvo) await alvo.encerrar(); });

test('mesmo token em requisicoes simultaneas: um recebido, um template', pular, () => {
  if (reprovar) assert.fail(reprovar);
  assert.equal(veredito.quebrou, false, relatar(veredito));
});
