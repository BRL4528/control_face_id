// Fluxo de campo ponta a ponta: login, carga, fila, entrada/saída, cooldown,
// offline, idempotência e rejeição de colaborador inativo.
//
// O motor de reconhecimento roda em modo fingido — o que está sob teste é o
// FLUXO, não o face-api. Assim o resultado é determinístico e o CI não depende
// de foto de rosto real.
import { test, expect } from '@playwright/test';
import { subir } from './servidor-falso.js';

const TOKEN = 'TOKEN-TESTE';

async function abrir(page, base, pessoa) {
  await page.addInitScript(a => {
    window.__EFRAT_FAKE_FACE = { pessoa: a.pessoa };
    window.EFRAT_CFG = { apiBase: a.base + '/webhook' };   // config.js preserva isto
  }, { pessoa: pessoa || 'p-ana', base });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => !!window.__EFRAT, null, { timeout: 20000 });
}

async function logar(page, token = TOKEN) {
  await page.waitForSelector('#login:not(.hide)');
  await page.fill('#token', token);
  await page.click('#btnEntrar');
}

/** Troca de identidade sem recarregar a página. */
async function vira(page, pessoa) {
  await page.evaluate(p => { window.__EFRAT_FAKE_FACE.pessoa = p; }, pessoa);
}

/** Uma passagem pela fila: dispara captura, confirma e espera o comprovante. */
async function marcar(page) {
  await page.click('#btnFila');
  await page.waitForSelector('#btnConfirmar', { timeout: 20000 });
  const texto = await page.textContent('#cartao .tit');
  await page.click('#btnConfirmar');
  await page.waitForSelector('#btnProximo', { timeout: 20000 });
  const recibo = await page.textContent('#cartao');
  await page.click('#btnProximo');
  await page.click('#btnFila');   // para a câmera entre os casos
  return { nome: texto, recibo };
}

let ctx;
test.beforeEach(async () => { ctx = await subir(); });
test.afterEach(async () => { ctx.servidor.close(); });

test('token invalido nao entra', async ({ page }) => {
  await abrir(page, ctx.url);
  await logar(page, 'ERRADO');
  await expect(page.locator('#toast')).toContainText('token invalido', { timeout: 15000 });
  await expect(page.locator('#login')).not.toHaveClass(/hide/);
});

test('login carrega a unidade e mostra so a equipe do gestor', async ({ page }) => {
  await abrir(page, ctx.url);
  await logar(page);
  await page.waitForSelector('#app:not(.hide)');
  await expect(page.locator('#gestorNome')).toHaveText('Gestor Piloto');
  // eq-1 tem Ana, Bruno e o gestor, mais o sem-cadastro; Carla e da eq-2
  await expect(page.locator('#kpiMarcaram')).toHaveText('0/4');
  const carga = await page.evaluate(() => window.__EFRAT.S.carga.pessoas.length);
  expect(carga).toBe(4);   // a unidade inteira veio, incluindo a Carla
});

test('primeira marcacao e entrada e a segunda e saida', async ({ page }) => {
  await abrir(page, ctx.url, 'p-ana');
  await logar(page);
  await page.waitForSelector('#app:not(.hide)');

  const um = await marcar(page);
  expect(um.nome).toContain('Ana');
  expect(um.recibo).toContain('ENTRADA');

  // fora do cooldown
  await page.evaluate(() => { window.EFRAT_CFG.cooldownMs = 0; });
  const dois = await marcar(page);
  expect(dois.recibo).toContain('SAÍDA');

  const tipos = await page.evaluate(async () =>
    (await window.__EFRAT.Store.enviadas()).map(m => m.tipo).sort());
  expect(tipos).toEqual(['entrada', 'saida']);
});

test('cooldown bloqueia a mesma pessoa em sequencia', async ({ page }) => {
  await abrir(page, ctx.url, 'p-ana');
  await logar(page);
  await page.waitForSelector('#app:not(.hide)');
  await marcar(page);

  await page.click('#btnFila');
  await expect(page.locator('#cartao')).toContainText('já marcou', { timeout: 20000 });
  await expect(page.locator('#btnConfirmar')).toHaveCount(0);
});

test('rosto fora da galeria nao e reconhecido e oferece manual apos 3 falhas', async ({ page }) => {
  await abrir(page, ctx.url, 'desconhecido-total');
  await logar(page);
  await page.waitForSelector('#app:not(.hide)');
  await page.click('#btnFila');
  await expect(page.locator('#cartao')).toContainText('Não reconhecido', { timeout: 20000 });
  await page.waitForSelector('#btnManual', { timeout: 25000 });
  await page.click('#btnManual');
  await expect(page.locator('#listaPessoas')).toBeVisible();
});

test('registro manual exige motivo e vai marcado como manual', async ({ page }) => {
  await abrir(page, ctx.url, 'desconhecido-total');
  await logar(page);
  await page.waitForSelector('#app:not(.hide)');
  await page.click('#btnFila');
  await page.waitForSelector('#btnManual', { timeout: 25000 });
  await page.click('#btnManual');

  await page.click('#listaPessoas button:first-child');
  await expect(page.locator('#toast')).toContainText('motivo');

  await page.fill('#motivoManual', 'sem rosto legivel no sol');
  await page.click('#listaPessoas button:first-child');
  await page.waitForSelector('#btnProximo', { timeout: 20000 });

  const m = await page.evaluate(async () => {
    const f = await window.__EFRAT.Store.fila();
    const e = await window.__EFRAT.Store.enviadas();
    return f.concat(e)[0];
  });
  expect(m.origem).toBe('manual');
  expect(m.veredito).toBe('manual');
  expect(m.motivo).toContain('sol');
  expect(m.foto_auditoria === '' || typeof m.foto_auditoria === 'string').toBeTruthy();
});

test('offline enfileira e volta a subir quando a rede volta', async ({ page }) => {
  await abrir(page, ctx.url, 'p-ana');
  await logar(page);
  await page.waitForSelector('#app:not(.hide)');

  ctx.estado.fora = true;
  await marcar(page);
  await expect(page.locator('#kpiFila')).toHaveText('1', { timeout: 15000 });
  expect(ctx.estado.marcacoes.size).toBe(0);

  ctx.estado.fora = false;
  await page.evaluate(() => window.__EFRAT.sincronizar());
  await expect(page.locator('#kpiFila')).toHaveText('0', { timeout: 20000 });
  expect(ctx.estado.marcacoes.size).toBe(1);
});

test('reenvio do mesmo id_cliente nao duplica e limpa a fila', async ({ page }) => {
  await abrir(page, ctx.url, 'p-ana');
  await logar(page);
  await page.waitForSelector('#app:not(.hide)');
  await marcar(page);
  await expect(page.locator('#kpiFila')).toHaveText('0', { timeout: 20000 });
  expect(ctx.estado.marcacoes.size).toBe(1);

  // devolve a mesma marcação para a fila e manda de novo
  await page.evaluate(async () => {
    const m = (await window.__EFRAT.Store.enviadas())[0];
    await window.__EFRAT.Store.enfileirar(m);
  });
  await page.evaluate(() => window.__EFRAT.sincronizar());
  await expect(page.locator('#kpiFila')).toHaveText('0', { timeout: 20000 });
  expect(ctx.estado.marcacoes.size).toBe(1);   // continua uma so
});

test('envio unico em voo: nunca ha dois lotes simultaneos', async ({ page }) => {
  await abrir(page, ctx.url, 'p-ana');
  await logar(page);
  await page.waitForSelector('#app:not(.hide)');
  ctx.estado.fora = true;
  await page.evaluate(() => { window.EFRAT_CFG.cooldownMs = 0; });
  await marcar(page);
  await marcar(page);
  ctx.estado.fora = false;

  await page.evaluate(() => {
    window.__EFRAT.sincronizar();
    window.__EFRAT.sincronizar();
    window.__EFRAT.sincronizar();
  });
  await expect(page.locator('#kpiFila')).toHaveText('0', { timeout: 25000 });
  expect(ctx.estado.maxLotesSimultaneos).toBe(1);
});

test('colaborador inativo e rejeitado e a marcacao fica retida', async ({ page }) => {
  await abrir(page, ctx.url, 'p-ana');
  await logar(page);
  await page.waitForSelector('#app:not(.hide)');

  ctx.estado.fora = true;
  await marcar(page);
  ctx.estado.inativos.add('p-ana');       // demitida enquanto o lote esperava
  ctx.estado.fora = false;

  await page.evaluate(() => window.__EFRAT.sincronizar());
  await page.waitForFunction(async () => {
    const f = await window.__EFRAT.Store.fila();
    return f.length === 1 && !!f[0]._erro;
  }, null, { timeout: 20000 });

  const fila = await page.evaluate(() => window.__EFRAT.Store.fila());
  expect(fila[0]._erro).toContain('inativo');
  expect(ctx.estado.marcacoes.size).toBe(0);
});

test('ponto do proprio gestor sempre vai para revisao', async ({ page }) => {
  await abrir(page, ctx.url, 'p-gestor');
  await logar(page);
  await page.waitForSelector('#app:not(.hide)');
  await marcar(page);
  const m = await page.evaluate(async () => (await window.__EFRAT.Store.enviadas())[0]);
  expect(m.pessoa_id).toBe('p-gestor');
  expect(m.foto_auditoria.length).toBeGreaterThan(0);   // foto vai junto quando ha revisao
});

test('marcacao aceita nao carrega foto de auditoria', async ({ page }) => {
  await abrir(page, ctx.url, 'p-ana');
  await logar(page);
  await page.waitForSelector('#app:not(.hide)');
  await marcar(page);
  const m = await page.evaluate(async () => (await window.__EFRAT.Store.enviadas())[0]);
  expect(m.veredito).toBe('aceito');
  expect(m.foto_auditoria).toBe('');
});

test('remanejado aparece ao trocar o escopo para a unidade', async ({ page }) => {
  await abrir(page, ctx.url, 'p-carla');    // Carla e da eq-2
  await logar(page);
  await page.waitForSelector('#app:not(.hide)');

  await page.click('#btnFila');
  await expect(page.locator('#cartao')).toContainText('Não reconhecido', { timeout: 20000 });
  await page.click('#btnFila');

  await page.selectOption('#escopo', 'unidade');
  await page.click('#btnFila');
  await page.waitForSelector('#btnConfirmar', { timeout: 20000 });
  await expect(page.locator('#cartao .tit')).toContainText('Carla');
});

test('sessao sobrevive ao recarregar sem pedir token de novo', async ({ page }) => {
  await abrir(page, ctx.url, 'p-ana');
  await logar(page);
  await page.waitForSelector('#app:not(.hide)');
  await page.reload();
  await page.waitForFunction(() => !!window.__EFRAT);
  await page.waitForSelector('#app:not(.hide)', { timeout: 20000 });
  await expect(page.locator('#login')).toHaveClass(/hide/);
});
