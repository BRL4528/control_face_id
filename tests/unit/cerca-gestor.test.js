import { test } from 'node:test';
import assert from 'node:assert/strict';
import { perimetroDoPonto, configGestorQualquerCerca } from '../../api/_lib/cerca-gestor.js';

// sql falso: tagged template que devolve as linhas combinadas (locais + escalas do dia)
const sqlCom = linhas => () => Promise.resolve(linhas);
const obra = (nome, lat, lng, raio = 200) => ({ nome, cerca_lat: lat, cerca_lng: lng, cerca_raio_m: raio });

test('ponto dentro de um perímetro de outra equipe é reconhecido', async () => {
  const sql = sqlCom([obra('Obra A', -20.4600, -54.6200), obra('Obra B', -20.5000, -54.7000)]);
  const r = await perimetroDoPonto(sql, 'e1', '2026-10-06', -20.5001, -54.7001, 10);
  assert.equal(r.nome, 'Obra B');
});

test('fora de todos os perímetros devolve null', async () => {
  const sql = sqlCom([obra('Obra A', -20.4600, -54.6200)]);
  assert.equal(await perimetroDoPonto(sql, 'e1', '2026-10-06', -21.0, -55.0, 10), null);
});

test('sem GPS devolve null; sobreposição escolhe o centro mais próximo', async () => {
  const sql = sqlCom([obra('Grande', -20.4600, -54.6200, 5000), obra('Pequena', -20.4610, -54.6200, 200)]);
  assert.equal(await perimetroDoPonto(sql, 'e1', '2026-10-06', null, null, 10), null);
  const r = await perimetroDoPonto(sql, 'e1', '2026-10-06', -20.4609, -54.6200, 10);
  assert.equal(r.nome, 'Pequena');
});

test('parâmetro: ausente = ligado; "false" = desligado', async () => {
  assert.equal(await configGestorQualquerCerca(sqlCom([]), 'e1'), true);
  assert.equal(await configGestorQualquerCerca(sqlCom([{ v: 'true' }]), 'e1'), true);
  assert.equal(await configGestorQualquerCerca(sqlCom([{ v: 'false' }]), 'e1'), false);
});
