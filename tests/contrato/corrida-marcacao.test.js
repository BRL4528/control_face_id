// ALVO 1 DO CARTÃO — marcação duplicada sob CONCORRÊNCIA REAL.
//
// Duas (aqui oito) requisições simultâneas com o mesmo `id_cliente`. Sequencial
// não prova nada: o servidor falso já passa sequencial, e passaria concorrente
// também, porque num `Map` não existe `await` entre o `has` e o `set`.
//
// Contrato conferido, nas DUAS metades:
//   respostas -> exatamente um `aceito`, o resto `duplicado`, nada mais
//   banco     -> exatamente UMA linha para aquele id_cliente
// Só a primeira metade deixa passar o 500 do índice-com-código-ingênuo; só a
// segunda deixa passar a resposta mentirosa. Ver calibracao.test.js.
//
// PARA VALER, ESTE TESTE PRECISA RODAR COM ARNES_ALVO=api. O padrão
// (referencia:atomica) mede a API de aferição, que é instrumento, não produto.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrirAlvo } from './arnes/alvo.js';
import { motivoIndisponivel, politicaDeAusencia } from './arnes/banco.js';
import { corridaMarcacao, relatar } from './arnes/corridas.js';

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
  veredito = await corridaMarcacao(alvo);
}, { timeout: 300000 });

after(async () => { if (alvo) await alvo.encerrar(); });

test('mesmo id_cliente em requisicoes simultaneas: um aceito, uma linha', pular, () => {
  if (reprovar) assert.fail(reprovar);
  assert.equal(veredito.quebrou, false, relatar(veredito));
});
