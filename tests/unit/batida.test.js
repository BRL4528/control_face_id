import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarBatida, motivoDaBatida } from '../../api/_lib/batida.js';
import { rotuloEmFrase } from '../../api/_lib/ocorrencia.js';
import { imagemReal, assinaturaConfere, comFotoReal } from '../../api/_lib/imagem.js';
import { TIPOS_OCORRENCIA } from '../../js/ocorrencias.js';

const base = extra => Object.assign({
  id_cliente: 'b1a2c3', tipo: 'entrada', origem: 'biometria', veredito: 'aceito', score: 0.3, liveness_ok: true,
  marcado_em: new Date(Date.now() - 60000).toISOString(), deriva_ms: 120, lat: -20.4, lng: -54.6, precisao_m: 12
}, extra);

test('normalizarBatida: batida boa passa e sai normalizada', () => {
  const r = normalizarBatida(base({ equipe_id: '', motivo: '', foto_url: '' }));
  assert.equal(r.erro, undefined);
  assert.equal(r.item.tipo, 'entrada');
  assert.equal(r.item.futuro, false);
  assert.equal(r.item.equipe_id, null);
  assert.equal(r.item.motivo, null);
  assert.equal(r.item.foto_url, null);
  assert.equal(r.item.lat, -20.4);
  assert.match(r.item.marcado_em, /^\d{4}-\d{2}-\d{2}T/);
});

test('normalizarBatida: horário no futuro além de 5 min vai marcado; antiga (offline) continua valendo', () => {
  assert.equal(normalizarBatida(base({ marcado_em: new Date(Date.now() + 10 * 60000).toISOString() })).item.futuro, true);
  assert.equal(normalizarBatida(base({ marcado_em: '2099-06-09T12:00:00Z' })).item.futuro, true);
  assert.equal(normalizarBatida(base({ marcado_em: new Date(Date.now() + 2 * 60000).toISOString() })).item.futuro, false);
  const antiga = normalizarBatida(base({ marcado_em: new Date(Date.now() - 20 * 86400000).toISOString() }));
  assert.equal(antiga.erro, undefined);
  assert.equal(antiga.item.futuro, false);
});

test('normalizarBatida: item inválido é rejeitado com motivo, sem exceção', () => {
  assert.equal(normalizarBatida(null).erro, 'campos obrigatórios ausentes');
  assert.equal(normalizarBatida(base({ id_cliente: '' })).erro, 'campos obrigatórios ausentes');
  assert.equal(normalizarBatida(base({ id_cliente: 123 })).erro, 'campos obrigatórios ausentes');
  assert.equal(normalizarBatida(base({ marcado_em: undefined })).erro, 'campos obrigatórios ausentes');
  assert.equal(normalizarBatida(base({ marcado_em: 'xx' })).erro, 'marcado_em inválido');
  assert.equal(normalizarBatida(base({ marcado_em: { a: 1 } })).erro, 'marcado_em inválido');
  assert.equal(normalizarBatida(base({ tipo: 'almoco' })).erro, 'tipo inválido');
  assert.equal(normalizarBatida(base({ lat: 'abc' })).erro, 'coordenadas inválidas');
  assert.equal(normalizarBatida(base({ lng: 999 })).erro, 'coordenadas inválidas');
  assert.equal(normalizarBatida(base({ lat: [1] })).erro, 'coordenadas inválidas');
  assert.equal(normalizarBatida(base({ id_cliente: 'x'.repeat(101) })).erro, 'id_cliente inválido');
});

test('normalizarBatida: sem GPS vira null; lixo nos opcionais vira null, não 500', () => {
  const r = normalizarBatida(base({ lat: null, lng: '', precisao_m: 'abc', score: 'x', liveness_ok: 'sim', deriva_ms: 'z', origem: 'hack' })).item;
  assert.equal(r.lat, null);
  assert.equal(r.lng, null);
  assert.equal(r.precisao_m, null);
  assert.equal(r.score, null);
  assert.equal(r.liveness_ok, null);
  assert.equal(r.deriva_ms, 0);
  assert.equal(r.origem, 'biometria');
  // só uma das coordenadas: sem GPS
  assert.equal(normalizarBatida(base({ lng: null })).item.lat, null);
  assert.equal(normalizarBatida(base({ lat: '-20.5', lng: '-54.7' })).item.lng, -54.7);
  assert.equal(normalizarBatida(base({ deriva_ms: 1e12 })).item.deriva_ms, 2147483647);
  assert.equal(normalizarBatida(base({ origem: 'manual' })).item.origem, 'manual');
});

test('motivoDaBatida: viagem não apaga a prova de vida reprovada', () => {
  assert.equal(
    motivoDaBatida({ externo: true, cliente: 'prova de vida (giro): base 0,120, maior desvio 0,010, 9 quadros' }),
    'trabalho externo (viagem); prova de vida (giro): base 0,120, maior desvio 0,010, 9 quadros');
  assert.equal(motivoDaBatida({ visitado: 'Obra Sul', cliente: 'prova de vida: sem leitura do rosto' }),
    'gestor em outro local: Obra Sul; prova de vida: sem leitura do rosto');
  assert.equal(motivoDaBatida({ afastado: true, futuro: true }), 'colaborador afastado; horário no futuro');
  assert.equal(motivoDaBatida({ bloqueio: 'afastamento INSS' }), 'colaborador em afastamento INSS');
  assert.equal(motivoDaBatida({ cliente: 'só o app' }), 'só o app');
  assert.equal(motivoDaBatida({}), null);
  assert.equal(motivoDaBatida(), null);
});

test('rotuloEmFrase: só a 1ª letra cai, sigla fica', () => {
  assert.equal(rotuloEmFrase(TIPOS_OCORRENCIA.afastamento_inss.rotulo), 'afastamento INSS');
  assert.equal(rotuloEmFrase(TIPOS_OCORRENCIA.ferias.rotulo), 'férias');
  assert.equal(rotuloEmFrase(TIPOS_OCORRENCIA.licenca.rotulo), 'licença (maternidade, paternidade, outras)');
  assert.equal(rotuloEmFrase('INSS em análise'), 'INSS em análise');
  assert.equal(rotuloEmFrase(''), '');
  assert.equal(rotuloEmFrase(null), '');
});

// Miniaturas sintéticas com a assinatura certa e tamanho de foto de verdade.
const comBytes = (cabeca, rabo, total) => {
  const b = Buffer.alloc(total, 0x41);
  Buffer.from(cabeca).copy(b, 0);
  if (rabo) Buffer.from(rabo).copy(b, total - rabo.length);
  return b;
};
const JPEG = comBytes([0xff, 0xd8, 0xff, 0xe0], [0xff, 0xd9], 2400);
const PNG = comBytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], null, 2400);
const WEBP = comBytes([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50], null, 2400);
const url = (tipo, buf) => 'data:image/' + tipo + ';base64,' + buf.toString('base64');

test('imagemReal: aceita JPEG/PNG/WEBP de verdade', () => {
  for (const [t, b] of [['jpeg', JPEG], ['png', PNG], ['webp', WEBP]]) assert.equal(imagemReal(url(t, b)), url(t, b));
});

test('imagemReal: só o prefixo, base64 com lixo, tipo trocado ou pequeno demais não passa', () => {
  assert.equal(imagemReal('data:image/jpeg;base64,'), null);
  assert.equal(imagemReal('data:image/jpeg;base64,TEST'), null);
  assert.equal(imagemReal('data:image/jpeg;base64,' + JPEG.toString('base64') + '!!'), null);
  assert.equal(imagemReal(url('png', JPEG)), null);                 // declara png, bytes de jpeg
  assert.equal(imagemReal(url('jpeg', PNG)), null);
  assert.equal(imagemReal(url('jpeg', comBytes([0xff, 0xd8, 0xff], null, 2400))), null);   // jpeg sem fim FF D9
  assert.equal(imagemReal(url('jpeg', comBytes([0xff, 0xd8, 0xff, 0xe0], [0xff, 0xd9], 200))), null);
  assert.equal(imagemReal(url('gif', JPEG)), null);
  assert.equal(imagemReal(url('jpeg', comBytes([0xff, 0xd8, 0xff, 0xe0], [0xff, 0xd9], 240000))), null);   // passa do teto
  assert.equal(imagemReal(12), null);
  assert.equal(assinaturaConfere(Buffer.from([0xff, 0xd8]), 'jpeg'), false);
});

test('comFotoReal: prova ok com foto falsa vira PROVA_FACIAL_AUSENTE; o resto passa igual', () => {
  const falsa = comFotoReal({ ok: true, score: 0.2, foto: 'data:image/jpeg;base64,TEST', liveness_ok: true });
  assert.equal(falsa.ok, false);
  assert.equal(falsa.status, 400);
  assert.equal(falsa.codigo, 'PROVA_FACIAL_AUSENTE');
  const boa = { ok: true, score: 0.2, foto: url('jpeg', JPEG), liveness_ok: true };
  assert.equal(comFotoReal(boa), boa);
  const negada = { ok: false, status: 403, codigo: 'ROSTO_NAO_CONFERE', mensagem: 'x' };
  assert.equal(comFotoReal(negada), negada);
});
