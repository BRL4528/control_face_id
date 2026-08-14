// Guardas contra erros que só aparecem depois do deploy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ler = p => fs.readFileSync(path.join(RAIZ, p), 'utf8');

test('todo arquivo listado no service worker existe', () => {
  const sw = ler('sw.js');
  const lista = [...sw.matchAll(/'(\.\/[^']+)'/g)].map(m => m[1]).filter(a => a !== './');
  assert.ok(lista.length > 5, 'lista de assets suspeita de vazia');
  for (const a of lista) {
    assert.ok(fs.existsSync(path.join(RAIZ, a)), 'sw.js aponta para arquivo inexistente: ' + a);
  }
});

test('todo script referenciado no index existe', () => {
  const html = ler('index.html');
  const srcs = [...html.matchAll(/src="(\.\/[^"]+)"/g)].map(m => m[1]);
  assert.ok(srcs.includes('./js/app.js'));
  for (const s of srcs) {
    assert.ok(fs.existsSync(path.join(RAIZ, s)), 'index.html aponta para arquivo inexistente: ' + s);
  }
});

test('todo modulo importado pelo app existe', () => {
  const arquivos = fs.readdirSync(path.join(RAIZ, 'js')).filter(f => f.endsWith('.js'));
  for (const f of arquivos) {
    const src = ler('js/' + f);
    for (const m of src.matchAll(/from\s+'(\.\/[^']+)'/g)) {
      assert.ok(fs.existsSync(path.join(RAIZ, 'js', m[1])), f + ' importa ' + m[1] + ' que nao existe');
    }
  }
});

test('os modelos do face-api estao no repositorio', () => {
  for (const m of ['tiny_face_detector', 'face_landmark_68', 'face_recognition']) {
    assert.ok(fs.existsSync(path.join(RAIZ, 'models', m + '_model.bin')), 'falta o peso de ' + m);
    assert.ok(fs.existsSync(path.join(RAIZ, 'models', m + '_model-weights_manifest.json')), 'falta o manifesto de ' + m);
  }
});

test('o manifesto do PWA aponta para icones que existem', () => {
  const man = JSON.parse(ler('manifest.json'));
  for (const i of man.icons) {
    assert.ok(fs.existsSync(path.join(RAIZ, i.src.replace('./', ''))), 'icone ausente: ' + i.src);
  }
});

test('nenhum token de verdade foi commitado na configuracao', () => {
  const cfg = ler('js/config.js');
  assert.ok(!/token\s*:/i.test(cfg), 'config.js nao pode conter token — ele vira publico no bundle');
});

test('o service worker nao intercepta chamadas de outra origem', () => {
  const sw = ler('sw.js');
  assert.match(sw, /url\.origin\s*!==\s*location\.origin/,
    'sem esse guarda, resposta de marcacao pode ser servida do cache');
});
