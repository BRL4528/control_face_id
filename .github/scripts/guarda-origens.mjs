// As tres origens do projeto conferem entre si, e com as CSPs.
//
// O que esta guarda existe para pegar, e que nada mais pegaria: duas das tres
// origens virarem a mesma. Isso NAO quebra nada visivelmente — as paginas
// continuam abrindo — e desfaz o isolamento inteiro, porque IndexedDB, Cache
// Storage e escopo de service worker isolam por ORIGEM, nao por caminho.
// Falha silenciosa e cara e exatamente o caso que merece guarda.

import fs from 'node:fs';
import {
  apiBaseEfetiva, origemDe, connectSrcExternos,
  cspDoHeaders, cspDoVercelJson, declaradas
} from './origens.mjs';

const falhas = [];
const falhar = m => falhas.push(m);
const ok = m => console.log('  ok  ' + m);

const { bruto, origens, legado } = declaradas();

// ---------------------------------------------------------------- 1. distintas
{
  const vistas = new Map();
  for (const [nome, origem] of Object.entries(origens)) {
    if (!origem) { console.log(`  --  origem "${nome}" ainda nao existe (${bruto[nome].projeto_vercel}) — nao da pra conferir esta linha`); continue; }
    if (vistas.has(origem)) {
      falhar(`"${nome}" e "${vistas.get(origem)}" apontam para a MESMA origem (${origem}). ` +
             `Isso desfaz o isolamento sem quebrar nada visivelmente: IndexedDB e Cache Storage sao por origem. ` +
             `A pagina publica passaria a ler o banco 'efrat-ponto' do app, onde esta a credencial de 256 bits do aparelho.`);
    }
    vistas.set(origem, nome);
  }
  if (!falhas.length) ok(`origens declaradas distintas entre si (${vistas.size} conferidas)`);
}

const permitidas = new Set([origens.api, legado].filter(Boolean));

// ------------------------------------------- 2. apiBase EFETIVA de cada origem
// Nao e grep: o arquivo e avaliado como o navegador avalia (licao do T-F1E72A).
const runtime = [
  { nome: 'app',     config: 'js/config.js',              csps: { '_headers': cspDoHeaders('_headers'), 'vercel.json': cspDoVercelJson('vercel.json') } },
  { nome: 'publica', config: 'publico/js/config-face.js', csps: { 'publico/vercel.json': cspDoVercelJson('publico/vercel.json') } }
];

for (const r of runtime) {
  if (!fs.existsSync(r.config)) { falhar(`${r.config} nao existe — a origem "${r.nome}" perdeu a configuracao de runtime`); continue; }

  let base;
  try { base = apiBaseEfetiva(r.config); }
  catch (e) { falhar(`${r.config}: ${e.message}`); continue; }
  const origemBase = origemDe(base);

  if (!permitidas.has(origemBase)) {
    falhar(`a apiBase EFETIVA de ${r.config} e ${origemBase}, que nao esta declarada em origens.json. ` +
           `Declare (com o porque) ou corrija — CSP conferida contra host nao declarado e CSP conferida contra nada.`);
  }

  for (const [arquivo, csp] of Object.entries(r.csps)) {
    if (!csp) { falhar(`${arquivo} nao tem Content-Security-Policy`); continue; }
    const externos = connectSrcExternos(csp);
    if (externos === null) { falhar(`${arquivo}: CSP sem connect-src`); continue; }

    if (!externos.some(h => origemDe(h) === origemBase)) {
      falhar(`${arquivo}: connect-src NAO libera ${origemBase}, que e a apiBase efetiva de ${r.config}. ` +
             `Em producao toda chamada de API seria bloqueada pelo navegador.`);
    }
    for (const h of externos) {
      if (!permitidas.has(origemDe(h))) {
        falhar(`${arquivo}: connect-src libera ${h}, que nao esta declarado em origens.json. ` +
               `connect-src e o destino para onde a pagina pode ENVIAR dado — host a mais aqui e alvo de exfiltracao.`);
      }
    }
  }
  ok(`${r.nome}: apiBase efetiva ${origemBase}, liberada em ${Object.keys(r.csps).join(' e ')}`);

  // A ordem do Object.assign continua load-bearing: quem define EFRAT_CFG antes
  // TEM de vencer, senao `npm run serve` e os specs voltam a falar com producao.
  const forcado = 'http://127.0.0.1:1/webhook';
  if (apiBaseEfetiva(r.config, { EFRAT_CFG: { apiBase: forcado } }) !== forcado) {
    falhar(`${r.config}: a apiBase injetada antes do arquivo NAO vence o default. ` +
           `A ordem dos argumentos do Object.assign inverteu — todo teste local passaria a falar com PRODUCAO, sem erro na tela.`);
  }
}

// ------------------------------------------------ 3. o deploy do app nao leva
// as outras duas origens, nem codigo de servidor.
{
  const linhas = fs.readFileSync('.vercelignore', 'utf8')
    .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  for (const exigido of ['publico', 'servidor', 'nucleo', 'origens.json']) {
    if (!linhas.includes(exigido)) {
      falhar(`.vercelignore nao exclui "${exigido}" — ele seria publicado na origem do APP. ` +
             `A fronteira entre as origens e garantida por AUSENCIA do arquivo, nao por regra de rota.`);
    }
  }
  if (!falhas.length) ok('.vercelignore exclui as outras duas origens e o codigo de servidor');
}

// ----------------------------- 4. nucleo/ so chega na API por copia de build
// Guarda que dispara no dia em que a condicao ficar real, para o requisito nao
// depender de alguem lembrar.
{
  if (fs.existsSync('nucleo')) {
    const cfg = fs.existsSync('servidor/vercel.json') ? JSON.parse(fs.readFileSync('servidor/vercel.json', 'utf8')) : {};
    const temCopia = typeof cfg.buildCommand === 'string' && /nucleo/.test(
      cfg.buildCommand + (fs.existsSync('servidor/copiar-nucleo.sh') ? fs.readFileSync('servidor/copiar-nucleo.sh', 'utf8') : '')
    );
    if (!temCopia) {
      falhar('nucleo/ ja existe, mas servidor/vercel.json nao tem passo de build que o copie. ' +
             'A API deployaria SEM o nucleo do dominio — ou, pior, com uma copia velha. ' +
             'Monte a copia como publico/copiar-assets.sh (Include source files outside of the Root Directory ligado).');
    } else ok('nucleo/ existe e servidor/ tem o passo de copia');
  } else {
    console.log('  --  nucleo/ ainda nao existe (cartao API-1) — a exigencia da copia acende quando ele nascer');
  }
}

// --------------------------------------------------- 5. CORS da API nunca '*'
{
  // Varre servidor/ E nucleo/. A versao anterior varria so servidor/ e o regex
  // nem casava a forma que o codigo usa — a decisao de CORS mora em
  // nucleo/http.js, que so entra em servidor/ pela copia de BUILD. Guarda que
  // nao alcanca o arquivo que decide nao guarda nada, e esta passou verde
  // por cima de um `*` real.
  const arquivos = [];
  const andar = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.vercel' || e.name === 'public') continue;
    const p = d + '/' + e.name;
    if (e.isDirectory()) andar(p); else if (/\.(js|mjs)$/.test(e.name)) arquivos.push(p);
  } };
  for (const raiz of ['servidor', 'nucleo']) if (fs.existsSync(raiz)) andar(raiz);

  const curinga = [];
  for (const f of arquivos) {
    if (f.startsWith('servidor/nucleo/')) continue;   // copia de build, mesmo arquivo
    fs.readFileSync(f, 'utf8').split('\n').forEach((linha, i) => {
      if (/Access-Control-Allow-Origin/.test(linha) && /['"`]\*['"`]/.test(linha)) {
        curinga.push(`${f}:${i + 1}`);
      }
    });
  }

  // Em servidor/ (codigo de plataforma) '*' nao tem justificativa nenhuma: falha.
  const meus = curinga.filter(c => c.startsWith('servidor/'));
  for (const c of meus) {
    falhar(`${c}: CORS com '*'. Com '*' qualquer pagina da internet chama esta ` +
           `origem do navegador do colaborador. A lista vem de ORIGENS_PERMITIDAS.`);
  }

  // Em nucleo/ o '*' e a politica CORS.ABERTO, decidida e documentada. Nao falha
  // aqui — mas NAO passa calado, porque a justificativa escrita nela morreu:
  // ela diz "nenhuma dessas rotas e alcancada de origem alheia hoje", e desde
  // que a apiBase passou a apontar para a origem propria da API, TODAS sao.
  const deles = curinga.filter(c => c.startsWith('nucleo/'));
  if (deles.length) {
    console.log(`  !!  CORS.ABERTO usa '*' em ${deles.join(', ')} — decisao do nucleo, nao falha aqui.`);
    console.log("      MAS a premissa escrita nela ('nenhuma dessas rotas e alcancada de origem");
    console.log('      alheia hoje\u0027) ficou FALSA quando a apiBase passou a apontar para a origem');
    console.log('      propria da API: o app virou cross-origin e as 8 rotas passaram a ser');
    console.log('      alcancadas de outra origem. Reveja a politica ou reescreva a premissa.');
  } else {
    ok(`CORS sem '*' (${arquivos.length} arquivos em servidor/ e nucleo/)`);
  }
}

if (falhas.length) {
  for (const f of falhas) console.error('::error::' + f);
  process.exit(1);
}
console.log('as tres origens conferem entre si e com as CSPs');
