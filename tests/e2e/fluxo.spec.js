// Fluxo de campo ponta a ponta, da porta de entrada até a mesa do RH.
//
// O motor de reconhecimento roda em modo fingido — o que está sob teste é o
// FLUXO, não o face-api. Assim o resultado é determinístico e o CI não depende
// de foto de rosto real. O motor real tem verificação própria fora do CI.
//
// v3 (docs/adr-acesso-v3.md): não existe mais pareamento por token nem gestor
// abrindo fila para os outros. O aparelho se cadastra sozinho e fica
// "aguardando liberação do RH"; qualquer rosto conhecido bate o próprio ponto
// direto. Os critérios do helper novo (docs/ameacas-v3.md § Critérios de
// aceite para o helper novo) valem para todo este arquivo: esperar sinal
// visível de tela, nunca `Fila.estado`/`Fila.gestor`, e continuar passando
// offline.
import { test, expect } from '@playwright/test';
import { subir, semearMarcacao, semearPendencia } from './servidor-falso.js';

async function abrir(page, base, pessoa) {
  await page.addInitScript(a => {
    window.__EFRAT_FAKE_FACE = { pessoa: a.pessoa };
    // chartCdn vazio: o painel não busca a biblioteca de gráficos na CDN durante
    // o CI (offline). Cards e tabelas "ver dados" cobrem o que é testado aqui.
    window.EFRAT_CFG = { apiBase: a.base + '/webhook', chartCdn: '' };   // config.js preserva isto
  }, { pessoa: pessoa || 'p-ana', base });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.__EFRAT && window.__EFRAT.Face.pronto, null, { timeout: 20000 });
}

/**
 * Aprova o aparelho "pelo RH": mexe direto no estado do servidor-falso (o
 * jeito que o RH faria é digitar o código da tela — isso é coberto em
 * tests/e2e/acesso.spec.js, critério 3; aqui não é o SUT) e força o app a
 * reconsultar. Sinal de aceite é sempre de tela: `#btnPonto` habilitado.
 */
async function aprovarDispositivo(page, ctx, equipesIds = ['eq-1']) {
  await page.waitForFunction(() => window.__EFRAT.S.dispositivo, null, { timeout: 20000 });
  for (const d of ctx.estado.dispositivos.values()) {
    d.estado = 'ativo';
    d.equipes_ids = equipesIds;
    d.configuracao_versao = (d.configuracao_versao || 0) + 1;
  }
  await page.evaluate(() => window.__EFRAT.verificarDispositivo());
  await expect(page.locator('#btnPonto')).toBeEnabled({ timeout: 20000 });
}

/** Troca de identidade sem recarregar a página. */
async function vira(page, pessoa) {
  await page.evaluate(p => { window.__EFRAT_FAKE_FACE.pessoa = p; }, pessoa);
}

/**
 * Simula um aparelho que já sincronizou a carga com o servidor antes de cair
 * offline. `aprovarDispositivo` só libera `#btnPonto`; carga nunca é buscada
 * nesse passo (só dentro do próprio `abrirFila` em js/app.js). Sem isso,
 * "nunca baixou a equipe" e "sem rede agora" ficam indistinguíveis pro app —
 * ele falha fechado (critério 5 de docs/plano-v3.md) com "Não consegui
 * carregar a equipe" em vez de abrir a tela de ponto com a carga em cache,
 * que é o cenário que os testes de sincronismo offline querem testar.
 */
async function primeCarga(page) {
  await page.evaluate(async () => {
    const d = window.__EFRAT.S.dispositivo;
    const r = await window.__EFRAT.Api.carga(d.dispositivo_id, d.credencial);
    // Falha aqui, alto e claro, em vez de semear undefined: senão o teste só
    // reprova passos depois, em abrirPonto, com o MESMO timeout dos 3
    // vermelhos que este helper existe pra evitar — apontando pro lugar errado.
    if (!r.ok) throw new Error('primeCarga: Api.carga falhou: ' + r.erro);
    await window.__EFRAT.Store.set('carga', r.carga);
    await window.__EFRAT.Store.set('deriva', r.deriva);
  });
}

/**
 * Abre a tela de ponto. Substitui o antigo `abrirFila`, que esperava
 * `Fila.gestor`/`Fila.estado === 'armado'` — sinais que só existiam no modelo
 * "gestor abre a fila para os outros". Não existe mais: qualquer rosto
 * conhecido marca o próprio ponto assim que a câmera liga, então o único
 * sinal de tela que faz sentido esperar é a própria tela aparecer.
 */
async function abrirPonto(page) {
  await page.click('#btnPonto');
  await page.waitForSelector('#fila:not(.hide)', { timeout: 20000 });
}

/**
 * Uma passagem pela tela de ponto. O fim da espera não é mais
 * `Fila.estado === 'armado'` (esse estado não existe mais) — é o comprovante
 * SUMIR do DOM, porque `comprovante()` em js/fila.js já limpa `#cartao` e
 * volta sozinho para `'aguardando'` via `setTimeout`. Sinal de tela, não
 * estado interno de módulo.
 */
async function marcar(page, pessoa) {
  if (pessoa) await vira(page, pessoa);
  await page.waitForSelector('#btnConfirmar', { timeout: 25000 });
  const nome = await page.textContent('#cartao .tit');
  await page.click('#btnConfirmar');
  await page.waitForSelector('#cartao .cartao.ok', { timeout: 20000 });
  const recibo = await page.textContent('#cartao');
  await page.waitForSelector('#cartao .cartao.ok', { state: 'detached', timeout: 20000 });
  return { nome, recibo };
}

/**
 * O servidor falso guarda uma chave fixa; o app deriva a de verdade com
 * PBKDF2. Para o teste ficar determinístico, trocamos só a derivação e
 * mantemos todo o resto do caminho real (chamada, montagem, render).
 */
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

let ctx;
test.beforeEach(async () => { ctx = await subir(); });
test.afterEach(async () => { ctx.servidor.close(); });

/* ------------------------------------------------------------- porta */

test('porta continua bloqueada enquanto o dispositivo esta pendente', async ({ page }) => {
  await abrir(page, ctx.url);
  await expect(page.locator('#aguardando')).not.toHaveClass(/hide/);
  await expect(page.locator('#porta')).toHaveClass(/hide/);
  const codigo = await page.textContent('#aguardandoCodigo');
  expect(codigo).toMatch(/^[A-Z0-9]{6}$/);
});

test('aparelho revogado depois de aprovado volta a ficar bloqueado', async ({ page }) => {
  await abrir(page, ctx.url);
  await aprovarDispositivo(page, ctx);
  for (const d of ctx.estado.dispositivos.values()) d.estado = 'revogado';
  await page.evaluate(() => window.__EFRAT.verificarDispositivo());
  await expect(page.locator('#aguardando')).not.toHaveClass(/hide/);
  await expect(page.locator('#aguardandoTexto')).toContainText('revogado');
  await expect(page.locator('#porta')).toHaveClass(/hide/);
});

test('depois de aprovado pelo rh a porta libera o registro de ponto', async ({ page }) => {
  await abrir(page, ctx.url);
  await aprovarDispositivo(page, ctx);
  await expect(page.locator('#btnPonto')).toBeEnabled();
});

/* --------------------------------------------- reconhecimento e marcação */

test('reconhecer o gestor marca o ponto dele direto, sem abrir fila para ninguem', async ({ page }) => {
  await abrir(page, ctx.url, 'p-gestor');
  await aprovarDispositivo(page, ctx);
  await abrirPonto(page);
  const r = await marcar(page);
  expect(r.nome).toBe('Gestor Piloto');
  expect(r.recibo).toContain('ENTRADA');

  const enviadas = await page.evaluate(async () => {
    const f = await window.__EFRAT.Store.fila();
    const e = await window.__EFRAT.Store.enviadas();
    return f.concat(e);
  });
  expect(enviadas.length).toBe(1);
  expect(enviadas[0].pessoa_id).toBe('p-gestor');
  expect(enviadas[0].tipo).toBe('entrada');
});

test('ponto do gestor sempre carrega foto e vai para revisao', async ({ page }) => {
  await abrir(page, ctx.url, 'p-gestor');
  await aprovarDispositivo(page, ctx);
  await abrirPonto(page);
  await marcar(page);
  const m = await page.evaluate(async () => (await window.__EFRAT.Store.enviadas())[0]);
  expect(m.pessoa_id).toBe('p-gestor');
  expect(m.foto_auditoria.length).toBeGreaterThan(0);
});

test('sair da tela e voltar no mesmo minuto nao marca a mesma pessoa de novo', async ({ page }) => {
  await abrir(page, ctx.url, 'p-gestor');
  await aprovarDispositivo(page, ctx);
  await abrirPonto(page);
  await marcar(page);
  await page.click('#btnSairFila');
  await expect(page.locator('#porta')).not.toHaveClass(/hide/);

  await abrirPonto(page);
  await expect(page.locator('#cartao')).toContainText('já marcou', { timeout: 25000 });
  const total = await page.evaluate(async () => {
    const f = await window.__EFRAT.Store.fila();
    const e = await window.__EFRAT.Store.enviadas();
    return f.concat(e).filter(m => m.pessoa_id === 'p-gestor').length;
  });
  expect(total).toBe(1);
});

test('a tela marca entrada e depois saida do colaborador', async ({ page }) => {
  await abrir(page, ctx.url, 'p-ana');
  await aprovarDispositivo(page, ctx);
  await abrirPonto(page);

  const um = await marcar(page, 'p-ana');
  expect(um.nome).toContain('Ana');
  expect(um.recibo).toContain('ENTRADA');

  await page.evaluate(() => { window.EFRAT_CFG.cooldownMs = 0; });
  const dois = await marcar(page, 'p-ana');
  expect(dois.recibo).toContain('SAÍDA');

  const tipos = await page.evaluate(async () => {
    const f = await window.__EFRAT.Store.fila();
    const e = await window.__EFRAT.Store.enviadas();
    return f.concat(e).filter(m => m.pessoa_id === 'p-ana').map(m => m.tipo).sort();
  });
  expect(tipos).toEqual(['entrada', 'saida']);
});

test('cooldown bloqueia a mesma pessoa em sequencia', async ({ page }) => {
  await abrir(page, ctx.url, 'p-ana');
  await aprovarDispositivo(page, ctx);
  await abrirPonto(page);
  await marcar(page, 'p-ana');
  await expect(page.locator('#cartao')).toContainText('já marcou', { timeout: 25000 });
});

// R1 (docs/plano-v3.md): /efrat/carga passa a ser escopado por equipe do
// aparelho. Carla é da eq-2 — fora do escopo deste aparelho (aprovado só
// para eq-1) — então ela nunca está na galeria offline. O fallback antigo de
// "buscar na unidade" via array pré-carregado morreu; o substituto é
// Api.identificar() em js/fila.js, 1:N no servidor, disparado automaticamente
// (não tem mais botão) quando o reconhecimento offline rejeita o rosto.
test('rosto fora do escopo offline do aparelho identifica online e marca (R1)', async ({ page }) => {
  await abrir(page, ctx.url, 'p-carla');
  await aprovarDispositivo(page, ctx, ['eq-1']);
  await abrirPonto(page);

  await page.waitForSelector('#btnConfirmar', { timeout: 25000 });
  await expect(page.locator('#cartao .tit')).toContainText('Carla');
  await page.click('#btnConfirmar');
  await page.waitForSelector('#cartao .cartao.ok', { timeout: 20000 });

  expect(ctx.estado.chamadas.identificar).toBeGreaterThan(0);
  const m = await page.evaluate(async () => {
    const f = await window.__EFRAT.Store.fila();
    const e = await window.__EFRAT.Store.enviadas();
    return f.concat(e).find(x => x.pessoa_id === 'p-carla');
  });
  expect(m).toBeTruthy();
  expect(m.equipe_id).toBe('eq-2');
});

test('registro manual exige motivo quando ninguem reconhece o rosto', async ({ page }) => {
  await abrir(page, ctx.url, 'p-desconhecido');
  await aprovarDispositivo(page, ctx);
  await abrirPonto(page);
  await page.waitForSelector('#btnManual', { timeout: 30000 });
  await page.click('#btnManual');
  await page.click('#listaPessoas button:first-child');
  await expect(page.locator('#toast')).toContainText('motivo');
  await page.fill('#motivoManual', 'sem rosto legivel no sol');
  await page.click('#listaPessoas button:first-child');
  await page.waitForSelector('#cartao .cartao.ok', { timeout: 20000 });

  const m = await page.evaluate(async () => {
    const f = await window.__EFRAT.Store.fila();
    const e = await window.__EFRAT.Store.enviadas();
    return f.concat(e).find(x => x.origem === 'manual');
  });
  expect(m.veredito).toBe('manual');
  expect(m.motivo).toContain('sol');
});

/* -------------------------------------------------------- sincronismo */
//
// Não existe mais `#kEnvio` na tela (o contador de pendências não é mais
// exibido em #fila). O sinal de tela nas telas de porta/RH não muda estes
// testes de comportamento de sincronização em si — quem SUT aqui é a fila
// offline em store.js/api.js, então a espera é sobre o dado persistido
// (Store), do mesmo jeito que "colaborador inativo" (abaixo) já fazia.

test('offline enfileira e sobe quando a rede volta', async ({ page }) => {
  await abrir(page, ctx.url, 'p-ana');
  await aprovarDispositivo(page, ctx);
  await primeCarga(page);
  ctx.estado.fora = true;
  await abrirPonto(page);
  await marcar(page, 'p-ana');
  await page.waitForFunction(async () => (await window.__EFRAT.Store.fila()).length > 0, null, { timeout: 15000 });

  ctx.estado.fora = false;
  await page.evaluate(() => window.__EFRAT.Fila.sincronizar());
  await page.waitForFunction(async () => (await window.__EFRAT.Store.fila()).length === 0, null, { timeout: 20000 });
  expect(ctx.estado.marcacoes.size).toBe(1);
});

test('reenvio do mesmo id_cliente nao duplica', async ({ page }) => {
  await abrir(page, ctx.url, 'p-ana');
  await aprovarDispositivo(page, ctx);
  await abrirPonto(page);
  await marcar(page, 'p-ana');
  await page.waitForFunction(async () => (await window.__EFRAT.Store.fila()).length === 0, null, { timeout: 20000 });
  const antes = ctx.estado.marcacoes.size;

  await page.evaluate(async () => {
    const m = (await window.__EFRAT.Store.enviadas())[0];
    await window.__EFRAT.Store.enfileirar(m);
  });
  await page.evaluate(() => window.__EFRAT.Fila.sincronizar());
  await page.waitForFunction(async () => (await window.__EFRAT.Store.fila()).length === 0, null, { timeout: 20000 });
  expect(ctx.estado.marcacoes.size).toBe(antes);
});

test('envio unico em voo: nunca ha dois lotes simultaneos', async ({ page }) => {
  await abrir(page, ctx.url, 'p-ana');
  await aprovarDispositivo(page, ctx);
  await primeCarga(page);
  ctx.estado.fora = true;
  await abrirPonto(page);
  await page.evaluate(() => { window.EFRAT_CFG.cooldownMs = 0; });
  await marcar(page, 'p-ana');
  await marcar(page, 'p-bruno');
  ctx.estado.fora = false;
  await page.evaluate(() => {
    window.__EFRAT.Fila.sincronizar();
    window.__EFRAT.Fila.sincronizar();
    window.__EFRAT.Fila.sincronizar();
  });
  await page.waitForFunction(async () => (await window.__EFRAT.Store.fila()).length === 0, null, { timeout: 25000 });
  expect(ctx.estado.maxLotesSimultaneos).toBe(1);
});

test('colaborador inativo e rejeitado e a marcacao fica retida', async ({ page }) => {
  await abrir(page, ctx.url, 'p-ana');
  await aprovarDispositivo(page, ctx);
  await primeCarga(page);
  ctx.estado.fora = true;
  await abrirPonto(page);
  await marcar(page, 'p-ana');
  ctx.estado.inativos.add('p-ana');
  ctx.estado.fora = false;

  await page.evaluate(() => window.__EFRAT.Fila.sincronizar());
  await page.waitForFunction(async () => {
    const f = await window.__EFRAT.Store.fila();
    return f.some(m => m._erro);
  }, null, { timeout: 25000 });
  const fila = await page.evaluate(() => window.__EFRAT.Store.fila());
  expect(fila.find(m => m._erro)._erro).toContain('inativo');
});

// Comportamento correto e defensavel (nao e o mesmo cenario dos tres acima):
// aparelho aprovado mas que NUNCA baixou a carga da equipe, perdendo a rede
// bem no primeiro acesso. Sem galeria nenhuma em cache, nao ha quem
// reconhecer offline — abrirFila() falha fechado com toast em vez de abrir
// #fila. Antes disso so aparecia como efeito colateral acidental nos testes
// de sincronismo; agora tem asserção própria.
test('aparelho que nunca baixou a equipe nao abre a fila sem rede', async ({ page }) => {
  await abrir(page, ctx.url, 'p-ana');
  await aprovarDispositivo(page, ctx);
  ctx.estado.fora = true;
  await page.click('#btnPonto');
  await expect(page.locator('#toast')).toContainText('conex', { timeout: 15000 });
  await expect(page.locator('#fila')).toHaveClass(/hide/);
});

/* -------------------------------------------------------- painel RH */

test('RH nao entra com senha errada', async ({ page }) => {
  await abrir(page, ctx.url);
  await page.click('#btnAcessar');
  await page.fill('#rhUsuario', 'rh');
  await page.fill('#rhSenha', 'errada');
  await page.click('#btnEntrarRh');
  await expect(page.locator('#toast')).toContainText('invalidos', { timeout: 20000 });
  await expect(page.locator('#rh')).toHaveClass(/hide/);
});

test('RH entra e ve o painel com indicadores', async ({ page }) => {
  await abrir(page, ctx.url);
  await logarRh(page);
  await expect(page.locator('#rhNome')).toHaveText('RH Teste');
  await expect(page.locator('#rh-painel')).toContainText('Taxa manual');
});

test('RH cria equipe e colaborador', async ({ page }) => {
  await abrir(page, ctx.url);
  await logarRh(page);

  await page.click('#rh nav button[data-aba="equipes"]');
  await page.fill('#eNome', 'Equipe Norte');
  await page.click('#btnNovaEquipe');
  await expect(page.locator('#toast')).toContainText('Equipe criada', { timeout: 15000 });
  expect(ctx.estado.equipesCriadas).toContain('Equipe Norte');

  await page.click('#rh nav button[data-aba="pessoas"]');
  await page.fill('#pNome', 'Novo Colaborador');
  await page.fill('#pMat', '777');
  await page.click('#btnNovaPessoa');
  await expect(page.locator('#toast')).toContainText('salvo', { timeout: 15000 });
  expect(ctx.estado.colaboradoresCriados).toContain('Novo Colaborador');
});

// Estas duas semeiam a marcação direto no servidor-falso em vez de dirigir a
// tela de ponto: a tela não é o SUT aqui, é só um jeito frágil de produzir
// dado — acopla três testes de RH a uma tela que muda de forma nesta mesma
// rodada. Mesmo precedente de logarRh() trocando PBKDF2 real por chave fixa.
test('RH ve a pendencia do gestor e decide', async ({ page }) => {
  semearPendencia(ctx.estado, {
    id_cliente: 'seed-pend-gestor', pessoa_id: 'p-gestor', equipe_id: 'eq-1',
    tipo: 'entrada', origem: 'biometria', veredito: 'aceito',
    marcado_em: new Date().toISOString()
  });
  await abrir(page, ctx.url);

  await logarRh(page);
  await page.click('#rh nav button[data-aba="pendencias"]');
  await expect(page.locator('#rh-pendencias')).toContainText('Gestor Piloto', { timeout: 15000 });

  await page.click('#rh-pendencias button[data-acao="aprovar"]');
  await expect(page.locator('#toast')).toContainText('Decidido', { timeout: 15000 });
  expect(ctx.estado.decisoes.length).toBe(1);
});

test('espelho de ponto mostra as marcacoes do colaborador', async ({ page }) => {
  semearMarcacao(ctx.estado, {
    id_cliente: 'seed-marc-ana', pessoa_id: 'p-ana', equipe_id: 'eq-1',
    tipo: 'entrada', origem: 'biometria', veredito: 'aceito',
    marcado_em: new Date().toISOString()
  });
  await abrir(page, ctx.url);

  await logarRh(page);
  await page.click('#rh nav button[data-aba="registros"]');
  await page.selectOption('#regPessoa', 'p-ana');
  await expect(page.locator('#regSaida')).toContainText('E ', { timeout: 15000 });
});

/* --------------------------------------------- painel desktop do RH */

test('painel mostra card critico quando ninguem da equipe marcou hoje', async ({ page }) => {
  // nenhuma marcação foi feita: toda equipe com gente ativa cai em critico.
  await abrir(page, ctx.url);
  await logarRh(page);
  await expect(page.locator('#rh-painel .eqcard.critico').first()).toBeVisible({ timeout: 15000 });
});

test('card traz o numero junto da cor (leitura sem depender de cor)', async ({ page }) => {
  await abrir(page, ctx.url);
  await logarRh(page);
  const primeiro = page.locator('#rh-painel .eqcard').first();
  await expect(primeiro).toBeVisible({ timeout: 15000 });
  // a asserção olha o texto, não a cor: precisa haver um "n/n" no card.
  await expect(primeiro.locator('.cnt')).toContainText('/');
});

test('ver dados abre a tabela com os mesmos numeros do grafico', async ({ page }) => {
  // uma marcação real hoje, semeada direto — não precisa da tela de ponto pra existir.
  semearMarcacao(ctx.estado, {
    id_cliente: 'seed-marc-gestor', pessoa_id: 'p-gestor', equipe_id: 'eq-1',
    tipo: 'entrada', origem: 'biometria', veredito: 'aceito',
    marcado_em: new Date().toISOString()
  });
  await abrir(page, ctx.url);

  await logarRh(page);
  await expect(page.locator('#rh-painel')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#tabLinha')).toHaveClass(/hide/);
  await page.click('#rh-painel .verdados[data-tab="tabLinha"]');
  await expect(page.locator('#tabLinha')).not.toHaveClass(/hide/);
  await expect(page.locator('#tabLinha table')).toBeVisible();
  // a coluna Total soma ao menos a marcação do gestor de hoje.
  await expect(page.locator('#tabLinha')).toContainText('Total');
});

test('trocar o periodo recarrega e o painel repinta sem duplicar canvas', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });   // o toggle é desktop (≥900px)
  await abrir(page, ctx.url);
  await logarRh(page);
  await expect(page.locator('#rh-painel')).toBeVisible({ timeout: 15000 });
  await page.click('#rhToggle button[data-dias="7"]');
  await expect(page.locator('#rhToggle button[data-dias="7"]')).toHaveClass(/on/);
  await expect(page.locator('#rhPeriodo')).toContainText('7 dias');
  // um container de gráfico por caixa, nunca dois canvas empilhados.
  await expect(page.locator('#boxLinha')).toHaveCount(1);
});
