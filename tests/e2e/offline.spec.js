import { test, expect } from '@playwright/test';
import { subir } from './servidor-falso.js';

test('app carrega offline na segunda visita apos ativacao do service worker', async ({ page, context }) => {
  const { url, servidor } = await subir();
  try {
    // 1. Primeira visita: carrega a aplicação
    await page.goto(url + '/index.html');
    await page.waitForSelector('#porta', { timeout: 15000 });

    // 2. Aguarda a ativação do Service Worker
    await page.evaluate(async () => {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.ready;
        if (reg.active) return true;
      }
      return false;
    });

    // 3. Simula perda total de conexão no navegador
    await context.setOffline(true);

    // 4. Recarrega a página estando offline
    await page.reload();

    // 5. Valida que a aplicação carrega normalmente offline a partir do cache do SW
    await expect(page.locator('#porta')).toBeVisible();
    const title = await page.title();
    expect(title).toContain('Ponto Facial');
  } finally {
    await new Promise(r => servidor.close(r));
  }
});
