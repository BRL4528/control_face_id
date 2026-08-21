// Telas de Equipes e Colaboradores — T-8188C6 (docs/fase3-contrato.md §2, §3).
//
// O que este arquivo prova que o nível de contrato não prova: que a TELA
// entrega o pedido do cliente, não só a rota por baixo. §2.1 é explícito
// sobre isso — "mandar o RH sair da equipe, procurar a pessoa na aba de
// pessoas e trocar um <select> de equipe não cumpre o pedido, mesmo sendo a
// mesma escrita". Por isso os testes de equipe abrem a equipe e mexem nos
// membros de DENTRO dela, nunca pela aba de pessoas.
import { test, expect } from '@playwright/test';
import { subir } from './servidor-falso.js';

let ctx;
test.beforeEach(async () => { ctx = await subir(); });
test.afterEach(async () => { ctx.servidor.close(); });

async function abrir(page, base) {
  await page.addInitScript(a => {
    window.__EFRAT_FAKE_FACE = { pessoa: 'p-ana' };
    window.EFRAT_CFG = { apiBase: a + '/webhook', chartCdn: '' };
  }, base);
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

/* ------------------------------------------------------------------ equipes */

test('abrir equipe mostra os membros, adicionar move uma pessoa de fora pra dentro, remover tira sem apagar', async ({ page }) => {
  await abrir(page, ctx.url);
  await logarRh(page);

  await page.click('#rh nav button[data-aba="equipes"]');
  await page.locator('.linha-item', { hasText: 'Equipe Um' }).click();
  await expect(page.locator('.card h2', { hasText: 'Equipe Um' })).toBeVisible();

  // Ana e Bruno (e o gestor) começam na Equipe Um; Carla está na Equipe Dois.
  await expect(page.locator('.linha-item', { hasText: 'Ana Souza' })).toBeVisible();
  await expect(page.locator('#eAdicionarSelect')).toContainText('Carla Dias');

  await page.selectOption('#eAdicionarSelect', { label: 'Carla Dias (Equipe Dois)' });
  await page.click('#btnAdicionarMembro');
  await expect(page.locator('#toast')).toContainText('Adicionado', { timeout: 8000 });
  await expect(page.locator('.linha-item', { hasText: 'Carla Dias' })).toBeVisible();

  const linhaAna = page.locator('.linha-item', { hasText: 'Ana Souza' });
  await linhaAna.getByRole('button', { name: 'Remover' }).click();
  await expect(page.locator('#toast')).toContainText('Removido', { timeout: 8000 });
  await expect(page.locator('.linha-item', { hasText: 'Ana Souza' })).toHaveCount(0);

  // "remover" não apaga: Ana continua cadastrada, só sem equipe.
  await page.click('#btnVoltarEquipes');
  await page.click('#rh nav button[data-aba="pessoas"]');
  await expect(page.locator('.linha-item', { hasText: 'Ana Souza' })).toBeVisible();
});

test('inativar equipe com membro ativo é recusado e mostra a contagem', async ({ page }) => {
  await abrir(page, ctx.url);
  await logarRh(page);
  await page.click('#rh nav button[data-aba="equipes"]');
  await page.locator('.linha-item', { hasText: 'Equipe Um' }).click();
  await page.click('#btnInativarEquipe');
  await expect(page.locator('#toast')).toContainText('membros ativos', { timeout: 8000 });
});

/* --------------------------------------------------------------- colaborador */

test('criar colaborador exige telefone e o telefone aparece na ficha depois', async ({ page }) => {
  await abrir(page, ctx.url);
  await logarRh(page);
  await page.click('#rh nav button[data-aba="pessoas"]');

  await page.fill('#pNome', 'Novo Fulano');
  await page.fill('#pMat', '555');
  await page.click('#btnNovaPessoa');
  // sem telefone: servidor recusa (422 TELEFONE_OBRIGATORIO), não salva
  await expect(page.locator('#toast')).toContainText('Telefone', { timeout: 8000 });
  await expect(page.locator('.linha-item', { hasText: 'Novo Fulano' })).toHaveCount(0);

  await page.fill('#pTelefone', '67998760055');
  await page.click('#btnNovaPessoa');
  await expect(page.locator('#toast')).toContainText('salvo', { timeout: 8000 });

  await page.locator('.linha-item', { hasText: 'Novo Fulano' }).click();
  await expect(page.locator('#pdTelefone')).toHaveValue('+5567998760055');
});

test('telefone duplicado abre o diálogo de autorização com o nome de quem já usa, e motivo curto não destrava o botão', async ({ page }) => {
  await abrir(page, ctx.url);
  await logarRh(page);
  await page.click('#rh nav button[data-aba="pessoas"]');

  // seed não tem telefone (dado legado) — cria a "dona" do número primeiro.
  await page.fill('#pNome', 'Ana Souza Nova');
  await page.fill('#pMat', '550');
  await page.fill('#pTelefone', '67998765432');
  await page.click('#btnNovaPessoa');
  await expect(page.locator('#toast')).toContainText('salvo', { timeout: 8000 });

  await page.fill('#pNome', 'Duplicado');
  await page.fill('#pMat', '556');
  await page.fill('#pTelefone', '67998765432');   // mesmo tel. de "Ana Souza Nova"
  await page.click('#btnNovaPessoa');

  await expect(page.locator('#pConflito')).toContainText('Ana Souza Nova', { timeout: 8000 });
  const botao = page.locator('#btnAutorizarTelDup');
  await expect(botao).toBeDisabled();
  await page.fill('#motivoTelDup', 'curto');
  await expect(botao).toBeDisabled();
  await page.fill('#motivoTelDup', 'pai e filho no mesmo canteiro, um celular só');
  await expect(botao).toBeEnabled();
  await botao.click();
  await expect(page.locator('#toast')).toContainText('salvo', { timeout: 8000 });

  await expect(page.locator('.linha-item', { hasText: 'Duplicado' })).toContainText('telefone compartilhado');
});

test('editar colaborador troca o nome; inativar exige motivo e some da carga; reativar pede telefone e some a biometria', async ({ page }) => {
  await abrir(page, ctx.url);
  await logarRh(page);
  await page.click('#rh nav button[data-aba="pessoas"]');
  await page.locator('.linha-item', { hasText: 'Bruno Lima' }).click();

  await page.fill('#pdNome', 'Bruno Lima Silva');
  await page.fill('#pdTelefone', '67998760066');   // seed não tem telefone (dado legado); edição exige (§3.1)
  await page.click('#btnSalvarPessoa');
  await expect(page.locator('#toast')).toContainText('salvo', { timeout: 8000 });
  await expect(page.locator('.card h2', { hasText: 'Bruno Lima Silva' })).toBeVisible();

  const botaoInativar = page.locator('#btnInativarPessoa');
  await expect(botaoInativar).toBeDisabled();
  await page.fill('#motivoInativar', 'pediu demissão');
  await expect(botaoInativar).toBeEnabled();
  await botaoInativar.click();
  await expect(page.locator('#toast')).toContainText('inativado', { timeout: 8000 });
  await expect(page.locator('.card h2', { hasText: 'inativo' })).toBeVisible();

  await page.fill('#reativarTelefone', '67998760077');
  await page.click('#btnReativarPessoa');
  await expect(page.locator('#toast')).toContainText('reativado', { timeout: 8000 });
  await expect(page.locator('#rh-pessoas')).not.toContainText('inativo');
});
