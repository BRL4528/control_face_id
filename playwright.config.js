import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.js',
  fullyParallel: false,          // cada teste sobe o proprio servidor falso
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60000,
  expect: { timeout: 15000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 420, height: 900 },
    permissions: ['camera', 'geolocation'],
    geolocation: { latitude: -20.4428, longitude: -54.6464, accuracy: 20 },
    trace: 'retain-on-failure',
    // No CI o Playwright instala o proprio navegador. Localmente, aproveita o
    // que ja existe em vez de baixar de novo — util em ambiente sem rede livre.
    launchOptions: {
      executablePath: process.env.PW_CHROME || undefined,
      args: [
        '--no-sandbox',
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader'
      ]
    }
  }
});
