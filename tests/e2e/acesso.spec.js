// Critérios de aceite de segurança/privacidade da tela do colaborador v3
// (docs/plano-v3.md § Requisito de conteúdo — privacidade da tela
// compartilhada; docs/adr-acesso-v3.md). Arquivo próprio — não é
// tests/e2e/fluxo.spec.js (do Revisor) nem tests/e2e/servidor-falso.js (do
// Arquiteto, só importado aqui, nunca editado).
//
// Cada teste verifica no DOM, não a olho. O critério 5 é o que mais importa e
// vira dois casos (5a: cadastro nunca completou; 5b: cadastrou mas nunca foi
// aprovado) — falta de rede não pode virar sinônimo de aprovado em nenhum
// dos dois. Antes de commitar este arquivo, o 5b foi rodado uma vez contra
// uma versão de app.js sem o gate de `ultimo_estado` — ficou vermelho, como
// devia; com o gate de volta, fica verde.
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

/** Aprova "pelo RH" mexendo direto no estado do servidor-falso, e força o app a reconsultar. */
async function aprovar(page) {
  await page.waitForFunction(() => window.__EFRAT.S.dispositivo, null, { timeout: 20000 });
  for (const d of ctx.estado.dispositivos.values()) {
    d.estado = 'ativo'; d.equipes_ids = ['eq-1', 'eq-2']; d.configuracao_versao = 1;
  }
  await page.evaluate(() => window.__EFRAT.verificarDispositivo());
  await expect(page.locator('#btnPonto')).toBeEnabled({ timeout: 20000 });
}

async function marcar(page) {
  await page.click('#btnPonto');
  await page.waitForSelector('#btnConfirmar', { timeout: 20000 });
  await page.click('#btnConfirmar');
  await page.waitForSelector('#cartao .cartao.ok', { timeout: 20000 });
}

test('critério 1 — primeiro estado pós-reconhecimento mostra só comprovante, nada de banco de horas/histórico no DOM', async ({ page }) => {
  await abrir(page, ctx.url, 'p-ana');
  await aprovar(page);
  await marcar(page);
  const recibo = await page.textContent('#cartao');
  expect(recibo).toMatch(/ENTRADA|SAÍDA/);
  // Não é "não está visível" — é "não está no DOM", nem escondido. Ver a
  // página inteira, não só o texto visível de #cartao.
  const html = await page.content();
  expect(html.toLowerCase()).not.toMatch(/banco de horas|histórico|saldo do banco/);
});

test('critério 2 — expirar apaga, não sobrepõe: candidato e cartão somem da memória/DOM assim que a marcação é confirmada', async ({ page }) => {
  await abrir(page, ctx.url, 'p-ana');
  await aprovar(page);
  await marcar(page);
  // Checa ANTES do auto-clear de 3.5s: a limpeza tem que acontecer no
  // instante em que o candidato vira marcação, não só quando o timer estoura.
  const candidatoJaNulo = await page.evaluate(() => window.__EFRAT.Fila.candidato === null);
  expect(candidatoJaNulo).toBe(true);
  // Espera o timer estourar e confirma que o DOM também esvazia — hide não é apagar.
  await page.waitForFunction(() => document.getElementById('cartao').innerHTML === '', null, { timeout: 8000 });
});

test('critério 3 — código de aprovação só existe no textContent do elemento visível, some da página inteira depois de aprovado', async ({ page }) => {
  await abrir(page, ctx.url);
  await expect(page.locator('#aguardando')).not.toHaveClass(/hide/);
  const codigo = await page.textContent('#aguardandoCodigo');
  expect(codigo).toMatch(/^[A-Z0-9]{6}$/);
  await aprovar(page);
  // Nem em atributo, nem em elemento escondido: procura a string inteira na página.
  const html = await page.content();
  expect(html).not.toContain(codigo);
  const codigoNoElemento = await page.textContent('#aguardandoCodigo');
  expect(codigoNoElemento).toBe('');
});

test('critério 4 — sem resquício entre pessoas: nome da pessoa anterior não sobra na página depois da transição', async ({ page }) => {
  await abrir(page, ctx.url, 'p-ana');
  await aprovar(page);
  await marcar(page);
  await page.waitForFunction(() => document.getElementById('cartao').innerHTML === '', null, { timeout: 8000 });
  const html = await page.content();
  expect(html).not.toContain('Ana Souza');
});

test('critério 5a — aparelho que nunca completou cadastro (sem rede desde o boot) falha fechado', async ({ page }) => {
  // apiBase morta desde o primeiro boot: nem o cadastro inicial completa.
  await page.addInitScript(() => {
    window.__EFRAT_FAKE_FACE = { pessoa: 'p-ana' };
    window.EFRAT_CFG = { apiBase: 'http://127.0.0.1:1/webhook', chartCdn: '' };
  });
  await page.goto(ctx.url + '/index.html');
  await page.waitForFunction(() => window.__EFRAT && window.__EFRAT.Face.pronto, null, { timeout: 20000 });
  await page.waitForTimeout(2000);
  await expect(page.locator('#porta')).toHaveClass(/hide/);
  await expect(page.locator('#aguardando')).not.toHaveClass(/hide/);
  const dispositivo = await page.evaluate(() => window.__EFRAT.S.dispositivo);
  expect(dispositivo && dispositivo.info).toBeFalsy();
});

test('critério 5b — aparelho cadastrado mas NUNCA aprovado (ficou pendente) não libera quando a rede cai', async ({ page }) => {
  // Este é o cenário que a primeira versão deste código errava: identidade já
  // existe localmente (o cadastro rodou), mas o RH nunca aprovou — e a
  // checagem de estado que provaria isso não consegue rodar porque a rede
  // caiu. Falta de rede não pode virar sinônimo de "já foi aprovado".
  await abrir(page, ctx.url, 'p-ana');
  await page.waitForFunction(() => window.__EFRAT.S.dispositivo, null, { timeout: 20000 });
  await expect(page.locator('#aguardando')).not.toHaveClass(/hide/);

  await page.evaluate(() => { window.EFRAT_CFG.apiBase = 'http://127.0.0.1:1/webhook'; });
  await page.evaluate(() => window.__EFRAT.verificarDispositivo());
  await page.waitForTimeout(500);

  await expect(page.locator('#porta')).toHaveClass(/hide/);
  await expect(page.locator('#aguardando')).not.toHaveClass(/hide/);
});

// T-E3DBD4 — achado da integração (docs, não arquivo: a decisão fechou sem
// levar ao cliente porque servidor-falso.js:181-182 já pulava a checagem de
// credencial de dispositivo para /efrat/rh/*, e js/app.js:7 já dizia que o RH
// "nunca precisa do aparelho do campo" — só o roteamento client-side
// contrariava os dois. #btnAcessar morava dentro de #porta, que mostrarAguardando()
// esconde; aparelho nunca aprovado == RH nunca alcançável == ninguém aprova.
test('T-E3DBD4 — RH alcançável com aparelho pendente, sem liberar carga nem o botão de ponto', async ({ page }) => {
  await abrir(page, ctx.url);
  await expect(page.locator('#aguardando')).not.toHaveClass(/hide/);
  await expect(page.locator('#btnAcessar')).toBeVisible();

  await page.click('#btnAcessar');
  await expect(page.locator('#loginRh')).not.toHaveClass(/hide/);

  // senha errada continua negada
  await page.fill('#rhUsuario', 'rh');
  await page.fill('#rhSenha', 'errada');
  await page.click('#btnEntrarRh');
  await expect(page.locator('#toast')).toContainText('invalidos', { timeout: 8000 });
  await expect(page.locator('#rh')).toHaveClass(/hide/);

  // senha válida abre o RH — mesmo bypass de derivação PBKDF2 que
  // tests/e2e/fluxo.spec.js usa pra ficar determinístico.
  await page.evaluate(() => {
    window.__EFRAT.Rh.entrar = async function (u) {
      const d = await window.__EFRAT.ApiRh.dados({ usuario: u, chave: 'CHAVE-DE-TESTE' }, 30);
      if (!d.ok) return { ok: false, erro: d.erro };
      this.cred = { usuario: u, chave: 'CHAVE-DE-TESTE' };
      this.dados = d.dados;
      return { ok: true };
    };
  });
  await page.fill('#rhSenha', 'qualquer');
  await page.click('#btnEntrarRh');
  await expect(page.locator('#rh')).not.toHaveClass(/hide/, { timeout: 15000 });

  // durante todo o fluxo, carga da unidade e botão de ponto continuam presos
  expect(ctx.estado.chamadas.carga).toBe(0);
  await expect(page.locator('#porta')).toHaveClass(/hide/);

  // logout não presume #porta — o aparelho continua pendente de verdade
  await page.click('#btnSairRh');
  await expect(page.locator('#aguardando')).not.toHaveClass(/hide/, { timeout: 8000 });
  await expect(page.locator('#porta')).toHaveClass(/hide/);
  expect(ctx.estado.chamadas.carga).toBe(0);
});
