// ALVO 3 — duas telas de RH aprovando o MESMO codigo ao mesmo tempo.
// §1.3, prova de posse fisica de uso unico. /rh/aparelho/aprovar esta nas 8
// rotas do primeiro turno, entao esta corrida GATEIA o teste de amanha.
//
// O dano aqui nao e linha duplicada — o aparelho e um so em qualquer caso.
// E o servidor MENTIR PARA O OPERADOR: as duas telas recebem 200 "aprovado",
// o aparelho fica com o escopo de uma delas, e a outra pessoa acredita ter
// liberado o aparelho para a equipe dela. A auditoria fica com duas respostas
// para "quem deixou este aparelho entrar".
//
// Por isso a assercao decisiva e COERENCIA e nao contagem: `aprovado_por` e
// `equipes_ids` persistidos tem de pertencer a quem recebeu o 200.
//
// PARA VALER, PRECISA RODAR COM ARNES_ALVO=api.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrirAlvo } from './arnes/alvo.js';
import { motivoIndisponivel, politicaDeAusencia } from './arnes/banco.js';
import { corridaAprovacao, relatar } from './arnes/corridas.js';

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
  veredito = await corridaAprovacao(alvo);
}, { timeout: 300000 });

after(async () => { if (alvo) await alvo.encerrar(); });

test('mesmo codigo em duas telas simultaneas: uma aprovacao, e o escopo e de quem ganhou', pular, () => {
  if (reprovar) assert.fail(reprovar);
  assert.equal(veredito.quebrou, false, relatar(veredito));
});
