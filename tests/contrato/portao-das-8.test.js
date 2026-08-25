// PORTAO DAS 8 — as rotas do primeiro turno estao PUBLICADAS e respondendo?
//
// Este arquivo existe por causa de um buraco que passou por QUATRO pessoas, e a
// forma do buraco importa mais que o buraco:
//
//   eu (QA) ............ chamava os casos de uso DIRETO (enviarLote, aprovar)
//   API-4 .............. fumaca in-process, via criarServidor()
//   API-3 .............. adaptador contra Postgres e contra Neon
//   API-2 .............. /api/saude, a unica funcao publicada
//
// Quatro medicoes honestas, todas verdes, e NENHUMA atravessava a Vercel.
// Resultado: em 25/08 as 8 rotas respondiam 404 em preview e em producao, com
// /api/saude devolvendo {"ok":true,"banco":"ok"} — o sinal mais tranquilizador
// possivel apontando para o lugar errado. Mesma familia do "0 linhas = verde
// confiante", uma camada acima.
//
// O QUE ELE MEDE, e so isto: a rota EXISTE do outro lado do HTTP. Nao mede
// comportamento — corpo vazio e sem credencial deve mesmo ser recusado. Por
// isso o criterio e "qualquer coisa MENOS 404":
//
//   404  -> a rota nao esta publicada. E o defeito que este arquivo cacamos.
//   400/401/403/422/429 -> a rota EXISTE e recusou a requisicao. E o esperado.
//
// Confundir os dois e o erro que ele previne: 401 parece falha e e sucesso
// aqui; 404 parece "so falta configurar" e e a rota inexistente.
//
// ORIGEM: ARNES_API_BASE. Sem ela, PULA com motivo declarado — nao inventa
// verde. Se a origem for protegida (preview da Vercel), ARNES_BYPASS carrega o
// cabecalho x-vercel-protection-bypass; NUNCA literal no codigo.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { criarServidor } from '../e2e/servidor-falso.js';

const BASE = process.env.ARNES_API_BASE;
const BYPASS = process.env.ARNES_BYPASS;

const pular = BASE ? {} : {
  skip: 'ARNES_API_BASE ausente — sem origem nao ha pilha HTTP para medir. ' +
        'Defina a origem da API (preview ou producao) para este portao valer.'
};

// As 8 do primeiro turno (decisao do Orquestrador em 25/08, apos o Designer
// achar que sem rh/face/cadastrar ninguem e reconhecivel e o teste morre no
// passo 3).
const ROTAS = [
  '/webhook/efrat/dispositivo/registrar',
  '/webhook/efrat/dispositivo/estado',
  '/webhook/efrat/rh/sal',
  '/webhook/efrat/rh/aparelhos',
  '/webhook/efrat/rh/aparelho/aprovar',
  '/webhook/efrat/rh/face/cadastrar',
  '/webhook/efrat/carga',
  '/webhook/efrat/marcacoes'
];

const medido = [];
// Calibracao: o portao ja nasceu VERMELHO (8/8 nao publicadas) e um portao que
// nunca ficou verde pode estar quebrado NO SENTIDO VERDE -- por exemplo se a
// lista de rotas tivesse um erro de digitacao, ele acusaria 404 para sempre e
// pareceria estar funcionando. Aqui ele e apontado para um servidor que
// comprovadamente serve as 8, e EXIGE verde. E a mesma disciplina de
// calibracao.test.js: um alarme que grita para tudo nao esta medindo.
const calibracao = [];

before(async () => {
  if (!BASE) return;
  for (const rota of ROTAS) {
    let status;
    try {
      const r = await fetch(BASE.replace(/\/$/, '') + rota, {
        method: 'POST',
        headers: Object.assign(
          { 'content-type': 'application/json' },
          BYPASS ? { 'x-vercel-protection-bypass': BYPASS } : {}),
        body: '{}'
      });
      status = r.status;
    } catch (e) {
      status = 'ERRO_REDE: ' + String(e.message).slice(0, 60);
    }
    medido.push({ rota, status });
  }
  console.log(`\n[portao-das-8] ${BASE}`);
  for (const m of medido) {
    const veredito = m.status === 404 ? 'NAO PUBLICADA' : (typeof m.status === 'number' ? 'publicada' : 'erro');
    console.log(`  ${String(m.status).padEnd(6)} ${veredito.padEnd(14)} ${m.rota}`);
  }
}, { timeout: 180000 });

let servidorLocal;

before(async () => {
  const criado = criarServidor({});
  servidorLocal = criado.servidor;
  await new Promise(r => servidorLocal.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidorLocal.address().port}`;
  for (const rota of ROTAS) {
    const r = await fetch(base + rota, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
    });
    calibracao.push({ rota, status: r.status });
  }
  const naoPublicadas = calibracao.filter(m => m.status === 404).length;
  console.log(`\n[portao-das-8 · calibracao] servidor que SERVE as 8: ${8 - naoPublicadas}/8 vistas como publicadas`);
}, { timeout: 120000 });

after(() => { if (servidorLocal) servidorLocal.close(); });

test('as 8 rotas do primeiro turno estao publicadas (nenhuma 404)', pular, () => {
  const ausentes = medido.filter(m => m.status === 404).map(m => m.rota);
  assert.deepEqual(
    ausentes, [],
    `${ausentes.length} de ${ROTAS.length} rotas respondem 404 — nao estao publicadas:\n  ` +
    ausentes.join('\n  ') +
    '\nUma rota 404 nao e "falta configurar": e a rota inexistente. Recusa por ' +
    'credencial (401/403) ou por corpo (400/422) contaria como publicada.'
  );
});

test('nenhuma rota falha por rede ou origem inalcancavel', pular, () => {
  const ruins = medido.filter(m => typeof m.status !== 'number');
  assert.deepEqual(ruins, [], 'origem inalcancavel: ' + JSON.stringify(ruins));
});

// ---------------------------------------------------------------------------
// A calibracao. Sem ela, "8/8 NAO PUBLICADA" poderia ser um defeito do portao
// (lista de rotas errada, metodo errado, base mal montada) em vez de um fato
// sobre a API -- e as duas coisas sao indistinguiveis olhando so o vermelho.
// ---------------------------------------------------------------------------
test('calibracao: contra um servidor que SERVE as 8, o portao fica verde', () => {
  const ausentes = calibracao.filter(m => m.status === 404).map(m => m.rota);
  assert.deepEqual(
    ausentes, [],
    'O portao acusou 404 contra um servidor que serve estas rotas. Entao o ' +
    'vermelho dele NAO prova nada sobre a API: prova que a lista de rotas, o ' +
    'metodo ou a montagem da URL estao errados aqui dentro.\n  ' + ausentes.join('\n  ')
  );
});
