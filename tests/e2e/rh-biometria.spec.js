// Região de biometria do painel do RH (T-8ADD9C/T-92D567): o modal que
// escolhe entre câmera do PC e upload de 3 fotos, e as duas telas que ele
// abre. Migra a câmera para /efrat/rh/face/cadastrar (autenticada como RH,
// não mais credencial de aparelho emprestada — docs/fase3-contrato.md §4.3)
// e implementa o upload do zero.
import { test, expect } from '@playwright/test';
import { subir } from './servidor-falso.js';

let ctx;
test.beforeEach(async () => { ctx = await subir(); });
test.afterEach(async () => { ctx.servidor.close(); });

async function abrir(page, base) {
  await page.addInitScript(a => {
    window.__EFRAT_FAKE_FACE = { pessoa: 'p-ana' };
    window.EFRAT_CFG = { apiBase: a.base + '/webhook', chartCdn: '' };
  }, { base });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.__EFRAT && window.__EFRAT.Face.pronto, null, { timeout: 20000 });
}

/** Mesmo precedente de outros specs: troca a derivação PBKDF2 por chave fixa. */
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

async function abrirBiometriaDe(page, pessoaId) {
  await page.click('#rh nav button[data-aba="pessoas"]');
  await page.click('button[data-pessoa="' + pessoaId + '"]');
  await page.click('#btnAbrirBio');
}

/** Um arquivo mínimo — em modo fingido o conteúdo nunca é lido, só o nome. */
function arquivo(nome) {
  return { name: nome, mimeType: 'image/jpeg', buffer: Buffer.from('fingido') };
}

/**
 * Três vetores coerentes (distância pequena, não zero) — a semente por
 * pessoa/arquivo é bimodal (idêntico ou ~4), então um lote genuinamente
 * coerente-mas-não-idêntico (como 3 fotos reais da mesma pessoa) só existe
 * via override direto do descritor (js/face.js: `f.descritor`/
 * `f.descritoresPorArquivo`). Mesma construção ortogonal dos fixtures de
 * tests/unit/coerencia.test.js.
 */
function loteCoerente() {
  const DIM = 128;
  const a = new Array(DIM).fill(0);
  const b = a.slice(); b[0] = 0.094;
  const c = a.slice(); c[1] = 0.094;
  return [a, b, c];
}

test('abrirBiometria mostra a escolha entre câmera e upload, sem travar em nenhum dos dois', async ({ page }) => {
  await abrir(page, ctx.url);
  await logarRh(page);
  await abrirBiometriaDe(page, 'p-ana');
  await expect(page.locator('#btnModoCamera')).toBeVisible();
  await expect(page.locator('#btnModoUpload')).toBeVisible();
});

test('câmera grava por /efrat/rh/face/cadastrar — nunca pela rota antiga de aparelho', async ({ page }) => {
  await abrir(page, ctx.url);
  await logarRh(page);
  await abrirBiometriaDe(page, 'p-ana');
  await page.click('#btnModoCamera');

  const lote = loteCoerente();
  for (let i = 0; i < 3; i++) {
    await page.evaluate(v => { window.__EFRAT_FAKE_FACE.descritor = v; }, lote[i]);
    await page.click('#btnCapCad');
  }
  await expect(page.locator('#btnSalvarBio')).toBeEnabled();
  await page.click('#btnSalvarBio');
  await expect(page.locator('#areaBio')).toBeEmpty();

  expect(ctx.estado.chamadas.cadastro).toBe(0); // rota antiga (aparelho) nunca chamada
  const pessoa = ctx.pessoas.find(p => p.pessoa_id === 'p-ana');
  expect(pessoa.origem).toBe('rh_camera');
  expect(pessoa.modelo_id).toBe('fingido');
});

test('upload: posição vazia e posição que falhou têm sinal visual diferente', async ({ page }) => {
  await abrir(page, ctx.url);
  await logarRh(page);
  await abrirBiometriaDe(page, 'p-ana');
  await page.click('#btnModoUpload');

  const slots = page.locator('#uploadSlots .slot');
  await expect(slots).toHaveCount(3);
  await expect(slots.nth(0)).toHaveClass(/vazio/);

  await page.locator('[data-slot="0"]').click();
  await page.setInputFiles('#uploadInput', arquivo('sem-rosto-1.jpg'));
  await expect(slots.nth(0)).toHaveClass(/falhou/);
  await expect(slots.nth(0)).not.toHaveClass(/vazio/);
  await expect(page.locator('#uploadErro')).toContainText('Não encontrei um rosto na foto 1 de 3');

  // outras duas continuam vazias — classe diferente da que falhou.
  await expect(slots.nth(1)).toHaveClass(/vazio/);
  await expect(slots.nth(1)).not.toHaveClass(/falhou/);
});

test('upload: retry só na posição que falhou, sem perder as outras já ok', async ({ page }) => {
  await abrir(page, ctx.url);
  await logarRh(page);
  await abrirBiometriaDe(page, 'p-ana');
  await page.click('#btnModoUpload');

  await page.locator('[data-slot="0"]').click();
  await page.setInputFiles('#uploadInput', arquivo('ana-pose1.jpg'));
  await page.locator('[data-slot="1"]').click();
  await page.setInputFiles('#uploadInput', arquivo('dois-rostos.jpg'));
  await page.locator('[data-slot="2"]').click();
  await page.setInputFiles('#uploadInput', arquivo('ana-pose2.jpg'));

  await expect(page.locator('#uploadSlots .slot').nth(0)).toHaveClass(/ok/);
  await expect(page.locator('#uploadSlots .slot').nth(1)).toHaveClass(/falhou/);
  await expect(page.locator('#btnSalvarUpload')).toBeDisabled();

  // corrige só a posição 1 — a 0 e a 2 continuam intactas.
  await page.locator('[data-slot="1"]').click();
  await page.setInputFiles('#uploadInput', arquivo('ana-pose3.jpg'));
  await expect(page.locator('#uploadSlots .slot').nth(1)).toHaveClass(/ok/);
  await expect(page.locator('#uploadSlots .slot').nth(0)).toHaveClass(/ok/);
  await expect(page.locator('#btnSalvarUpload')).toBeEnabled();
});

test('upload: a tela nunca consegue mandar um lote de 2 — o botão só habilita com as 3 em ok', async ({ page }) => {
  await abrir(page, ctx.url);
  await logarRh(page);
  await abrirBiometriaDe(page, 'p-ana');
  await page.click('#btnModoUpload');

  await page.locator('[data-slot="0"]').click();
  await page.setInputFiles('#uploadInput', arquivo('ana-pose1.jpg'));
  await page.locator('[data-slot="1"]').click();
  await page.setInputFiles('#uploadInput', arquivo('ana-pose2.jpg'));
  // posição 2 continua vazia.
  await expect(page.locator('#btnSalvarUpload')).toBeDisabled();

  // mesmo chamando a função direto (contornando o disabled do botão), a
  // função reafirma a condição e não manda nada com 2 preenchidas.
  await page.evaluate(() => window.__EFRAT.Rh.salvarBiometriaUpload());
  await page.waitForTimeout(200);
  expect(ctx.estado.recadastros.length).toBe(0);
  const pessoa = ctx.pessoas.find(p => p.pessoa_id === 'p-ana');
  expect(pessoa.origem).not.toBe('rh_upload');
});

test('upload: lote incoerente (3 pessoas diferentes) é recusado com o texto de upload, não o de fila.js', async ({ page }) => {
  await abrir(page, ctx.url);
  await logarRh(page);
  await abrirBiometriaDe(page, 'p-ana');
  await page.click('#btnModoUpload');

  for (const [i, nome] of ['pessoa-um.jpg', 'pessoa-dois.jpg', 'pessoa-tres.jpg'].entries()) {
    await page.locator('[data-slot="' + i + '"]').click();
    await page.setInputFiles('#uploadInput', arquivo(nome));
  }
  await expect(page.locator('#btnSalvarUpload')).toBeEnabled();
  await page.click('#btnSalvarUpload');

  await expect(page.locator('.toast.bad')).toContainText('Escolha 3 fotos mais parecidas, da mesma pessoa');
  expect(ctx.estado.recadastros.length).toBe(0);
});

test('upload: caminho feliz (3 fotos da mesma pessoa) grava pendente, nunca sobrescreve o template ativo', async ({ page }) => {
  await abrir(page, ctx.url);
  await logarRh(page);
  const antes = ctx.pessoas.find(p => p.pessoa_id === 'p-ana').vetores;

  const nomes = ['ana-a.jpg', 'ana-b.jpg', 'ana-c.jpg'];
  const lote = loteCoerente();
  await page.evaluate(({ nomes, lote }) => {
    window.__EFRAT_FAKE_FACE.descritoresPorArquivo = Object.fromEntries(nomes.map((n, i) => [n, lote[i]]));
  }, { nomes, lote });

  await abrirBiometriaDe(page, 'p-ana');
  await page.click('#btnModoUpload');
  for (const [i, nome] of nomes.entries()) {
    await page.locator('[data-slot="' + i + '"]').click();
    await page.setInputFiles('#uploadInput', arquivo(nome));
  }
  await page.click('#btnSalvarUpload');
  await expect(page.locator('#areaBio')).toBeEmpty();

  const pendencia = ctx.estado.recadastros.find(t => t.pessoa_id === 'p-ana');
  expect(pendencia).toBeTruthy();
  expect(pendencia.origem).toBe('rh_upload');
  expect(pendencia.modelo_id).toBe('fingido');

  const depois = ctx.pessoas.find(p => p.pessoa_id === 'p-ana').vetores;
  expect(depois).toEqual(antes); // template vigente intacto — upload não vira ativo sozinho
});
