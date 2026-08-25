// Fonte unica das guardas que falam de ORIGEM. Tres arquivos de CI faziam a
// mesma extracao por conta propria, e faziam ERRADO do mesmo jeito:
//
//   grep -oE "apiBase:\s*'https?://[^/']+" js/config.js
//
// Isso le o LITERAL escrito no arquivo, nao o valor que o navegador usa. E a
// lição do T-F1E72A, aplicada onde ela ainda nao tinha chegado: `config.js` faz
// Object.assign({default}, window.EFRAT_CFG || {}), entao qualquer coisa que
// defina EFRAT_CFG ANTES dele vence o default. Com a extracao por grep, alguem
// podia apontar o app para outra origem e todas as guardas de CSP continuariam
// conferindo o host antigo — verdes, e cegas.
//
// Aqui o valor e EFETIVO: o arquivo e avaliado como o navegador avalia.

import fs from 'node:fs';

export const RAIZ = process.cwd();

export function lerJson(caminho) {
  return JSON.parse(fs.readFileSync(caminho, 'utf8'));
}

/**
 * Avalia um config de runtime como o navegador faria e devolve a apiBase que
 * REALMENTE vale. `antes` simula algo que tenha definido EFRAT_CFG primeiro.
 */
export function apiBaseEfetiva(caminho, antes = {}) {
  const src = fs.readFileSync(caminho, 'utf8');
  const window = { ...antes };
  new Function('window', src)(window);
  const base = window.EFRAT_CFG && window.EFRAT_CFG.apiBase;
  if (!base) throw new Error(`${caminho} nao definiu EFRAT_CFG.apiBase`);
  return base;
}

export function origemDe(url) {
  return new URL(url).origin;
}

/** Hosts externos citados num connect-src (ignora 'self' e esquemas locais). */
export function connectSrcExternos(csp) {
  const m = csp.match(/connect-src([^;]*)/);
  if (!m) return null;
  return m[1].trim().split(/\s+/).filter(t => /^https?:\/\//.test(t));
}

export function cspDoHeaders(caminho = '_headers') {
  const m = fs.readFileSync(caminho, 'utf8').match(/Content-Security-Policy:\s*(.+)/);
  return m ? m[1].trim() : null;
}

export function cspDoVercelJson(caminho) {
  const regra = lerJson(caminho).headers.find(h => h.source === '/(.*)');
  if (!regra) return null;
  const h = regra.headers.find(x => x.key === 'Content-Security-Policy');
  return h ? h.value : null;
}

/** origens.json, com as origens ja normalizadas e as nulas marcadas. */
export function declaradas() {
  const d = lerJson('origens.json');
  const nomeadas = ['app', 'publica', 'api'];
  const origens = {};
  for (const n of nomeadas) {
    if (!(n in d)) throw new Error(`origens.json nao declara "${n}"`);
    origens[n] = d[n].origem ? origemDe(d[n].origem) : null;
  }
  const legado = d.legado && d.legado.origem ? origemDe(d.legado.origem) : null;
  return { bruto: d, origens, legado };
}

// CLI para as guardas escritas em shell:
//   node .github/scripts/origens.mjs origem-apibase js/config.js
// Imprime a origem da apiBase EFETIVA. Nunca use grep para isto.
if (process.argv[1] && process.argv[1].endsWith('origens.mjs')) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'origem-apibase') {
    process.stdout.write(origemDe(apiBaseEfetiva(arg)));
  } else if (cmd === 'origens-permitidas') {
    const { origens, legado } = declaradas();
    process.stdout.write([origens.api, legado].filter(Boolean).join('\n'));
  } else if (cmd) {
    console.error('comando desconhecido: ' + cmd);
    process.exit(2);
  }
}
