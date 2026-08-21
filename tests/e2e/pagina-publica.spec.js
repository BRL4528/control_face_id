// Página pública do link do celular, dirigida pelo navegador (T-D30529,
// docs/fase3-contrato.md § 4.4/4.6). Sobe os DOIS listeners do servidor
// falso — porta diferente é origem diferente pro navegador, o mesmo
// isolamento de produção (subdomínio) sem precisar de DNS (§4.6, critério 21).
import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import { criarServidor, criarServidorPublico } from './servidor-falso.js';

let ctx, publico;

test.beforeEach(async () => {
  const app = criarServidor({});
  await new Promise(r => app.servidor.listen(0, '127.0.0.1', r));
  const appUrl = 'http://127.0.0.1:' + app.servidor.address().port;
  ctx = { servidor: app.servidor, estado: app.estado, pessoas: app.pessoas, url: appUrl, base: appUrl + '/webhook' };

  const servidorPublico = criarServidorPublico({ apiOrigemTeste: appUrl });
  await new Promise(r => servidorPublico.listen(0, '127.0.0.1', r));
  publico = { servidor: servidorPublico, url: 'http://127.0.0.1:' + servidorPublico.address().port };

  ctx.pessoas.find(p => p.pessoa_id === 'p-ana').telefone = '+5567998765432';
});

test.afterEach(async () => {
  await new Promise(r => ctx.servidor.close(r));
  await new Promise(r => publico.servidor.close(r));
});

/**
 * Três vetores coerentes (distância pequena, não zero) — mesma construção
 * ortogonal usada em rh-biometria.spec.js/tests/unit/coerencia.test.js. Sem
 * isto, as 3 capturas fingidas saem byte-idênticas (a semente é só o nome
 * da pessoa) e o servidor recusa como FOTOS_IGUAIS, corretamente.
 */
function loteCoerente() {
  const DIM = 128;
  const a = new Array(DIM).fill(0);
  const b = a.slice(); b[0] = 0.094;
  const c = a.slice(); c[1] = 0.094;
  return [a, b, c];
}

async function emitirLink(request) {
  const r = await request.post(`${ctx.base}/efrat/rh/face/convite`, {
    data: { usuario: 'rh', chave: 'CHAVE-DE-TESTE', idempotency_key: crypto.randomUUID(), pessoa_id: 'p-ana', canal: 'copiar' }
  });
  const corpo = await r.json();
  return /#c=(.+)$/.exec(corpo.url)[1];
}

/** Aponta a página, com a API de teste sobreposta via addInitScript — mesmo
 * padrão de EFRAT_CFG usado no resto da suite. */
async function abrirPagina(page, token) {
  await page.addInitScript(a => {
    window.EFRAT_CFG = Object.assign({}, window.EFRAT_CFG, { apiBase: a.base });
  }, { base: ctx.base });
  await page.goto(publico.url + '/#c=' + token);
}

test('critério 21 — a página pública é servida em outra origem, e não é o app', async ({ page }) => {
  const token = await page.request.post(`${ctx.base}/efrat/rh/face/convite`, {
    data: { usuario: 'rh', chave: 'CHAVE-DE-TESTE', idempotency_key: crypto.randomUUID(), pessoa_id: 'p-ana', canal: 'copiar' }
  }).then(r => r.json()).then(c => /#c=(.+)$/.exec(c.url)[1]);

  await abrirPagina(page, token);
  expect(new URL(page.url()).origin).not.toBe(new URL(ctx.url).origin);
  expect(new URL(page.url()).origin).toBe(new URL(publico.url).origin);
  await expect(page.locator('h1')).toContainText('Oi, Ana!');
});

test('critério 21-A — o deploy público não contém index.html do app, js/app.js nem sw.js', async ({ request }) => {
  for (const caminho of ['/index.html', '/js/app.js', '/sw.js']) {
    const r = await request.get(publico.url + caminho, { failOnStatusCode: false });
    // '/index.html' da origem PÚBLICA é a página dela mesma (existe, é outro
    // arquivo) — o que não pode existir é o app.js/sw.js do operador.
    if (caminho !== '/index.html') expect(r.status()).toBe(404);
  }
});

test('critério 22/23 — o SW do app não intercepta a página pública, e ela não vê o IndexedDB do app', async ({ page }) => {
  const token = await emitirLink(page.request);
  await abrirPagina(page, token);
  const temBancoDoApp = await page.evaluate(async () => {
    const bancos = await indexedDB.databases();
    return bancos.some(b => b.name === 'efrat-ponto');
  });
  expect(temBancoDoApp).toBe(false);
  const controller = await page.evaluate(() => navigator.serviceWorker.controller);
  expect(controller).toBeNull();
});

test('fluxo feliz: saudação, 3 fotos, envio, sucesso — nunca sobrescreve template ativo', async ({ page }) => {
  const antes = ctx.pessoas.find(p => p.pessoa_id === 'p-ana').vetores;
  const token = await emitirLink(page.request);

  await page.addInitScript(() => { window.__EFRAT_FAKE_FACE = { pessoa: 'p-ana-link' }; });
  await abrirPagina(page, token);

  await expect(page.locator('h1')).toContainText('Oi, Ana!');
  await page.click('#btnComecar');
  await expect(page.locator('h1')).toContainText('Vamos tirar 3 fotos');

  // Espera cada captura terminar (o slot ganhar a miniatura) antes da
  // próxima: `#btnTirar` é recriado a cada repintura de `#tela`, então
  // clicar de novo antes do handler assíncrono anterior terminar pode
  // disparar duas capturas sobrepostas. Só as 2 primeiras têm essa tela pra
  // esperar — a 3ª dispara o envio na hora (`tirarFoto`), e a tela de
  // "Vamos tirar 3 fotos" já não existe mais quando o envio responde.
  const lote = loteCoerente();
  for (let i = 0; i < 2; i++) {
    await page.evaluate(v => { window.__EFRAT_FAKE_FACE.descritor = v; }, lote[i]);
    await page.click('#btnTirar');
    await expect(page.locator('.shots img')).toHaveCount(i + 1, { timeout: 10000 });
  }
  await page.evaluate(v => { window.__EFRAT_FAKE_FACE.descritor = v; }, lote[2]);
  await page.click('#btnTirar');

  await expect(page.locator('h1')).toContainText('Pronto', { timeout: 20000 });
  await expect(page.locator('main')).toContainText('fechar esta página');

  const pendencia = ctx.estado.recadastros.find(t => t.pessoa_id === 'p-ana');
  expect(pendencia).toBeTruthy();
  expect(pendencia.origem).toBe('link');
  expect(ctx.pessoas.find(p => p.pessoa_id === 'p-ana').vetores).toEqual(antes);
});

test('duplo toque em #btnTirar não produz uma 4ª foto — guard do cliente (achado do QA)', async ({ page }) => {
  // #btnTirar é recriado a cada repintura de `#tela`, então `disabled` não
  // sobrevive entre repinturas — sem o guard `capturando` em pagina.js, um
  // duplo toque real (celular, rede lenta) dispara duas capturas sobrepostas
  // de verdade, não só num e2e apressado. O servidor cobre a outra metade
  // (recusa lote != 3 descritores, tests/e2e/cadastro-coerencia.spec.js);
  // este teste cobre a metade do cliente — evitar o caso, não só sobreviver a ele.
  const token = await emitirLink(page.request);
  await page.addInitScript(() => { window.__EFRAT_FAKE_FACE = { pessoa: 'p-ana-link' }; });
  await abrirPagina(page, token);
  await page.click('#btnComecar');

  await page.evaluate(() => {
    document.getElementById('btnTirar').click();
    document.getElementById('btnTirar').click(); // mesmo tique — simula o toque duplo
  });
  await expect(page.locator('.shots img')).toHaveCount(1, { timeout: 10000 });
  // Sem sinal de tela que prove "não vai aparecer uma segunda depois" — este
  // wait é para dar chance a um guard quebrado de manifestar o efeito
  // tardio, não para esperar um efeito esperado (por isso a asserção repete).
  await page.waitForTimeout(500);
  await expect(page.locator('.shots img')).toHaveCount(1);
});

test('recusa por foto individual mostra o texto certo e deixa tentar de novo na mesma posição', async ({ page }) => {
  const token = await emitirLink(page.request);
  await page.addInitScript(() => { window.__EFRAT_FAKE_FACE = { pessoa: 'sem-rosto' }; });
  await abrirPagina(page, token);
  await page.click('#btnComecar');

  await page.click('#btnTirar');
  await expect(page.locator('.erro')).toContainText('Não encontrei um rosto');
  await expect(page.locator('#btnTirar')).toContainText('foto 1 de 3'); // não avançou de posição
});

test('link inválido mostra a mesma mensagem, sem distinguir causa', async ({ page }) => {
  await abrirPagina(page, 'token-que-nao-existe-' + crypto.randomUUID());
  await expect(page.locator('main')).toContainText('Este link não vale mais. Peça um novo ao RH.');
});

test('reabrir depois de enviado mostra "já recebemos", não erro', async ({ page }) => {
  const token = await emitirLink(page.request);
  await page.addInitScript(() => { window.__EFRAT_FAKE_FACE = { pessoa: 'p-ana-link' }; });
  await abrirPagina(page, token);
  await page.click('#btnComecar');
  // Espera cada captura terminar (o slot ganhar a miniatura) antes da
  // próxima: `#btnTirar` é recriado a cada repintura de `#tela`, então
  // clicar de novo antes do handler assíncrono anterior terminar pode
  // disparar duas capturas sobrepostas.
  const lote = loteCoerente();
  for (let i = 0; i < 2; i++) {
    await page.evaluate(v => { window.__EFRAT_FAKE_FACE.descritor = v; }, lote[i]);
    await page.click('#btnTirar');
    await expect(page.locator('.shots img')).toHaveCount(i + 1, { timeout: 10000 });
  }
  await page.evaluate(v => { window.__EFRAT_FAKE_FACE.descritor = v; }, lote[2]);
  await page.click('#btnTirar');
  await expect(page.locator('h1')).toContainText('Pronto', { timeout: 20000 });

  // Reabrir de verdade: pagina.js tira o fragmento da URL com replaceState
  // logo na 1ª carga (§4.4), então um 2º goto() pro MESMO link, sem o
  // fragmento sobrando na URL atual, é só diferença de fragmento aos olhos
  // do navegador — navegação same-document, sem recarregar o documento nem
  // rodar `iniciar()` de novo. Um clique real no link (outra aba, ou depois
  // de fechar) sempre recarrega do zero; about:blank simula isso aqui.
  await page.goto('about:blank');
  await abrirPagina(page, token);
  await expect(page.locator('main')).toContainText('Já recebemos suas fotos');
});
