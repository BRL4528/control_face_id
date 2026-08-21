// Contrato da liberação de aparelho — o código curto como prova de posse física.
//
// Invariantes de docs/fase3-seguranca.md §2.1. Cartão que implementa: T-87615C.
//
// Divisão em duas metades, de propósito:
//
//   VIVOS  — 2.1b e 2.1d valem contra o servidor de hoje e já rodam. 2.1b em
//            especial é o guarda de regressão que importa: quando a aba de
//            aparelhos pendentes for construída, o caminho mais natural de
//            implementar (mandar a lista de pendentes com o código junto, para
//            o RH achar a linha) destrói a prova de posse — é o "Novo 2" de
//            docs/ameacas-v3.md. O teste tem de existir ANTES da aba.
//
//   ARMADOS — 2.1a, 2.1c, 2.1e e 2.1f dependem da rota de aprovação, que ainda
//            não existe (é o achado 3 do QA: hoje os testes aprovam mexendo no
//            Map do servidor-falso, fluxo.spec.js:34-44). Ficam em test.fixme
//            para não deixar a suíte vermelha por rota ausente, que é ruído e
//            não defeito. Quatro deles foram religados quando T-87615C entrou;
//            só LIMITE_APROVAÇÃO segue armado, atrelado ao T-C20AD3.
//
// PORQUE A CONTRAPROVA VEM PRIMEIRO EM CADA TESTE ARMADO: um teste que só
// afirma "sem código não ativa" PASSA contra uma rota que não existe — 404 não
// ativa nada. Verde por ausência de implementação é pior que vermelho. Por isso
// cada teste armado primeiro prova que o caminho feliz funciona, e só então
// nega.

import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import { criarServidor } from './servidor-falso.js';

// T-87615C entrou: a rota é /efrat/rh/aparelho, ação 'aprovar', e ela resolve
// o pendente SOMENTE pelo código digitado — nunca por dispositivo_id.
const ROTA_APROVAR = '/efrat/rh/aparelho/aprovar';
const RH = { usuario: 'rh', chave: 'CHAVE-DE-TESTE' };

let ctx;

test.beforeEach(async () => {
  const { servidor, estado } = criarServidor({});
  await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve));
  ctx = { servidor, estado, base: `http://127.0.0.1:${servidor.address().port}/webhook` };
});

test.afterEach(async () => { await new Promise(resolve => ctx.servidor.close(resolve)); });

/** Registra um aparelho de verdade pela rota pública e devolve o que o servidor respondeu. */
async function registrar(request, apelido = 'Tablet obra norte') {
  const credencial = 'cred-' + crypto.randomUUID();
  const r = await request.post(`${ctx.base}/efrat/dispositivo/registrar`, {
    data: {
      dispositivo_id: crypto.randomUUID(),
      credencial_publica: crypto.createHash('sha256').update(credencial).digest('base64url'),
      apelido, ua: 'playwright'
    },
    failOnStatusCode: false
  });
  const corpo = await r.json();
  return { credencial, dispositivo_id: corpo.dispositivo_id, codigo: corpo.codigo_curto, corpo };
}

async function leituraRh(request, rota = '/efrat/rh/dados') {
  const r = await request.post(`${ctx.base}${rota}`, { data: { ...RH, dias: 30 }, failOnStatusCode: false });
  return { status: r.status(), texto: await r.text() };
}

async function aprovar(request, dados) {
  return request.post(`${ctx.base}${ROTA_APROVAR}`, {
    // Contrato §1.3: o corpo NAO tem dispositivo_id, pendente_id nem local_id.
    // O alvo e o codigo e mais nada.
    data: { ...RH, idempotency_key: crypto.randomUUID(), equipes_ids: ['eq-1'], ...dados },
    failOnStatusCode: false
  });
}

async function estadoDoAparelho(request, { dispositivo_id, credencial }) {
  const r = await request.post(`${ctx.base}/efrat/dispositivo/estado`, {
    headers: { Authorization: `Bearer ${credencial}` },
    data: { dispositivo_id }, failOnStatusCode: false
  });
  return (await r.json()).estado;
}

/* ========================================================== VIVOS (rodam hoje) */

/* 2.1b — o código nunca aparece em leitura do RH */

test('nenhuma leitura do RH devolve o código curto de um aparelho pendente', async ({ request }) => {
  const a = await registrar(request);
  expect(a.codigo, 'o servidor tem de gerar o código no registro').toBeTruthy();

  const { texto } = await leituraRh(request);

  // Serializado inteiro: pega o código em campo próprio, aninhado, ou de brinde
  // dentro de um objeto de aparelho que alguém mandou "só para o RH achar".
  expect(texto, 'o código só pode existir na tela do aparelho físico').not.toContain(a.codigo);
});

test('o código não vaza junto com a lista de aparelhos pendentes', async ({ request }) => {
  // Guarda de regressão para a aba nova (item A). Vale contra qualquer rota de
  // leitura do RH que venha a existir: se a aba de pendentes for servida por
  // /rh/dados ou por rota própria, nenhuma das duas pode carregar o código.
  const a = await registrar(request, 'Totem Portaria');
  const b = await registrar(request, 'Tablet RH 2');

  for (const rota of ['/efrat/rh/dados', '/efrat/rh/dispositivos', '/efrat/rh/aparelhos']) {
    const { status, texto } = await leituraRh(request, rota);
    if (status === 404) continue;            // rota ainda não existe: nada a vazar
    expect(texto, `${rota} vazou o código de ${a.dispositivo_id}`).not.toContain(a.codigo);
    expect(texto, `${rota} vazou o código de ${b.dispositivo_id}`).not.toContain(b.codigo);
  }
});

/* 2.1d — o código não é derivável do que o RH enxerga */

test('o código é aleatório: não deriva do dispositivo_id nem do apelido', async ({ request }) => {
  const amostra = [];
  for (let i = 0; i < 8; i++) amostra.push(await registrar(request, `Tablet ${i}`));

  const codigos = amostra.map(a => a.codigo);
  expect(new Set(codigos).size, 'códigos repetidos entre pendentes').toBe(codigos.length);

  for (const a of amostra) {
    const uuid = a.dispositivo_id.replace(/-/g, '').toUpperCase();
    expect(uuid, 'código é substring do UUID — seria derivável').not.toContain(a.codigo);
    expect(a.codigo).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);  // sem 0/O/1/I/L
  }
});

test('dois registros do mesmo aparelho não geram um código previsível', async ({ request }) => {
  const a = await registrar(request);
  const b = await registrar(request);
  expect(a.codigo).not.toBe(b.codigo);
});

/* ====================================================== ARMADOS (T-87615C) */

/* 2.1a — a ativação é resolvida PELO CÓDIGO, não pela linha escolhida */

test('T-87615C · aprovar sem informar o código não ativa o aparelho', async ({ request }) => {
  const a = await registrar(request);

  // Contraprova primeiro: com o código certo, ativa. Sem isto, o teste passaria
  // contra um 404 e diria que a invariante está sustentada quando não há rota.
  const feliz = await aprovar(request, { dispositivo_id: a.dispositivo_id, codigo: a.codigo });
  expect(feliz.status(), 'o caminho feliz precisa existir antes de negar nada').toBe(200);
  expect(await estadoDoAparelho(request, a)).toBe('ativo');

  // Agora a negação, num aparelho novo: só o dispositivo_id, que é o que o
  // painel do RH já conhece. Não pode bastar.
  const b = await registrar(request);
  const semCodigo = await aprovar(request, { dispositivo_id: b.dispositivo_id });
  expect(semCodigo.status(), 'dispositivo_id sozinho não pode ativar').toBeGreaterThanOrEqual(400);
  expect(await estadoDoAparelho(request, b)).toBe('pendente');
});

test('T-87615C · código errado não ativa, e não ativa o aparelho vizinho', async ({ request }) => {
  const alvo = await registrar(request, 'Tablet legítimo');
  const outro = await registrar(request, 'Totem Portaria');

  // MUDOU DE NATUREZA COM O CONTRATO §1.1 REGRA 2, e vale registrar por quê em
  // vez de apagar o teste. O Cenário 2 de docs/ameacas-v3.md ("aprovar a linha
  // errada") foi ELIMINADO POR DESENHO, não mitigado: o corpo de
  // /efrat/rh/aparelho/aprovar não tem `dispositivo_id`, então não existe forma
  // de expressar "ative o aparelho X usando o código Y". Só existe "digite um
  // código", e ele ativa o dono do código.
  //
  // O teste sobrevive como GUARDA DA ELIMINAÇÃO: manda `dispositivo_id` mesmo
  // assim — um campo que o contrato não define — e exige que ele não consiga
  // dirigir nada. Se alguém reintroduzir seleção por id (o pedido plausível é
  // "para desambiguar"), isto fica vermelho. A vulnerabilidade sumiu; este é o
  // teste que a mantém sumida.
  await aprovar(request, { dispositivo_id: alvo.dispositivo_id, codigo: outro.codigo });

  expect(await estadoDoAparelho(request, alvo),
    'dispositivo_id no corpo não pode dirigir a aprovação').toBe('pendente');
  expect(await estadoDoAparelho(request, outro),
    'o código é a autoridade: quem o exibe é quem o RH está olhando').toBe('ativo');
});

test('T-C20AD3 · os quatro casos de código que não resolve dão UMA resposta só', async ({ request }) => {
  // Contrato §1.3: inexistente, expirado, recusado e já ativo respondem todos
  // 404 CODIGO_NAO_ENCONTRADO, com a mesma mensagem. É a invariante 1.6b de
  // docs/fase3-seguranca.md: diferenciar entrega um oráculo de enumeração de
  // graça — "esse código existe mas expirou" já é informação que o adversário
  // não tinha.
  const aprovado = await registrar(request, 'Tablet já aprovado');
  expect((await aprovar(request, { codigo: aprovado.codigo })).status()).toBe(200);

  const expirado = await registrar(request, 'Tablet esquecido');
  ctx.estado.dispositivos.get(expirado.dispositivo_id).criado_em =
    new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();

  const respostas = [];
  for (const codigo of ['ZZZZZZ', expirado.codigo, aprovado.codigo]) {
    const r = await aprovar(request, { codigo });
    respostas.push({ status: r.status(), corpo: await r.text() });
  }

  for (const r of respostas) expect(r.status).toBe(404);
  const distintas = new Set(respostas.map(r =>
    r.corpo.replace(/"request_id"\s*:\s*"[^"]*"/, '')));
  expect(distintas.size,
    'inexistente, expirado e já ativo têm de ser indistinguíveis').toBe(1);
});

test('T-C20AD3 · letra fora do alfabeto é erro de digitação, não pista sobre existência', async ({ request }) => {
  // 422 CODIGO_COM_LETRA_INVALIDA é distinguível do 404 DE PROPÓSITO, e isso
  // NÃO abre oráculo: é propriedade estática da string digitada, verdadeira
  // antes de consultar qualquer linha. Registrado aqui para ninguém
  // "uniformizar" isso em 404 depois achando que fecha vazamento — só faria o
  // RH procurar defeito onde não tem.
  const r = await aprovar(request, { codigo: 'ABC0IL' });
  expect(r.status()).toBe(422);
  expect(await r.text()).toContain('CODIGO_COM_LETRA_INVALIDA');
});

test('T-87615C · um código só serve uma vez', async ({ request }) => {
  const a = await registrar(request);

  expect((await aprovar(request, { dispositivo_id: a.dispositivo_id, codigo: a.codigo })).status()).toBe(200);
  const repetida = await aprovar(request, { dispositivo_id: a.dispositivo_id, codigo: a.codigo });
  expect(repetida.status(), 'código já consumido não aprova de novo').toBeGreaterThanOrEqual(400);
});

/* 2.1e — tentativa de código errado é limitada e contada */

// 2.1e — limite de tentativa de código errado.
//
// A ASSERÇÃO ANTERIOR DESTE TESTE ERA VACUOSA E QUEM ACHOU FOI O 508cd44fd2.
// Ela fazia `expect(textoDeRhDados).toContain('tentativas')` para provar
// "visibilidade das tentativas erradas" — mas `tentativas` já existe na linha
// do aparelho por outro motivo inteiramente diferente (contagem de rotação de
// pedido de um pendente, contrato §1.2), e é serializado no payload do RH de
// qualquer jeito. Passaria sempre, com ou sem contagem de código errado.
// Mesma família do resto da fase, desta vez na minha própria mão.
//
// O que sobra depois de tirar a parte vacuosa é o que de fato para o ataque: o
// limite. A "visibilidade" não vira teste aqui porque não existe campo para
// ela no contrato — e inventar um campo para satisfazer um teste seria deixar
// o teste dirigir o desenho. Fica registrado como lacuna aberta em
// docs/fase3-seguranca.md, não como asserção fingida.
test.fixme('T-C20AD3 · código errado esbarra em limite, e o limite segura até o código certo', async ({ request }) => {
  const a = await registrar(request);

  let bloqueou = null;
  for (let i = 0; i < 12 && !bloqueou; i++) {
    const r = await aprovar(request, { codigo: 'ZZZZZZ' });
    if (r.status() === 429) bloqueou = r;
  }
  expect(bloqueou, 'força bruta de código precisa esbarrar em limite').not.toBeNull();
  expect(bloqueou.headers()['retry-after'],
    'sem Retry-After o cliente não sabe quando voltar').toBeTruthy();

  // A parte que prova que o limite é limite: dentro da janela, nem o código
  // CERTO passa. Sem isto, "bloqueou" poderia ser só uma mensagem diferente.
  const comCerto = await aprovar(request, { codigo: a.codigo });
  expect(comCerto.status()).toBe(429);
  expect(await estadoDoAparelho(request, a)).toBe('pendente');
});

test.fixme('T-C20AD3 · o limite é contado depois de autenticar, não antes', async ({ request }) => {
  // Se a contagem vier ANTES da checagem de usuário/chave, quem souber só o
  // nome do usuário de RH derruba a aprovação de aparelhos por 5 minutos sem
  // ter credencial nenhuma — vira negação de serviço contra o próprio RH,
  // usando a defesa como arma. Credencial errada tem de ser 401 e não pode
  // consumir cota.
  for (let i = 0; i < 12; i++) {
    const r = await request.post(`${ctx.base}${ROTA_APROVAR}`, {
      data: { usuario: RH.usuario, chave: 'chave-errada',
              idempotency_key: crypto.randomUUID(), codigo: 'ZZZZZZ', equipes_ids: ['eq-1'] },
      failOnStatusCode: false
    });
    expect(r.status(), 'credencial errada é 401, nunca 429').toBe(401);
  }

  // E o RH legítimo continua podendo aprovar: a cota dele não foi gasta.
  const a = await registrar(request);
  expect((await aprovar(request, { codigo: a.codigo })).status()).toBe(200);
});

/* 2.1f — pendente expira sozinho */

test('T-87615C · pendente além de 24h não é mais aprovável, nem com o código certo', async ({ request }) => {
  const a = await registrar(request);
  const linha = ctx.estado.dispositivos.get(a.dispositivo_id);
  linha.criado_em = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();

  const r = await aprovar(request, { dispositivo_id: a.dispositivo_id, codigo: a.codigo });

  expect(r.status(), 'pendente esquecido não pode virar acesso futuro').toBeGreaterThanOrEqual(400);
  expect(await estadoDoAparelho(request, a)).not.toBe('ativo');
});

/* ============================================ 2.1g — o sinal de aceite discrimina

Guarda contra uma classe de defeito, não contra um bug pontual.

MEDIDO no navegador, com o aparelho PENDENTE (nunca aprovado), quando este
guarda foi escrito:

    ultimo_estado  : "pendente"
    #porta          : escondido
    #btnPonto.disabled : false        <-- habilitado mesmo trancado

CORRIGIDO DEPOIS: `index.html:29` passou a nascer `disabled`, e hoje o botão
também discrimina. As duas assertivas abaixo travam as duas propriedades.

`expect(locator).toBeEnabled()` NÃO olha visibilidade — só o atributo. Então
`await expect(page.locator('#btnPonto')).toBeEnabled()` PASSA com o aparelho
pendente. Isso era o sinal de "aparelho aprovado" em `aprovarDispositivo`
(fluxo.spec.js), em `aprovar` (acesso.spec.js, gestor.spec.js), em
offline.spec.js e em aparelhos.spec.js — ~26 chamadas de teste confirmando uma
aprovação com uma condição que já era verdadeira ANTES de aprovar.

O caso mais grave era `fluxo.spec.js:151`, o teste chamado "depois de aprovado
pelo rh a porta libera o registro de ponto": ele não conseguia falhar se a
aprovação parasse de funcionar por completo.

`#porta` visível é o sinal certo porque é falso enquanto pendente — e é sinal de
tela, não de propriedade interna, que é o critério 1 já registrado em
docs/ameacas-v3.md para o helper novo. */

test('sinal de aceite: #porta escondido enquanto pendente, e por isso btnPonto habilitado não serve', async ({ page }) => {
  await page.addInitScript(a => {
    window.__EFRAT_FAKE_FACE = { pessoa: 'p-ana' };
    window.EFRAT_CFG = { apiBase: a + '/webhook', chartCdn: '' };
  }, `http://127.0.0.1:${ctx.servidor.address().port}`);
  await page.goto(`http://127.0.0.1:${ctx.servidor.address().port}/index.html`);
  await page.waitForFunction(() => window.__EFRAT && window.__EFRAT.Face.pronto, null, { timeout: 20000 });
  await page.waitForFunction(() => window.__EFRAT.S.dispositivo, null, { timeout: 20000 });

  // O aparelho nunca foi aprovado. O sinal CERTO tem de ser falso agora.
  await expect(page.locator('#porta'), 'porta não pode abrir com aparelho pendente').toBeHidden();

  // E agora o botão também discrimina: `index.html:29` passou a nascer
  // `disabled` e só `irParaPorta()` habilita, o que só acontece com o aparelho
  // ativo. Este guarda nasceu documentando o defeito (o botão vinha habilitado
  // embaixo da tela escondida) e a própria mensagem de falha dele mandava
  // revisá-lo se isso mudasse. Mudou. Então ele vira o contrário: trava a
  // correção para ela não regredir.
  await expect(page.locator('#btnPonto'),
    'botão de ponto não pode estar habilitado com o aparelho pendente').toBeDisabled();
});
