import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extrairCoordenadas } from '../../js/geo-parse.js';

test('coordenadas coladas com vírgula e espaço', () => {
  assert.deepEqual(extrairCoordenadas('-20.4697, -54.6201'), { lat: -20.4697, lng: -54.6201 });
});
test('coordenadas sem espaço', () => {
  assert.deepEqual(extrairCoordenadas('-20.4697,-54.6201'), { lat: -20.4697, lng: -54.6201 });
});
test('link do Maps com @lat,lng', () => {
  assert.deepEqual(extrairCoordenadas('https://www.google.com/maps/@-20.4697,-54.6201,15z'),
    { lat: -20.4697, lng: -54.6201 });
});
test('link do Maps com ?q=lat,lng', () => {
  assert.deepEqual(extrairCoordenadas('https://maps.google.com/?q=-20.46,-54.62'),
    { lat: -20.46, lng: -54.62 });
});
test('link de place com !3d!4d (sem @ para não colidir)', () => {
  assert.deepEqual(extrairCoordenadas('https://www.google.com/maps/place/X/data=!3d-20.4697!4d-54.6201'),
    { lat: -20.4697, lng: -54.6201 });
});
test('link com @ tem prioridade sobre !3d!4d', () => {
  assert.deepEqual(extrairCoordenadas('https://www.google.com/maps/place/X/@-20.40,-54.60,17z/data=!3d-20.4697!4d-54.6201'),
    { lat: -20.40, lng: -54.60 });
});
test('link encurtado devolve erro explicativo, não coordenada', () => {
  const r = extrairCoordenadas('https://maps.app.goo.gl/abc123');
  assert.ok(r && r.erro, 'deve sinalizar que não dá para extrair de link encurtado');
});
test('texto qualquer (endereço) devolve null — vira busca', () => {
  assert.equal(extrairCoordenadas('Rua das Flores, 123'), null);
});
test('coordenadas fora da faixa são rejeitadas', () => {
  assert.equal(extrairCoordenadas('999, 999'), null);
});
