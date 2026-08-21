// Marcação de aparelho revogado, PONTA A PONTA pelo cliente real.
//
// Invariante 2.2 de docs/fase3-seguranca.md, parte c. O gap que este arquivo
// fecha foi levantado pelo próprio Full-Stack (508cd44fd2) ao conferir o
// T-D00CE0: existe unitário para `itensParaRemover`/`itensRecusados`, e existe
// contrato provando que o servidor responde `retido` e nunca 403
// (marcacao-aparelho-revogado-contrato.spec.js) — mas não existia e2e passando
// por `js/api.js` de verdade e confirmando que a fila local ESVAZIA sem
// retentar. O caminho gêmeo, pessoa inativa, já tem esse e2e em fluxo.spec.js.
//
// POR QUE O PAR IMPORTA, e é a razão de a invariante ter duas metades: só o
// lado do servidor produz o pior arranjo dos três. Se o servidor recusa e o
// cliente não solta, o lote volta para sempre, em silêncio — e a marcação
// legítima do colaborador honesto some sem ninguém ver. Antes do T-D00CE0 o
// arranjo era o oposto: o servidor aceitava, e aparelho revogado gravava ponto.

import { test, expect } from '@playwright/test';
import { subir } from './servidor-falso.js';

let ctx;
test.beforeEach(async () => { ctx = await subir(); });
test.afterEach(async () => { await new Promise(r => ctx.servidor.close(r)); });

async function abrir(page, pessoa = 'p-ana') {
  await page.addInitScript(a => {
    window.__EFRAT_FAKE_FACE = { pessoa: a.pessoa };
    window.EFRAT_CFG = { apiBase: a.base + '/webhook', chartCdn: '' };
  }, { pessoa, base: ctx.url });
  await page.goto(ctx.url + '/index.html');
  await page.waitForFunction(() => window.__EFRAT && window.__EFRAT.Face.pronto, null, { timeout: 20000 });
}

async function aprovarDispositivo(page) {
  await page.waitForFunction(() => window.__EFRAT.S.dispositivo, null, { timeout: 20000 });
  for (const d of ctx.estado.dispositivos.values()) {
    d.estado = 'ativo'; d.equipes_ids = ['eq-1']; d.configuracao_versao = 1;
  }
  await page.evaluate(() => window.__EFRAT.verificarDispositivo());
  // #porta visível é o sinal que discrimina — btnPonto habilitado sozinho já
  // era verdadeiro antes de aprovar (docs/fase3-seguranca.md 2.1g).
  await expect(page.locator('#porta')).toBeVisible({ timeout: 20000 });
}

async function primeCarga(page) {
  await page.evaluate(async () => {
    const d = window.__EFRAT.S.dispositivo;
    const r = await window.__EFRAT.Api.carga(d.dispositivo_id, d.credencial);
    // Falha alto aqui em vez de semear undefined: senão o teste só reprova
    // passos depois, apontando para o lugar errado (mesmo motivo do helper
    // gêmeo em fluxo.spec.js).
    if (!r.ok) throw new Error('primeCarga: Api.carga falhou: ' + r.erro);
    await window.__EFRAT.Store.set('carga', r.carga);
    await window.__EFRAT.Store.set('deriva', r.deriva);
  });
}

function revogar() {
  for (const d of ctx.estado.dispositivos.values()) {
    d.estado = 'revogado';
    d.revogado_em = new Date().toISOString();
  }
}

test('marcação batida ANTES da revogação sai da fila local como retida e nunca é reenviada', async ({ page }) => {
  await abrir(page);
  await aprovarDispositivo(page);
  await primeCarga(page);

  // Servidor fora: a marcação fica na fila local, que é o estado real de campo
  // (bateu o ponto, ainda não subiu).
  ctx.estado.fora = true;
  await page.click('#btnPonto');
  await page.waitForSelector('#fila:not(.hide)', { timeout: 20000 });
  await page.waitForSelector('#btnConfirmar', { timeout: 25000 });
  await page.click('#btnConfirmar');
  await page.waitForSelector('#cartao .cartao.ok', { timeout: 20000 });

  // ÂNCORA POSITIVA. Sem ela, todas as afirmações seguintes ("a fila esvaziou",
  // "não reenviou") seriam verdade também numa fila que nunca encheu.
  await page.waitForFunction(async () => (await window.__EFRAT.Store.fila()).length > 0,
    null, { timeout: 15000 });

  // O RH revoga o aparelho enquanto a marcação ainda está presa no celular.
  revogar();
  ctx.estado.fora = false;

  await page.evaluate(() => window.__EFRAT.Fila.sincronizar());
  await page.waitForFunction(async () => (await window.__EFRAT.Store.fila()).length === 0,
    null, { timeout: 25000 });

  // 2.2b — não foi descartada: está arquivada como enviada (= "não precisa mais
  // ser reenviada"), e NÃO em recusadas, porque retido não é rejeitado.
  const enviadas = await page.evaluate(() => window.__EFRAT.Store.enviadas());
  const recusadas = await page.evaluate(() => window.__EFRAT.Store.recusadas());
  expect(enviadas.some(m => m.pessoa_id === 'p-ana'),
    'retida tem de ficar arquivada, não sumir').toBe(true);
  expect(recusadas.some(m => m.pessoa_id === 'p-ana'),
    'retida não é rejeitada — não pode cair na coleção de recusadas').toBe(false);

  // 2.2a/2.2b no servidor — o RH decide, o ponto não entra sozinho.
  const noServidor = [...ctx.estado.marcacoes.values()].find(m => m.pessoa_id === 'p-ana');
  expect(noServidor.motivo_codigo).toBe('aparelho_revogado');
  expect(noServidor.requer_revisao).toBe(true);

  // 2.2c — o ponto do arquivo: NÃO RETENTA. Com a fila vazia, `sincronizar`
  // devolve sem tocar na rota, então o contador não pode andar. Era isto que
  // faltava: o contrato provava o servidor, o unitário provava a regra pura,
  // e ninguém provava que o cliente real solta o item.
  const antes = ctx.estado.chamadas.marcacoes;
  await page.evaluate(() => window.__EFRAT.Fila.sincronizar());
  await page.waitForTimeout(500);
  expect(ctx.estado.chamadas.marcacoes,
    'item retido não pode voltar para a rota — era o loop silencioso da 2.2c').toBe(antes);
});

test('aparelho revogado não vira porta aberta: a tela volta a bloquear e o ponto não abre', async ({ page }) => {
  // Contraprova de escopo: o item acima prova que o dado do colaborador honesto
  // sobrevive à revogação. Este prova que a revogação continua valendo como
  // revogação — sem ele, "solta da fila" poderia ser lido como "segue operando".
  await abrir(page);
  await aprovarDispositivo(page);

  revogar();
  await page.evaluate(() => window.__EFRAT.verificarDispositivo());

  await expect(page.locator('#porta')).toBeHidden({ timeout: 20000 });
  await expect(page.locator('#aguardandoTexto')).toContainText('revogado');
});
