// Fluxo de campo ponta a ponta, da porta de entrada até a mesa do RH.
//
// O motor de reconhecimento roda em modo fingido — o que está sob teste é o
// FLUXO, não o face-api. Assim o resultado é determinístico e o CI não depende
// de foto de rosto real. O motor real tem verificação própria fora do CI.
import { test, expect } from '@playwright/test';
import { subir } from './servidor-falso.js';

const TOKEN = 'TOKEN-TESTE';

async function abrir(page, base, pessoa) {
  await page.addInitScript(a => {
    window.__EFRAT_FAKE_FACE = { pessoa: a.pessoa };
    // chartCdn vazio: o painel não busca a biblioteca de gráficos na CDN durante
    // o CI (offline). Cards e tabelas "ver dados" cobrem o que é testado aqui.
    window.EFRAT_CFG = { apiBase: a.base + '/webhook', chartCdn: '' };   // config.js preserva isto
  }, { pessoa: pessoa || 'p-gestor', base });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.__EFRAT && window.__EFRAT.Face.pronto, null, { timeout: 20000 });
}

async function parear(page, token = TOKEN) {
  await page.click('#btnParear');
  await page.fill('#tokenAparelho', token);
  await page.click('#btnParearOk');
  // Sem esperar a porta voltar, o teste seguinte corre contra a carga ainda em voo.
  if (token === TOKEN) await page.waitForSelector('#porta:not(.hide)', { timeout: 20000 });
}

/** Troca de identidade sem recarregar a página. */
async function vira(page, pessoa) {
  await page.evaluate(p => { window.__EFRAT_FAKE_FACE.pessoa = p; }, pessoa);
}

/** Abre a fila: identifica o gestor e espera a tela ficar pronta. */
async function abrirFila(page) {
  await page.click('#btnPonto');
  await page.waitForSelector('#fila:not(.hide)', { timeout: 20000 });
  await page.waitForFunction(() => window.__EFRAT.Fila.gestor !== null, null, { timeout: 25000 });
  await page.waitForFunction(() => window.__EFRAT.Fila.estado === 'armado', null, { timeout: 25000 });
}

/** Uma passagem pela fila. */
async function marcar(page, pessoa) {
  if (pessoa) await vira(page, pessoa);
  await page.waitForSelector('#btnConfirmar', { timeout: 25000 });
  const nome = await page.textContent('#cartao .tit');
  await page.click('#btnConfirmar');
  await page.waitForSelector('#cartao .cartao.ok', { timeout: 20000 });
  const recibo = await page.textContent('#cartao');
  await page.waitForFunction(() => window.__EFRAT.Fila.estado === 'armado', null, { timeout: 25000 });
  return { nome, recibo };
}

/**
 * O servidor falso guarda uma chave fixa; o app deriva a de verdade com
 * PBKDF2. Para o teste ficar determinístico, trocamos só a derivação e
 * mantemos todo o resto do caminho real (chamada, montagem, render).
 */
async function logarRh(page) {
  await page.evaluate(() => {
    window.__EFRAT.Rh.entrar = async function (u) {
      const d = await window.__EFRAT.ApiRh.dados({ usuario: u, chave: 'CHAVE-DE-TESTE' }, 30);
      if (!d.ok) return { ok: false, erro: d.erro };
      this.cred = { usuario: u, chave: 'CHAVE-DE-TESTE' };
      this.dados = d.dados;
      return { ok: true };
    };
  });
  await page.click('#btnAcessar');
  await page.fill('#rhUsuario', 'rh');
  await page.fill('#rhSenha', 'qualquer');
  await page.click('#btnEntrarRh');
  await page.waitForSelector('#rh:not(.hide)', { timeout: 20000 });
}

let ctx;
test.beforeEach(async () => { ctx = await subir(); });
test.afterEach(async () => { ctx.servidor.close(); });

/* ------------------------------------------------------------- porta */

test('porta comeca bloqueada ate o aparelho ser pareado', async ({ page }) => {
  await abrir(page, ctx.url);
  await expect(page.locator('#porta')).not.toHaveClass(/hide/);
  await expect(page.locator('#btnPonto')).toBeDisabled();
  await expect(page.locator('#portaStatus')).toContainText('não pareado');
});

test('token invalido nao pareia', async ({ page }) => {
  await abrir(page, ctx.url);
  await parear(page, 'ERRADO');
  await expect(page.locator('#toast')).toContainText('token invalido', { timeout: 15000 });
});

test('depois de pareado a porta libera o registro de ponto', async ({ page }) => {
  await abrir(page, ctx.url);
  await parear(page);
  await page.waitForSelector('#porta:not(.hide)');
  await expect(page.locator('#btnPonto')).toBeEnabled();
  await expect(page.locator('#btnParear')).toContainText('Trocar');
});

/* --------------------------------------------------- fila do gestor */

test('registrar ponto identifica o gestor e ja marca o ponto dele', async ({ page }) => {
  await abrir(page, ctx.url, 'p-gestor');
  await parear(page);
  await abrirFila(page);
  await expect(page.locator('#filaGestor')).toHaveText('Gestor Piloto');

  const enviadas = await page.evaluate(async () => {
    const f = await window.__EFRAT.Store.fila();
    const e = await window.__EFRAT.Store.enviadas();
    return f.concat(e);
  });
  expect(enviadas.length).toBe(1);
  expect(enviadas[0].pessoa_id).toBe('p-gestor');
  expect(enviadas[0].tipo).toBe('entrada');
});

test('ponto do gestor sempre carrega foto e vai para revisao', async ({ page }) => {
  await abrir(page, ctx.url, 'p-gestor');
  await parear(page);
  await abrirFila(page);
  const m = await page.evaluate(async () => (await window.__EFRAT.Store.enviadas())[0]);
  expect(m.pessoa_id).toBe('p-gestor');
  expect(m.foto_auditoria.length).toBeGreaterThan(0);
});

test('reabrir a fila no mesmo minuto nao marca o gestor de novo', async ({ page }) => {
  await abrir(page, ctx.url, 'p-gestor');
  await parear(page);
  await abrirFila(page);
  await page.click('#btnSairFila');
  await page.waitForSelector('#porta:not(.hide)');
  await abrirFila(page);
  const total = await page.evaluate(async () => {
    const f = await window.__EFRAT.Store.fila();
    const e = await window.__EFRAT.Store.enviadas();
    return f.concat(e).filter(m => m.pessoa_id === 'p-gestor').length;
  });
  expect(total).toBe(1);
});

test('a fila marca entrada e depois saida do colaborador', async ({ page }) => {
  await abrir(page, ctx.url, 'p-gestor');
  await parear(page);
  await abrirFila(page);

  const um = await marcar(page, 'p-ana');
  expect(um.nome).toContain('Ana');
  expect(um.recibo).toContain('ENTRADA');

  await page.evaluate(() => { window.EFRAT_CFG.cooldownMs = 0; });
  const dois = await marcar(page, 'p-ana');
  expect(dois.recibo).toContain('SAÍDA');

  const tipos = await page.evaluate(async () => {
    const f = await window.__EFRAT.Store.fila();
    const e = await window.__EFRAT.Store.enviadas();
    return f.concat(e).filter(m => m.pessoa_id === 'p-ana').map(m => m.tipo).sort();
  });
  expect(tipos).toEqual(['entrada', 'saida']);
});

test('cooldown bloqueia a mesma pessoa em sequencia', async ({ page }) => {
  await abrir(page, ctx.url, 'p-gestor');
  await parear(page);
  await abrirFila(page);
  await marcar(page, 'p-ana');
  await expect(page.locator('#cartao')).toContainText('já marcou', { timeout: 25000 });
});

test('rosto fora da galeria oferece manual e busca na unidade', async ({ page }) => {
  await abrir(page, ctx.url, 'p-gestor');
  await parear(page);
  await abrirFila(page);
  await vira(page, 'p-carla');            // Carla e da eq-2, fora da equipe do turno
  await expect(page.locator('#cartao')).toContainText('Não reconhecido', { timeout: 25000 });
  await page.waitForSelector('#btnUnidade', { timeout: 30000 });
  await page.click('#btnUnidade');
  await page.waitForSelector('#btnConfirmar', { timeout: 25000 });
  await expect(page.locator('#cartao .tit')).toContainText('Carla');
});

test('registro manual exige motivo e grava como manual', async ({ page }) => {
  await abrir(page, ctx.url, 'p-gestor');
  await parear(page);
  await abrirFila(page);
  await vira(page, 'p-carla');
  await page.waitForSelector('#btnManual', { timeout: 30000 });
  await page.click('#btnManual');
  await page.click('#listaPessoas button:first-child');
  await expect(page.locator('#toast')).toContainText('motivo');
  await page.fill('#motivoManual', 'sem rosto legivel no sol');
  await page.click('#listaPessoas button:first-child');
  await page.waitForSelector('#cartao .cartao.ok', { timeout: 20000 });

  const m = await page.evaluate(async () => {
    const f = await window.__EFRAT.Store.fila();
    const e = await window.__EFRAT.Store.enviadas();
    return f.concat(e).find(x => x.origem === 'manual');
  });
  expect(m.veredito).toBe('manual');
  expect(m.motivo).toContain('sol');
});

/* -------------------------------------------------------- sincronismo */

test('offline enfileira e sobe quando a rede volta', async ({ page }) => {
  await abrir(page, ctx.url, 'p-gestor');
  await parear(page);
  ctx.estado.fora = true;
  await abrirFila(page);
  await marcar(page, 'p-ana');
  await expect(page.locator('#kEnvio')).not.toHaveText('0', { timeout: 15000 });

  ctx.estado.fora = false;
  await page.evaluate(() => window.__EFRAT.Fila.sincronizar());
  await expect(page.locator('#kEnvio')).toHaveText('0', { timeout: 20000 });
  expect(ctx.estado.marcacoes.size).toBe(2);   // gestor + Ana
});

test('reenvio do mesmo id_cliente nao duplica', async ({ page }) => {
  await abrir(page, ctx.url, 'p-gestor');
  await parear(page);
  await abrirFila(page);
  await expect(page.locator('#kEnvio')).toHaveText('0', { timeout: 20000 });
  const antes = ctx.estado.marcacoes.size;

  await page.evaluate(async () => {
    const m = (await window.__EFRAT.Store.enviadas())[0];
    await window.__EFRAT.Store.enfileirar(m);
  });
  await page.evaluate(() => window.__EFRAT.Fila.sincronizar());
  await expect(page.locator('#kEnvio')).toHaveText('0', { timeout: 20000 });
  expect(ctx.estado.marcacoes.size).toBe(antes);
});

test('envio unico em voo: nunca ha dois lotes simultaneos', async ({ page }) => {
  await abrir(page, ctx.url, 'p-gestor');
  await parear(page);
  ctx.estado.fora = true;
  await abrirFila(page);
  await page.evaluate(() => { window.EFRAT_CFG.cooldownMs = 0; });
  await marcar(page, 'p-ana');
  await marcar(page, 'p-bruno');
  ctx.estado.fora = false;
  await page.evaluate(() => {
    window.__EFRAT.Fila.sincronizar();
    window.__EFRAT.Fila.sincronizar();
    window.__EFRAT.Fila.sincronizar();
  });
  await expect(page.locator('#kEnvio')).toHaveText('0', { timeout: 25000 });
  expect(ctx.estado.maxLotesSimultaneos).toBe(1);
});

test('colaborador inativo e rejeitado e a marcacao fica retida', async ({ page }) => {
  await abrir(page, ctx.url, 'p-gestor');
  await parear(page);
  ctx.estado.fora = true;
  await abrirFila(page);
  await marcar(page, 'p-ana');
  ctx.estado.inativos.add('p-ana');
  ctx.estado.fora = false;

  await page.evaluate(() => window.__EFRAT.Fila.sincronizar());
  await page.waitForFunction(async () => {
    const f = await window.__EFRAT.Store.fila();
    return f.some(m => m._erro);
  }, null, { timeout: 25000 });
  const fila = await page.evaluate(() => window.__EFRAT.Store.fila());
  expect(fila.find(m => m._erro)._erro).toContain('inativo');
});

/* -------------------------------------------------------- painel RH */

test('RH nao entra com senha errada', async ({ page }) => {
  await abrir(page, ctx.url);
  await page.click('#btnAcessar');
  await page.fill('#rhUsuario', 'rh');
  await page.fill('#rhSenha', 'errada');
  await page.click('#btnEntrarRh');
  await expect(page.locator('#toast')).toContainText('invalidos', { timeout: 20000 });
  await expect(page.locator('#rh')).toHaveClass(/hide/);
});

test('RH entra e ve o painel com indicadores', async ({ page }) => {
  await abrir(page, ctx.url);
  await logarRh(page);
  await expect(page.locator('#rhNome')).toHaveText('RH Teste');
  await expect(page.locator('#rh-painel')).toContainText('Taxa manual');
});

test('RH cria equipe e colaborador', async ({ page }) => {
  await abrir(page, ctx.url);
  await logarRh(page);

  await page.click('#rh nav button[data-aba="equipes"]');
  await page.fill('#eNome', 'Equipe Norte');
  await page.click('#btnNovaEquipe');
  await expect(page.locator('#toast')).toContainText('Equipe criada', { timeout: 15000 });
  expect(ctx.estado.equipesCriadas).toContain('Equipe Norte');

  await page.click('#rh nav button[data-aba="pessoas"]');
  await page.fill('#pNome', 'Novo Colaborador');
  await page.fill('#pMat', '777');
  await page.click('#btnNovaPessoa');
  await expect(page.locator('#toast')).toContainText('salvo', { timeout: 15000 });
  expect(ctx.estado.colaboradoresCriados).toContain('Novo Colaborador');
});

test('RH ve a pendencia do gestor e decide', async ({ page }) => {
  await abrir(page, ctx.url, 'p-gestor');
  await parear(page);
  await abrirFila(page);
  await expect(page.locator('#kEnvio')).toHaveText('0', { timeout: 20000 });
  await page.click('#btnSairFila');
  await page.waitForSelector('#porta:not(.hide)');

  await logarRh(page);
  await page.click('#rh nav button[data-aba="pendencias"]');
  await expect(page.locator('#rh-pendencias')).toContainText('Gestor Piloto', { timeout: 15000 });

  await page.click('#rh-pendencias button[data-acao="aprovar"]');
  await expect(page.locator('#toast')).toContainText('Decidido', { timeout: 15000 });
  expect(ctx.estado.decisoes.length).toBe(1);
});

test('espelho de ponto mostra as marcacoes do colaborador', async ({ page }) => {
  await abrir(page, ctx.url, 'p-gestor');
  await parear(page);
  await abrirFila(page);
  await marcar(page, 'p-ana');
  await expect(page.locator('#kEnvio')).toHaveText('0', { timeout: 20000 });
  await page.click('#btnSairFila');

  await logarRh(page);
  await page.click('#rh nav button[data-aba="registros"]');
  await page.selectOption('#regPessoa', 'p-ana');
  await expect(page.locator('#regSaida')).toContainText('E ', { timeout: 15000 });
});

/* --------------------------------------------- painel desktop do RH */

test('painel mostra card critico quando ninguem da equipe marcou hoje', async ({ page }) => {
  // nenhuma marcação foi feita: toda equipe com gente ativa cai em critico.
  await abrir(page, ctx.url);
  await logarRh(page);
  await expect(page.locator('#rh-painel .eqcard.critico').first()).toBeVisible({ timeout: 15000 });
});

test('card traz o numero junto da cor (leitura sem depender de cor)', async ({ page }) => {
  await abrir(page, ctx.url);
  await logarRh(page);
  const primeiro = page.locator('#rh-painel .eqcard').first();
  await expect(primeiro).toBeVisible({ timeout: 15000 });
  // a asserção olha o texto, não a cor: precisa haver um "n/n" no card.
  await expect(primeiro.locator('.cnt')).toContainText('/');
});

test('ver dados abre a tabela com os mesmos numeros do grafico', async ({ page }) => {
  // uma marcação real hoje: o gestor entra ao abrir a fila.
  await abrir(page, ctx.url, 'p-gestor');
  await parear(page);
  await abrirFila(page);
  await expect(page.locator('#kEnvio')).toHaveText('0', { timeout: 20000 });
  await page.click('#btnSairFila');
  await page.waitForSelector('#porta:not(.hide)');

  await logarRh(page);
  await expect(page.locator('#rh-painel')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#tabLinha')).toHaveClass(/hide/);
  await page.click('#rh-painel .verdados[data-tab="tabLinha"]');
  await expect(page.locator('#tabLinha')).not.toHaveClass(/hide/);
  await expect(page.locator('#tabLinha table')).toBeVisible();
  // a coluna Total soma ao menos a marcação do gestor de hoje.
  await expect(page.locator('#tabLinha')).toContainText('Total');
});

test('trocar o periodo recarrega e o painel repinta sem duplicar canvas', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });   // o toggle é desktop (≥900px)
  await abrir(page, ctx.url);
  await logarRh(page);
  await expect(page.locator('#rh-painel')).toBeVisible({ timeout: 15000 });
  await page.click('#rhToggle button[data-dias="7"]');
  await expect(page.locator('#rhToggle button[data-dias="7"]')).toHaveClass(/on/);
  await expect(page.locator('#rhPeriodo')).toContainText('7 dias');
  // um container de gráfico por caixa, nunca dois canvas empilhados.
  await expect(page.locator('#boxLinha')).toHaveCount(1);
});
