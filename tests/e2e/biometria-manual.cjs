// Fumaça do motor REAL — não roda no CI, e de propósito.
//
// O CI testa o fluxo com o motor fingido, porque é o fluxo que a gente
// escreveu. Este script testa a outra metade: que o face-api de verdade
// carrega, rastreia e devolve um descritor estável. Precisa de um vídeo .y4m
// com um rosto real, que não vai para o repositório por privacidade.
//
//   ffmpeg -loop 1 -i rosto.png -t 2 -r 10 -pix_fmt yuv420p rosto.y4m
//   FR=/caminho/ node tests/e2e/biometria-manual.cjs
//
// Passa quando: descritor tem 128 dimensões, duas capturas da mesma pessoa
// ficam abaixo de 0.20 e a qualidade é aprovada.
// Resultado medido no ambiente de referência: 0.037.
const { chromium } = require('playwright');
const FR = process.env.FR || './tests/fixtures/';

(async () => {
  const { subir } = await import('./servidor-falso.js');
  const ctx = await subir();
  const b = await chromium.launch({
    executablePath: process.env.PW_CHROME || undefined,
    args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
      '--use-file-for-fake-video-capture=' + FR + (process.env.ROSTO || 'rosto.y4m'),
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  const p = await b.newPage({ viewport: { width: 420, height: 900 }, permissions: ['camera'] });
  p.on('pageerror', e => console.log('[PAGEERROR]', String(e).slice(0, 300)));
  await p.addInitScript(base => { window.EFRAT_CFG = { apiBase: base + '/webhook' }; }, ctx.url);
  await p.goto(ctx.url + '/index.html');

  await p.waitForFunction(() => window.__EFRAT && window.__EFRAT.Face.pronto, null, { timeout: 240000 });
  console.log('backend:', await p.evaluate(() => window.__EFRAT.Face.backend));
  console.log('ms carga modelos:', await p.evaluate(() => window.__EFRAT.Face.msCarga));

  await p.fill('#token', 'TOKEN-TESTE');
  await p.click('#btnEntrar');
  await p.waitForSelector('#app:not(.hide)', { timeout: 30000 });
  await p.click('#btnFila');
  await p.waitForTimeout(9000);

  const r = await p.evaluate(async () => {
    const F = window.__EFRAT.Face;
    const a = await F.capturar(document.getElementById('video'));
    const b2 = await F.capturar(document.getElementById('video'));
    if (!a || !b2) return { erro: 'sem captura' };
    return {
      tamanho: a.descritor.length,
      thumb: (a.thumb || '').slice(0, 22),
      mesmaPessoa: F.distancia(a.descritor, b2.descritor),
      modo: F.modo,
      latencia: F.latencia,
      qualidade: { sharp: Math.round(a.qualidade.sharp), bright: Math.round(a.qualidade.bright), ok: a.qualidade.ok }
    };
  });
  console.log('resultado:', JSON.stringify(r, null, 1));

  const ok = r.tamanho === 128 && r.mesmaPessoa < 0.20 && r.qualidade.ok;
  console.log(ok ? '\n✅ motor real funcionando' : '\n❌ motor real com problema');
  await b.close(); ctx.servidor.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.log('CRASH', e); process.exit(2); });
