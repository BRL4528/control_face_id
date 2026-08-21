import { test, expect } from '@playwright/test';
import { subir } from './servidor-falso.js';

test('app carrega offline na segunda visita apos ativacao do service worker', async ({ page, context }) => {
  const { url, servidor, estado } = await subir();
  try {
    // 1. Primeira visita: carrega a aplicação. O app nasce trancado
    //    (docs/fase3-rh-pessoas.md — T-87615C): a primeira tela real é
    //    #aguardando, não #porta. Libera o aparelho "pelo RH" mexendo direto
    //    no servidor-falso — não é o SUT deste teste — pra chegar num #porta
    //    de verdade, senão a passagem 5 provaria só que um HTML qualquer veio
    //    do cache, não que o aparelho liberado continua usável offline.
    // js/config.js do repo aponta pro n8n de produção por padrão — sem este
    // override o aparelho tentaria se cadastrar contra produção e o teste
    // penduraria esperando uma rede que este ambiente não alcança (mesmo
    // guard que fluxo.spec.js/gestor.spec.js/acesso.spec.js já usam).
    await page.addInitScript(a => {
      window.__EFRAT_FAKE_FACE = { pessoa: 'p-ana' };
      window.EFRAT_CFG = { apiBase: a + '/webhook', chartCdn: '' };
    }, url);
    await page.goto(url + '/index.html');
    await page.waitForFunction(() => window.__EFRAT && window.__EFRAT.Face.pronto, null, { timeout: 20000 });
    await page.waitForFunction(() => window.__EFRAT.S.dispositivo, null, { timeout: 15000 });
    for (const d of estado.dispositivos.values()) {
      d.estado = 'ativo'; d.equipes_ids = ['eq-1', 'eq-2']; d.configuracao_versao = 1;
    }
    await page.evaluate(() => window.__EFRAT.verificarDispositivo());
    await expect(page.locator('#btnPonto')).toBeEnabled({ timeout: 15000 });

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

    // 5. Valida que a aplicação carrega normalmente offline a partir do cache
    //    do SW, e que o aparelho já liberado continua usável sem rede — não só
    //    que o HTML carregou. Offline-first é requisito do produto
    //    (docs/adr-acesso-v3.md), não um efeito colateral do cache do shell.
    await expect(page.locator('#porta')).toBeVisible();
    await expect(page.locator('#btnPonto')).toBeEnabled();
    const title = await page.title();
    expect(title).toContain('Ponto Facial');
  } finally {
    await new Promise(r => servidor.close(r));
  }
});
