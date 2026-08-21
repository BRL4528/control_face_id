// O aviso de ausência de prova de vida tem de aparecer nos DOIS caminhos em que
// ninguém do RH acompanha a captura: o link para o celular E o upload de fotos.
//
// Invariante 5.1b de docs/fase3-seguranca.md. Decisão registrada pelo
// Orquestrador ao aceitar §5: "o aviso de ausência de liveness em upload e link".
//
// POR QUE O UPLOAD É O MAIS IMPORTANTE DOS DOIS, e não o menos: no link a foto é
// tirada na hora, no celular do próprio colaborador. No upload a imagem já
// existe pronta, e o RH normalmente não sabe de onde ela veio — é o caminho em
// que "foto de foto passa" (README.md:125) é mais fácil e mais difícil de
// perceber. É também o caminho usado justamente quando o colaborador está longe,
// ou seja, quando o RH tem menos como conferir a procedência.
//
// NASCE VERMELHO: hoje o aviso está presoa `viaLink = t.origem === 'link'`
// (js/rh.js), então um item `rh_upload` não mostra aviso nenhum.

import { test, expect } from '@playwright/test';
import { subir, semearRecadastro } from './servidor-falso.js';

let ctx;

test.beforeEach(async () => {
  ctx = await subir();
});
test.afterEach(async () => { await new Promise(r => ctx.servidor.close(r)); });

async function entrarNoRh(page) {
  await page.addInitScript(a => {
    window.__EFRAT_FAKE_FACE = { pessoa: 'p-ana' };
    window.EFRAT_CFG = { apiBase: a + '/webhook', chartCdn: '' };
  }, ctx.url);
  await page.goto(ctx.url + '/index.html');
  await page.waitForFunction(() => window.__EFRAT && window.__EFRAT.Face.pronto, null, { timeout: 20000 });
  // A chave do usuário falso é texto puro e o cliente real deriva PBKDF2 —
  // nunca batem. Todo spec do projeto contorna assim.
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
  await page.click('#rh nav button[data-aba="pendencias"]');
}

/** O card daquele template, seja qual for a seção em que ele caiu. */
function card(page, templateId) {
  return page.locator(`.pendface:has(#gate-${templateId})`);
}

test('cadastro por upload avisa que ninguém acompanhou a captura', async ({ page }) => {
  semearRecadastro(ctx.estado, {
    template_id: 't-upload', pessoa_id: 'p-ana', versao: 2,
    origem: 'rh_upload', criado_em: new Date().toISOString()
  });

  await entrarNoRh(page);

  await expect(card(page, 't-upload'), 'a semente tem de renderizar, senão nada é provado')
    .toHaveCount(1);
  await expect(card(page, 't-upload').locator('.aviso'),
    'upload é o caminho em que foto de foto é mais fácil — precisa avisar').toHaveCount(1);
});

test('cadastro por link continua avisando', async ({ page }) => {
  // Contraprova: sem ela, o teste acima passaria se o aviso sumisse dos dois.
  semearRecadastro(ctx.estado, {
    template_id: 't-link', pessoa_id: 'p-ana', versao: 2,
    origem: 'link', criado_em: new Date().toISOString()
  });

  await entrarNoRh(page);

  await expect(card(page, 't-link').locator('.aviso')).toHaveCount(1);
});

test('cadastro pela câmera do RH não avisa — o RH estava vendo a pessoa', async ({ page }) => {
  // Aviso em todo lugar é aviso em lugar nenhum. Este é o teste que impede a
  // correção fácil e errada: encher os três caminhos de aviso.
  semearRecadastro(ctx.estado, {
    template_id: 't-camera', pessoa_id: 'p-ana', versao: 2,
    origem: 'rh_camera', criado_em: new Date().toISOString()
  });

  await entrarNoRh(page);

  await expect(card(page, 't-camera').locator('.aviso')).toHaveCount(0);
});
