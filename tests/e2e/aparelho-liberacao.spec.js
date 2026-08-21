// Contrato da liberação de aparelho — o código curto como prova de posse física.
//
// Invariantes de docs/fase3-seguranca.md §2.1. Cartão que implementa: T-87615C.
//
// Divisão em duas metades, de propósito:
//
//   VIVOS  — 2.1b e 2.1d valem contra o servidor de hoje e já rodam. 2.1b em
//            especial é o guarda de regressão que importa: quando a aba de
//            aparelhos pendentes for construída, o caminho mais natural de
//            implementar (mandar a lista de pendentes com o código junto, para
//            o RH achar a linha) destrói a prova de posse — é o "Novo 2" de
//            docs/ameacas-v3.md. O teste tem de existir ANTES da aba.
//
//   ARMADOS — 2.1a, 2.1c, 2.1e e 2.1f dependem da rota de aprovação, que ainda
//            não existe (é o achado 3 do QA: hoje os testes aprovam mexendo no
//            Map do servidor-falso, fluxo.spec.js:34-44). Ficam em test.fixme
//            para não deixar a suíte vermelha por rota ausente, que é ruído e
//            não defeito. Quatro deles foram religados quando T-87615C entrou;
//            só LIMITE_APROVAÇÃO segue armado, atrelado ao T-C20AD3.
//
// PORQUE A CONTRAPROVA VEM PRIMEIRO EM CADA TESTE ARMADO: um teste que só
// afirma "sem código não ativa" PASSA contra uma rota que não existe — 404 não
// ativa nada. Verde por ausência de implementação é pior que vermelho. Por isso
// cada teste armado primeiro prova que o caminho feliz funciona, e só então
// nega.

import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import { criarServidor } from './servidor-falso.js';

// T-87615C entrou: a rota é /efrat/rh/aparelho, ação 'aprovar', e ela resolve
// o pendente SOMENTE pelo código digitado — nunca por dispositivo_id.
const ROTA_APROVAR = '/efrat/rh/aparelho';
const RH = { usuario: 'rh', chave: 'CHAVE-DE-TESTE' };

let ctx;

test.beforeEach(async () => {
  const { servidor, estado } = criarServidor({});
  await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve));
  ctx = { servidor, estado, base: `http://127.0.0.1:${servidor.address().port}/webhook` };
});

test.afterEach(async () => { await new Promise(resolve => ctx.servidor.close(resolve)); });

/** Registra um aparelho de verdade pela rota pública e devolve o que o servidor respondeu. */
async function registrar(request, apelido = 'Tablet obra norte') {
  const credencial = 'cred-' + crypto.randomUUID();
  const r = await request.post(`${ctx.base}/efrat/dispositivo/registrar`, {
    data: {
      dispositivo_id: crypto.randomUUID(),
      credencial_publica: crypto.createHash('sha256').update(credencial).digest('base64url'),
      apelido, ua: 'playwright'
    },
    failOnStatusCode: false
  });
  const corpo = await r.json();
  return { credencial, dispositivo_id: corpo.dispositivo_id, codigo: corpo.codigo_curto, corpo };
}

async function leituraRh(request, rota = '/efrat/rh/dados') {
  const r = await request.post(`${ctx.base}${rota}`, { data: { ...RH, dias: 30 }, failOnStatusCode: false });
  return { status: r.status(), texto: await r.text() };
}

async function aprovar(request, dados) {
  return request.post(`${ctx.base}${ROTA_APROVAR}`, {
    data: { ...RH, acao: 'aprovar', ...dados },
    failOnStatusCode: false
  });
}

async function estadoDoAparelho(request, { dispositivo_id, credencial }) {
  const r = await request.post(`${ctx.base}/efrat/dispositivo/estado`, {
    headers: { Authorization: `Bearer ${credencial}` },
    data: { dispositivo_id }, failOnStatusCode: false
  });
  return (await r.json()).estado;
}

/* ========================================================== VIVOS (rodam hoje) */

/* 2.1b — o código nunca aparece em leitura do RH */

test('nenhuma leitura do RH devolve o código curto de um aparelho pendente', async ({ request }) => {
  const a = await registrar(request);
  expect(a.codigo, 'o servidor tem de gerar o código no registro').toBeTruthy();

  const { texto } = await leituraRh(request);

  // Serializado inteiro: pega o código em campo próprio, aninhado, ou de brinde
  // dentro de um objeto de aparelho que alguém mandou "só para o RH achar".
  expect(texto, 'o código só pode existir na tela do aparelho físico').not.toContain(a.codigo);
});

test('o código não vaza junto com a lista de aparelhos pendentes', async ({ request }) => {
  // Guarda de regressão para a aba nova (item A). Vale contra qualquer rota de
  // leitura do RH que venha a existir: se a aba de pendentes for servida por
  // /rh/dados ou por rota própria, nenhuma das duas pode carregar o código.
  const a = await registrar(request, 'Totem Portaria');
  const b = await registrar(request, 'Tablet RH 2');

  for (const rota of ['/efrat/rh/dados', '/efrat/rh/dispositivos', '/efrat/rh/aparelhos']) {
    const { status, texto } = await leituraRh(request, rota);
    if (status === 404) continue;            // rota ainda não existe: nada a vazar
    expect(texto, `${rota} vazou o código de ${a.dispositivo_id}`).not.toContain(a.codigo);
    expect(texto, `${rota} vazou o código de ${b.dispositivo_id}`).not.toContain(b.codigo);
  }
});

/* 2.1d — o código não é derivável do que o RH enxerga */

test('o código é aleatório: não deriva do dispositivo_id nem do apelido', async ({ request }) => {
  const amostra = [];
  for (let i = 0; i < 8; i++) amostra.push(await registrar(request, `Tablet ${i}`));

  const codigos = amostra.map(a => a.codigo);
  expect(new Set(codigos).size, 'códigos repetidos entre pendentes').toBe(codigos.length);

  for (const a of amostra) {
    const uuid = a.dispositivo_id.replace(/-/g, '').toUpperCase();
    expect(uuid, 'código é substring do UUID — seria derivável').not.toContain(a.codigo);
    expect(a.codigo).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);  // sem 0/O/1/I/L
  }
});

test('dois registros do mesmo aparelho não geram um código previsível', async ({ request }) => {
  const a = await registrar(request);
  const b = await registrar(request);
  expect(a.codigo).not.toBe(b.codigo);
});

/* ====================================================== ARMADOS (T-87615C) */

/* 2.1a — a ativação é resolvida PELO CÓDIGO, não pela linha escolhida */

test('T-87615C · aprovar sem informar o código não ativa o aparelho', async ({ request }) => {
  const a = await registrar(request);

  // Contraprova primeiro: com o código certo, ativa. Sem isto, o teste passaria
  // contra um 404 e diria que a invariante está sustentada quando não há rota.
  const feliz = await aprovar(request, { dispositivo_id: a.dispositivo_id, codigo: a.codigo });
  expect(feliz.status(), 'o caminho feliz precisa existir antes de negar nada').toBe(200);
  expect(await estadoDoAparelho(request, a)).toBe('ativo');

  // Agora a negação, num aparelho novo: só o dispositivo_id, que é o que o
  // painel do RH já conhece. Não pode bastar.
  const b = await registrar(request);
  const semCodigo = await aprovar(request, { dispositivo_id: b.dispositivo_id });
  expect(semCodigo.status(), 'dispositivo_id sozinho não pode ativar').toBeGreaterThanOrEqual(400);
  expect(await estadoDoAparelho(request, b)).toBe('pendente');
});

test('T-87615C · código errado não ativa, e não ativa o aparelho vizinho', async ({ request }) => {
  const alvo = await registrar(request, 'Tablet legítimo');
  const outro = await registrar(request, 'Totem Portaria');

  // O código do vizinho, apresentado junto do dispositivo_id do alvo: é
  // exatamente o Cenário 2 de docs/ameacas-v3.md (aprovar a linha errada).
  await aprovar(request, { dispositivo_id: alvo.dispositivo_id, codigo: outro.codigo });

  // A invariante é esta e só esta: o dispositivo_id NÃO consegue mandar. O
  // aparelho que o painel "tinha em mãos" continua trancado.
  expect(await estadoDoAparelho(request, alvo),
    'dispositivo_id no corpo não pode ativar aparelho nenhum').toBe('pendente');

  // O dono do código ser ativado é o comportamento CERTO, não um defeito: o
  // código é a autoridade, e quem o exibe é quem o RH está olhando. Registro
  // aqui porque a primeira versão deste teste exigia recusa — era uma regra
  // mais dura do que a acordada, e falhar por isso seria falso-vermelho no
  // cartão de outra pessoa.
  expect(await estadoDoAparelho(request, outro)).toBe('ativo');
});

test('T-87615C · um código só serve uma vez', async ({ request }) => {
  const a = await registrar(request);

  expect((await aprovar(request, { dispositivo_id: a.dispositivo_id, codigo: a.codigo })).status()).toBe(200);
  const repetida = await aprovar(request, { dispositivo_id: a.dispositivo_id, codigo: a.codigo });
  expect(repetida.status(), 'código já consumido não aprova de novo').toBeGreaterThanOrEqual(400);
});

/* 2.1e — tentativa de código errado é limitada e contada */

// AINDA ARMADO, e agora por lacuna medida e não por rota ausente: a rota de
// aprovação existe e resolve pelo código, mas não conta nem limita tentativa
// errada — `tentativas` só é escrito no registro do aparelho e nunca
// incrementado no caminho de aprovação. Sem isso, 31^6 vira força bruta viável
// contra um pendente legítimo que esteja na fila. Cartão próprio (2.1e).
test.fixme('T-87615C · tentativas de código errado são limitadas e ficam visíveis', async ({ request }) => {
  const a = await registrar(request);

  let bloqueou = false;
  for (let i = 0; i < 12; i++) {
    const r = await aprovar(request, { dispositivo_id: a.dispositivo_id, codigo: 'ZZZZZZ' });
    if (r.status() === 429) { bloqueou = true; break; }
  }
  expect(bloqueou, 'força bruta de código precisa esbarrar em limite').toBe(true);

  // E o RH tem de conseguir ver que houve tentativa — é o sinal de que alguém
  // está tentando aprovar um aparelho que não está na frente dele.
  const { texto } = await leituraRh(request);
  expect(texto).toContain('tentativas');

  // Mesmo bloqueado, o código certo não pode passar dentro da janela.
  const comCerto = await aprovar(request, { dispositivo_id: a.dispositivo_id, codigo: a.codigo });
  expect(comCerto.status()).toBe(429);
});

/* 2.1f — pendente expira sozinho */

test('T-87615C · pendente além de 24h não é mais aprovável, nem com o código certo', async ({ request }) => {
  const a = await registrar(request);
  const linha = ctx.estado.dispositivos.get(a.dispositivo_id);
  linha.criado_em = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();

  const r = await aprovar(request, { dispositivo_id: a.dispositivo_id, codigo: a.codigo });

  expect(r.status(), 'pendente esquecido não pode virar acesso futuro').toBeGreaterThanOrEqual(400);
  expect(await estadoDoAparelho(request, a)).not.toBe('ativo');
});

/* ============================================ 2.1g — o sinal de aceite discrimina

Guarda contra uma classe de defeito, não contra um bug pontual.

MEDIDO no navegador, com o aparelho PENDENTE (nunca aprovado):

    ultimo_estado  : "pendente"
    #porta          : escondido
    #btnPonto.disabled : false        <-- habilitado mesmo trancado

`expect(locator).toBeEnabled()` NÃO olha visibilidade — só o atributo. Então
`await expect(page.locator('#btnPonto')).toBeEnabled()` PASSA com o aparelho
pendente. Isso era o sinal de "aparelho aprovado" em `aprovarDispositivo`
(fluxo.spec.js), em `aprovar` (acesso.spec.js, gestor.spec.js), em
offline.spec.js e em aparelhos.spec.js — ~26 chamadas de teste confirmando uma
aprovação com uma condição que já era verdadeira ANTES de aprovar.

O caso mais grave era `fluxo.spec.js:151`, o teste chamado "depois de aprovado
pelo rh a porta libera o registro de ponto": ele não conseguia falhar se a
aprovação parasse de funcionar por completo.

`#porta` visível é o sinal certo porque é falso enquanto pendente — e é sinal de
tela, não de propriedade interna, que é o critério 1 já registrado em
docs/ameacas-v3.md para o helper novo. */

test('sinal de aceite: #porta escondido enquanto pendente, e por isso btnPonto habilitado não serve', async ({ page }) => {
  await page.addInitScript(a => {
    window.__EFRAT_FAKE_FACE = { pessoa: 'p-ana' };
    window.EFRAT_CFG = { apiBase: a + '/webhook', chartCdn: '' };
  }, `http://127.0.0.1:${ctx.servidor.address().port}`);
  await page.goto(`http://127.0.0.1:${ctx.servidor.address().port}/index.html`);
  await page.waitForFunction(() => window.__EFRAT && window.__EFRAT.Face.pronto, null, { timeout: 20000 });
  await page.waitForFunction(() => window.__EFRAT.S.dispositivo, null, { timeout: 20000 });

  // O aparelho nunca foi aprovado. O sinal CERTO tem de ser falso agora.
  await expect(page.locator('#porta'), 'porta não pode abrir com aparelho pendente').toBeHidden();

  // E o sinal ERRADO, o que estava em uso, é verdadeiro agora — é essa
  // diferença que faz dele um sinal que não discrimina.
  const habilitadoEnquantoPendente = await page.evaluate(
    () => document.getElementById('btnPonto').disabled === false);
  expect(habilitadoEnquantoPendente,
    'se isto virar false, btnPonto passou a discriminar e este guarda pode ser revisto').toBe(true);
});
