// Aba Aparelhos do RH (T-87615C, docs/fase3-rh-pessoas.md § A).
//
// Diagnóstico que este arquivo prova errado: o app nasce trancado — o
// aparelho gera identidade própria e mostra "Aguardando liberação do RH",
// mas não existia rota nem tela onde o RH liberasse.
//
// Critério de aceite endurecido a meio da tarefa (achado do QA): ativar não
// pode ser "clicar num item de lista que já mostra o código" — isso não prova
// posse física de nada, o código vira enfeite. Ativação só existe pelo código
// DIGITADO (docs/adr-acesso-v3.md): campo de texto livre, sem
// datalist/autocomplete, e o código nunca aparece em nenhuma leitura do RH —
// nem no HTML, nem no corpo da resposta de /rh/dados. Por isso o teste
// principal usa DOIS contextos de navegador (o aparelho do campo e o RH, como
// no mundo real são dois aparelhos físicos diferentes): o código só existe na
// tela do PRIMEIRO contexto, e chega ao segundo por um humano digitando, nunca
// por leitura de estado/DOM entre as duas páginas.
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

/** Mesmo bypass de derivação PBKDF2 que fluxo.spec.js e acesso.spec.js usam
 * pra ficar determinístico — a senha real não é o que este arquivo testa. */
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

async function abrirAbaAparelhos(page) {
  await page.click('#rh nav button[data-aba="aparelhos"]');
  await expect(page.locator('#rh-aparelhos')).not.toHaveClass(/hide/);
}

async function digitarCodigo(page, codigo) {
  await page.fill('#aparelhoCodigo', codigo);
  await page.click('#btnLiberarAparelho');
}

test('o código do pendente nunca aparece na aba Aparelhos do RH, nem no HTML nem na resposta de /rh/dados', async ({ page }) => {
  await abrir(page, ctx.url, 'p-ana');
  const codigo = await page.textContent('#aguardandoCodigo');

  const respostaDados = page.waitForResponse(r => r.url().includes('/efrat/rh/dados'));
  await logarRh(page);
  const json = await (await respostaDados).json();
  expect(JSON.stringify(json)).not.toContain(codigo);

  await abrirAbaAparelhos(page);
  const html = await page.content();
  expect(html).not.toContain(codigo);
});

test('clicar em Liberar sem digitar nada não ativa o aparelho', async ({ page }) => {
  await abrir(page, ctx.url, 'p-ana');
  await logarRh(page);
  await abrirAbaAparelhos(page);

  await page.click('#btnLiberarAparelho');
  await expect(page.locator('#toast')).toContainText('Digite o código', { timeout: 5000 });
  const dispositivo = [...ctx.estado.dispositivos.values()][0];
  expect(dispositivo.estado).toBe('pendente');
});

test('digitar um código errado não ativa o aparelho', async ({ page }) => {
  await abrir(page, ctx.url, 'p-ana');
  await logarRh(page);
  await abrirAbaAparelhos(page);

  await digitarCodigo(page, 'ZZZZZZ');
  await expect(page.locator('#toast')).toContainText('invalido', { timeout: 5000 });
  const dispositivo = [...ctx.estado.dispositivos.values()][0];
  expect(dispositivo.estado).toBe('pendente');
});

test('aparelho pede liberação, RH digita o código na aba Aparelhos, e a tela de espera se resolve sozinha sem recarregar', async ({ page, browser }) => {
  await abrir(page, ctx.url, 'p-ana');
  await expect(page.locator('#aguardando')).not.toHaveClass(/hide/);
  await expect(page.locator('#porta')).toHaveClass(/hide/);
  const codigo = await page.textContent('#aguardandoCodigo');
  expect(codigo).toMatch(/^[A-Z0-9]{6}$/);

  // Segundo contexto = segundo aparelho físico: o RH nunca usa o mesmo
  // aparelho de quem está pedindo liberação (docs/adr-acesso-v3.md). O único
  // jeito do código chegar até lá é um humano lendo a tela do primeiro
  // contexto e digitando no segundo — exatamente o que este teste faz.
  const rhContexto = await browser.newContext();
  try {
    const rhPage = await rhContexto.newPage();
    await abrir(rhPage, ctx.url, 'p-ana');
    await logarRh(rhPage);
    await abrirAbaAparelhos(rhPage);

    await digitarCodigo(rhPage, codigo);
    await expect(rhPage.locator('#toast')).toContainText('liberado', { timeout: 8000 });

    // Nada mexe na aba do aparelho a partir daqui — nem reload, nem
    // window.__EFRAT.verificarDispositivo() manual. Só o poll de fundo que
    // js/app.js já reagenda sozinho é que pode fazer a tela virar.
    await expect(page.locator('#porta')).not.toHaveClass(/hide/, { timeout: 30000 });
    await expect(page.locator('#aguardando')).toHaveClass(/hide/);
    await expect(page.locator('#btnPonto')).toBeEnabled();
  } finally {
    await rhContexto.close();
  }
});

test('RH recusa aparelho pendente pela linha da lista: some da fila e o aparelho fica bloqueado com mensagem própria', async ({ page }) => {
  await abrir(page, ctx.url, 'p-ana');
  await logarRh(page);
  await abrirAbaAparelhos(page);

  const dispositivoId = [...ctx.estado.dispositivos.values()][0].dispositivo_id;
  const linhaPendente = page.locator('.linha-item', { hasText: dispositivoId.slice(0, 8) });
  await expect(linhaPendente).toBeVisible();
  await linhaPendente.getByRole('button', { name: 'Recusar' }).click();
  await expect(page.locator('#toast')).toContainText('recusado', { timeout: 8000 });
  await expect(page.locator('.linha-item', { hasText: dispositivoId.slice(0, 8) })).toHaveCount(0, { timeout: 8000 });

  expect(ctx.estado.dispositivos.get(dispositivoId).estado).toBe('negado');

  await page.click('#btnSairRh');
  await expect(page.locator('#aguardandoTexto')).toContainText('não foi liberado', { timeout: 15000 });
});

test('RH revoga aparelho já liberado: sai da lista de liberados e o aparelho perde acesso à carga', async ({ page }) => {
  await abrir(page, ctx.url, 'p-ana');
  const codigo = await page.textContent('#aguardandoCodigo');
  await logarRh(page);
  await abrirAbaAparelhos(page);

  await digitarCodigo(page, codigo);
  await expect(page.locator('#toast')).toContainText('liberado', { timeout: 8000 });

  const dispositivoId = [...ctx.estado.dispositivos.values()][0].dispositivo_id;
  const linhaAprovado = page.locator('.linha-item', { hasText: dispositivoId.slice(0, 8) });
  await expect(linhaAprovado).toBeVisible({ timeout: 8000 });
  await linhaAprovado.getByRole('button', { name: 'Revogar' }).click();
  await expect(page.locator('#toast')).toContainText('revogado', { timeout: 8000 });
  await expect(page.locator('.linha-item', { hasText: dispositivoId.slice(0, 8) })).toHaveCount(0, { timeout: 8000 });

  expect(ctx.estado.dispositivos.get(dispositivoId).estado).toBe('revogado');
});

test('código pendente expira em 24h: aparelho recebe um novo sozinho e o antigo para de resolver no RH', async ({ page }) => {
  await abrir(page, ctx.url, 'p-ana');
  await logarRh(page);
  await abrirAbaAparelhos(page);

  const dispositivoId = [...ctx.estado.dispositivos.values()][0].dispositivo_id;
  const dispositivo = ctx.estado.dispositivos.get(dispositivoId);
  const codigoAntigo = dispositivo.codigo_curto;
  dispositivo.criado_em = new Date(Date.now() - 25 * 3600 * 1000).toISOString();

  await digitarCodigo(page, codigoAntigo);
  await expect(page.locator('#toast')).toContainText('invalido', { timeout: 5000 });
  expect(dispositivo.estado).toBe('pendente');

  // a próxima consulta de estado do próprio aparelho troca o código sozinha —
  // forcado:true porque a página ainda está "logada" no RH (S.emRh), senão o
  // poll de fundo fica suspenso e a chamada não sai (ver app.js verificarDispositivo).
  await page.evaluate(() => window.__EFRAT.verificarDispositivo(true));
  await expect
    .poll(() => dispositivo.codigo_curto, { timeout: 10000 })
    .not.toBe(codigoAntigo);
});
