// Botão "Enviar link pro celular" na ficha do colaborador (T-D30529). Nível
// de tela — o contrato da rota já está coberto em convite-contrato.spec.js.
import { test, expect } from '@playwright/test';
import { subir } from './servidor-falso.js';

let ctx;
test.beforeEach(async () => {
  ctx = await subir();
  ctx.pessoas.find(p => p.pessoa_id === 'p-ana').telefone = '+5567998765432';
});
test.afterEach(async () => { ctx.servidor.close(); });

async function abrir(page, base) {
  await page.addInitScript(a => {
    window.__EFRAT_FAKE_FACE = { pessoa: 'p-ana' };
    window.EFRAT_CFG = { apiBase: a.base + '/webhook', chartCdn: '' };
  }, { base });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.__EFRAT && window.__EFRAT.Face.pronto, null, { timeout: 20000 });
}

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

async function abrirFichaDe(page, pessoaId) {
  await page.click('#rh nav button[data-aba="pessoas"]');
  await page.click('button[data-pessoa="' + pessoaId + '"]');
}

test('botão gera o link, mostra telefone mascarado e "Abrir no WhatsApp"', async ({ page }) => {
  await abrir(page, ctx.url);
  await logarRh(page);
  await abrirFichaDe(page, 'p-ana');

  await page.click('#btnEnviarLink');
  await expect(page.locator('#areaLink')).toContainText('(67) 9****-5432');
  const href = await page.locator('#areaLink a').getAttribute('href');
  expect(href).toContain('https://wa.me/5567998765432');
});

test('pessoa com telefone compartilhado não vê o botão — vê a explicação', async ({ page }) => {
  ctx.pessoas.find(p => p.pessoa_id === 'p-bruno').telefone = '+5567998765432'; // mesmo de p-ana
  await abrir(page, ctx.url);
  await logarRh(page);
  await abrirFichaDe(page, 'p-ana');

  await expect(page.locator('#btnEnviarLink')).toHaveCount(0);
  await expect(page.locator('#rh-pessoas')).toContainText('Telefone compartilhado — o link não pode ser enviado');
});
