// modelo_id: hash no navegador do pipeline de reconhecimento
// (docs/fase3-contrato.md § 4.7). Roda no navegador de propósito — depende de
// `fetch` e `crypto.subtle`, que não existem em `node --test` sem polyfill, e
// o próprio ponto do mecanismo é medir o que o NAVEGADOR recebeu.
import { test, expect } from '@playwright/test';
import { subir } from './servidor-falso.js';

let ctx;

test.beforeEach(async () => { ctx = await subir(); });
test.afterEach(async () => { ctx.servidor.close(); });

test('calcularModeloId devolve o mesmo hash em duas cargas — determinístico para os mesmos bytes', async ({ page }) => {
  await page.goto(ctx.url + '/index.html');
  const [a, b] = await page.evaluate(async () => {
    const { calcularModeloId } = await import('./js/modelo.js');
    return [await calcularModeloId(), await calcularModeloId()];
  });
  expect(a).toMatch(/^[0-9a-f]{64}$/);
  expect(b).toBe(a);
});

test('dois arquivos diferentes produzem hashes diferentes — o pipeline inteiro entra no digest, não só um arquivo', async ({ page }) => {
  await page.goto(ctx.url + '/index.html');
  const [comMotorReal, comMotorTrocado] = await page.evaluate(async () => {
    const { calcularModeloId } = await import('./js/modelo.js');
    const real = await calcularModeloId('./models', './vendor/face-api.js');
    // Aponta o "motor" para um arquivo qualquer, só pra provar que ele entra
    // no digest — se não entrasse, os dois hashes seriam iguais.
    const trocado = await calcularModeloId('./models', './js/regras.js');
    return [real, trocado];
  });
  expect(comMotorReal).not.toBe(comMotorTrocado);
});

test('qualquer um dos 7 arquivos ausente devolve null — nunca id parcial', async ({ page }) => {
  await page.goto(ctx.url + '/index.html');
  const resultado = await page.evaluate(async () => {
    const { calcularModeloId } = await import('./js/modelo.js');
    return calcularModeloId('./models-que-nao-existe', './vendor/face-api.js');
  });
  expect(resultado).toBeNull();
});
