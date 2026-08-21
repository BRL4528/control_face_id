// Critérios de aceite do painel do gestor (T-8FB792), regras não negociáveis
// de docs/plano-v3.md § privacidade da tela compartilhada:
// não abre automático; abre AGREGADO primeiro; nome individual só num
// segundo toque; ausentes antes de presentes; ajuste do gestor é sempre
// PROPOSTA (pendente_rh), nunca altera a marcação. Cada teste verifica no
// DOM/estado do servidor-falso, não a olho.
import { test, expect } from '@playwright/test';
import { criarServidor } from './servidor-falso.js';

let ctx;

test.beforeEach(async () => {
  const { servidor, estado } = criarServidor({});
  await new Promise(res => servidor.listen(0, '127.0.0.1', res));
  ctx = { url: 'http://127.0.0.1:' + servidor.address().port, servidor, estado };
});
test.afterEach(async () => { ctx.servidor.close(); });

async function abrir(page, base, pessoa) {
  await page.addInitScript(a => {
    window.__EFRAT_FAKE_FACE = { pessoa: a.pessoa || 'p-ana' };
    window.EFRAT_CFG = { apiBase: a.base + '/webhook', chartCdn: '' };
  }, { pessoa, base });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.__EFRAT && window.__EFRAT.Face.pronto, null, { timeout: 20000 });
}

async function aprovar(page) {
  await page.waitForFunction(() => window.__EFRAT.S.dispositivo, null, { timeout: 20000 });
  for (const d of ctx.estado.dispositivos.values()) {
    d.estado = 'ativo'; d.equipes_ids = ['eq-1', 'eq-2']; d.configuracao_versao = 1;
  }
  await page.evaluate(() => window.__EFRAT.verificarDispositivo());
  // #porta e o sinal que discrimina: fica escondido enquanto o aparelho
  // esta pendente. btnPonto habilitado, sozinho, ja e verdadeiro antes de
  // aprovar (toBeEnabled ignora visibilidade) e por isso nao prova nada.
  await expect(page.locator('#porta')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#btnPonto')).toBeEnabled({ timeout: 20000 });
}

/** O comprovante fica em #fila até o auto-clear ou #btnSairFila — nunca volta
 * pra #porta sozinho. Pra marcar uma segunda pessoa é preciso sair primeiro. */
async function voltarPorta(page) {
  if (await page.locator('#fila').isVisible()) await page.click('#btnSairFila');
  await page.waitForSelector('#btnPonto:not([disabled])', { timeout: 20000 });
}

async function marcarComo(page, pessoa) {
  await voltarPorta(page);
  await page.evaluate(p => { window.__EFRAT_FAKE_FACE.pessoa = p; }, pessoa);
  await page.click('#btnPonto');
  await page.waitForSelector('#btnConfirmar', { timeout: 20000 });
  await page.click('#btnConfirmar');
  await page.waitForSelector('#cartao .cartao.ok', { timeout: 20000 });
}

test('painel não abre automático ao reconhecer o gestor — só o link, e só o toque abre', async ({ page }) => {
  await abrir(page, ctx.url, 'p-ana');
  await aprovar(page);
  await marcarComo(page, 'p-gestor');

  // O reconhecimento do gestor marcou o ponto dele. O painel continua
  // fechado até o toque explícito no link do comprovante.
  await expect(page.locator('#painelGestor')).toHaveClass(/hide/);
  const link = page.locator('#linkVerEquipe');
  await expect(link).toBeVisible({ timeout: 8000 });

  await link.click();
  await expect(page.locator('#painelGestor')).not.toHaveClass(/hide/);
});

test('abre agregado primeiro; nome individual só aparece depois do segundo toque', async ({ page }) => {
  await abrir(page, ctx.url, 'p-ana');
  await aprovar(page);
  await marcarComo(page, 'p-ana');   // Ana marca entrada — fica presente
  await marcarComo(page, 'p-gestor');
  await page.click('#linkVerEquipe');

  await expect(page.locator('#painelGestor .kpi')).toHaveCount(3);
  const kpis = await page.locator('#painelGestor .kpi .val').allTextContents();
  expect(kpis.some(v => Number(v) >= 0)).toBe(true);

  // Nome não está no DOM ainda — nem escondido: procura a página inteira.
  let html = await page.content();
  expect(html).not.toContain('Ana Souza');
  expect(html).not.toContain('Bruno Lima');

  await page.click('#btnVerNomes');
  await expect(page.locator('.linha-item[data-id="p-ana"]')).toBeVisible();
  html = await page.content();
  expect(html).toContain('Ana Souza');
});

test('lista de ausentes vem antes da de presentes', async ({ page }) => {
  await abrir(page, ctx.url, 'p-ana');
  await aprovar(page);
  await marcarComo(page, 'p-ana');   // presente
  await marcarComo(page, 'p-gestor');
  await page.click('#linkVerEquipe');
  await page.click('#btnVerNomes');

  const html = await page.textContent('#gestorConteudo');
  const posAusentes = html.indexOf('Ausentes');
  const posPresentes = html.indexOf('Presentes');
  expect(posAusentes).toBeGreaterThan(-1);
  expect(posPresentes).toBeGreaterThan(-1);
  expect(posAusentes).toBeLessThan(posPresentes);

  // Bruno nunca marcou (ausente); Ana marcou (presente). A posição de Bruno
  // no texto tem de vir antes da de Ana.
  const posBruno = html.indexOf('Bruno Lima');
  const posAna = html.indexOf('Ana Souza');
  expect(posBruno).toBeGreaterThan(-1);
  expect(posAna).toBeGreaterThan(-1);
  expect(posBruno).toBeLessThan(posAna);
});

test('ajuste do gestor vira proposta pendente_rh — nunca altera a marcação direto', async ({ page }) => {
  await abrir(page, ctx.url, 'p-ana');
  await aprovar(page);
  await marcarComo(page, 'p-gestor');
  await page.click('#linkVerEquipe');
  await page.click('#btnVerNomes');

  expect(ctx.estado.correcoes.length).toBe(0);
  const marcacoesAntes = ctx.estado.marcacoes.size;

  await page.click('.linha-item[data-id="p-bruno"]');
  await page.fill('#ajHora', '08:00');
  await page.fill('#ajMotivo', 'Esqueceu de bater o ponto na entrada');
  await page.click('#btnEnviarAjuste');

  await expect(page.locator('#toast')).toContainText('pendente', { timeout: 8000 });

  expect(ctx.estado.correcoes.length).toBe(1);
  const correcao = ctx.estado.correcoes[0];
  expect(correcao.estado).toBe('pendente_rh');
  expect(correcao.pessoa_id).toBe('p-bruno');
  expect(correcao.autor_id).toBe('p-gestor');
  // Nenhuma marcação nova foi criada por conta própria — é proposta, não fato.
  expect(ctx.estado.marcacoes.size).toBe(marcacoesAntes);
});

test('sessão do gestor expira e o app volta sozinho pra tela de ponto', async ({ page }) => {
  await abrir(page, ctx.url, 'p-ana');
  await aprovar(page);
  await marcarComo(page, 'p-gestor');
  await page.click('#linkVerEquipe');
  await expect(page.locator('#painelGestor')).not.toHaveClass(/hide/);

  // Invalida a sessão e força uma chamada real — imita o 401 SESSAO_EXPIRADA
  // que o servidor devolveria depois do TTL, sem esperar 10 minutos de verdade.
  await page.evaluate(() => { window.__EFRAT.Gestor.sessao.token = 'sessao-invalida'; });
  await page.evaluate(() => window.__EFRAT.Gestor.carregar());

  await expect(page.locator('#painelGestor')).toHaveClass(/hide/, { timeout: 8000 });
  await expect(page.locator('#porta')).not.toHaveClass(/hide/);
});
