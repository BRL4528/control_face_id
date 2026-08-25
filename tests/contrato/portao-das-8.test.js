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
//   4xx  -> a rota EXISTE e recusou a requisicao. E o esperado.
//   5xx  -> a rota esta ROTEADA mas NAO ESTA DE PE. Tambem reprova (ver abaixo).
//
// Confundir os dois primeiros e um erro que ele previne: 401 parece falha e e
// sucesso aqui; 404 parece "so falta configurar" e e a rota inexistente.
//
// O 5xx entrou depois, avisado pelo Orquestrador a partir de uma mina real de
// merge: o git junta dois consertos limpo, e SO PUBLICAR revela — a funcao
// quebra com FUNCTION_INVOCATION_FAILED em TODAS as rotas enquanto /api/saude
// continua VERDE. Com o criterio antigo ("qualquer coisa menos 404") o portao
// chamaria as 8 de PUBLICADAS enquanto nenhuma responde. Quarta vez no mesmo
// dia que um sinal tranquilizador aponta pro lugar errado.
// Um 503 ADAPTADOR_SEM_CHAVE_RH cai aqui tambem, e deve: rota roteada com
// adaptador quebrado nao e "de pe".
//
// ---------------------------------------------------------------------------
// DEFEITO QUE ESTE ARQUIVO JA TEVE, achado pelo API-1 — e da familia que o
// paragrafo acima descreve, uma camada ACIMA dela.
// ---------------------------------------------------------------------------
// Com Deployment Protection ligada, a Vercel responde 401 "Protected deployment"
// em TUDO — inclusive numa rota que nao existe (medido: 401 tambem em
// /webhook/efrat/rota-que-nao-existe-de-jeito-nenhum). Como 401 e o caso de
// SUCESSO declarado aqui, o portao daria VERDE nas 8 sem NUNCA ter alcancado a
// API. O sinal mais tranquilizador possivel apontando pro lugar errado, de novo.
//
// Duas defesas, e a primeira e a que generaliza:
//
//  1. CONTROLE NEGATIVO NO ALVO VIVO. Antes de julgar as 8, o portao pede uma
//     rota que com certeza NAO existe. Ela TEM de dar 404. Se nao der, a origem
//     nao sabe distinguir rota existente de inexistente e NENHUMA conclusao
//     sobre as 8 e possivel — a rodada e ANULADA, nao aprovada. Isso pega
//     protecao de plataforma, rewrite catch-all, WAF e pagina de erro de proxy,
//     nao so o caso da Vercel.
//  2. FORMA DO CORPO. Resposta que traz `protection` e da PLATAFORMA, nao da
//     API. Nenhuma resposta assim conta como rota publicada.
//
// A licao pra quem mexer aqui: a calibracao contra o servidor-falso (no fim
// deste arquivo) prova que o portao sabe ficar verde, mas NAO prova que ele
// sabe ficar vermelho CONTRA A ORIGEM DE VERDADE. Sao duas perguntas, e so a
// segunda depende de como aquela origem esta configurada hoje.
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
/** Rota que nao pode existir. Se ela nao der 404, a origem nao discrimina. */
const ROTA_INEXISTENTE = '/webhook/efrat/rota-que-nao-existe-de-jeito-nenhum';

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
let controleNegativo = null;
// Calibracao: o portao ja nasceu VERMELHO (8/8 nao publicadas) e um portao que
// nunca ficou verde pode estar quebrado NO SENTIDO VERDE -- por exemplo se a
// lista de rotas tivesse um erro de digitacao, ele acusaria 404 para sempre e
// pareceria estar funcionando. Aqui ele e apontado para um servidor que
// comprovadamente serve as 8, e EXIGE verde. E a mesma disciplina de
// calibracao.test.js: um alarme que grita para tudo nao esta medindo.
const calibracao = [];

/** @returns {{status: number|string, corpo: any}} */
async function bater(rota) {
  try {
    const r = await fetch(BASE.replace(/\/$/, '') + rota, {
      method: 'POST',
      headers: Object.assign(
        { 'content-type': 'application/json' },
        BYPASS ? { 'x-vercel-protection-bypass': BYPASS } : {}),
      body: '{}'
    });
    let corpo = null;
    try { corpo = JSON.parse(await r.text()); } catch { /* nao-JSON: fica null */ }
    return { status: r.status, corpo };
  } catch (e) {
    return { status: 'ERRO_REDE: ' + String(e.message).slice(0, 60), corpo: null };
  }
}

/** Resposta da PLATAFORMA (protecao), nao da API. */
const ehProtecao = x => !!(x.corpo && x.corpo.protection);

before(async () => {
  if (!BASE) return;

  // Controle negativo PRIMEIRO: sem ele, tudo abaixo pode ser ruido.
  controleNegativo = await bater(ROTA_INEXISTENTE);

  for (const rota of ROTAS) {
    medido.push(Object.assign({ rota }, await bater(rota)));
  }

  console.log(`\n[portao-das-8] ${BASE}`);
  console.log(`  controle negativo: ${controleNegativo.status}` +
    (controleNegativo.status === 404 ? ' (404 — a origem discrimina, medicao vale)'
                                     : ' <- NAO e 404: MEDICAO ANULADA'));
  for (const m of medido) {
    const veredito = ehProtecao(m) ? 'PROTECAO (nao alcancou a API)'
      : m.status === 404 ? 'NAO PUBLICADA'
      : typeof m.status === 'number' && m.status >= 500
        ? 'QUEBRADA: ' + (m.corpo?.erro?.codigo || m.corpo?.code || 'funcao falhou')
      : typeof m.status === 'number' ? 'publicada' : 'erro';
    console.log(`  ${String(m.status).padEnd(6)} ${veredito.padEnd(30)} ${m.rota}`);
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

test('controle negativo: a origem responde 404 numa rota inexistente', pular, () => {
  assert.ok(controleNegativo, 'controle negativo nao foi executado');
  assert.equal(
    ehProtecao(controleNegativo), false,
    'A origem respondeu com a pagina de PROTECAO da plataforma, nao com a API. ' +
    'Sem ARNES_BYPASS valido nada aqui alcanca a API, e o portao inteiro seria ' +
    'verde sem ter medido nada. Isto e "nao medi", nunca "esta publicado".'
  );
  assert.equal(
    controleNegativo.status, 404,
    `Uma rota que nao existe respondeu ${controleNegativo.status} em vez de 404. ` +
    'Entao esta origem NAO distingue rota existente de inexistente, e nenhuma ' +
    'conclusao sobre as 8 e possivel: a medicao esta ANULADA, nao aprovada. ' +
    'Causas tipicas: protecao de plataforma, rewrite catch-all, WAF, proxy.'
  );
});

test('as 8 rotas do primeiro turno estao publicadas (nenhuma 404)', pular, () => {
  // Depende do controle negativo: sem ele, "nenhuma 404" nao significa nada.
  assert.equal(controleNegativo && controleNegativo.status, 404,
    'controle negativo nao passou — veja o teste acima. Sem ele este resultado nao vale.');
  const daPlataforma = medido.filter(ehProtecao).map(m => m.rota);
  assert.deepEqual(daPlataforma, [],
    'respostas vieram da PROTECAO da plataforma, nao da API: ' + daPlataforma.join(', '));
  // 5xx ANTES de 404: rota roteada que explode e um estado diferente de rota
  // inexistente, e a mensagem tem de dizer qual dos dois, senao manda procurar
  // no lugar errado (roteamento vs. runtime).
  const quebradas = medido
    .filter(m => typeof m.status === 'number' && m.status >= 500)
    .map(m => `${m.rota} -> ${m.status} ${m.corpo?.erro?.codigo || m.corpo?.code || ''}`.trim());
  assert.deepEqual(
    quebradas, [],
    `${quebradas.length} rota(s) ROTEADAS mas QUEBRADAS (5xx). A rota existe e a funcao ` +
    'falhou — nao e problema de roteamento, e de runtime/deploy. Se /api/saude estiver ' +
    'verde ao mesmo tempo, e o caso classico: a saude nao exercita as rotas.\n  ' +
    quebradas.join('\n  ')
  );
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
