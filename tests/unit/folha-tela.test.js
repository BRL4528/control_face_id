import { test } from 'node:test';
import assert from 'node:assert/strict';

// esc() de ui.js usa o DOM; aqui basta um escape equivalente.
globalThis.document = globalThis.document || {
  createElement: () => ({ _t: '', set textContent(v) { this._t = v; },
    get innerHTML() { return this._t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); } })
};
const { registroFacial, textoRegistroFacial, seloAssinatura, nomeEFuncao, htmlFolhas, htmlFichaEpi } = await import('../../js/folha.js');

test('registroFacial: só score numérico conta como reconhecimento', () => {
  assert.equal(registroFacial({ score: 0.31, liveness_ok: true }), 'rosto_e_vida');
  assert.equal(registroFacial({ score: 0.31, liveness_ok: false }), 'rosto_sem_vida');
  assert.equal(registroFacial({ score: null, liveness_ok: true }), 'sem_registro');
  assert.equal(registroFacial({ liveness_ok: false }), 'sem_registro');
  assert.equal(registroFacial(null), 'sem_registro');
  assert.equal(textoRegistroFacial({ score: 0.4, liveness_ok: false }), 'rosto, sem prova de vida');
  assert.equal(textoRegistroFacial({}), 'sem registro facial nem prova de vida');
});

test('selo da folha: reconhecimento facial só com score; sem prova de vida dito explicitamente', () => {
  const f = a => ({ assinatura: Object.assign({ em: '2026-10-31T14:00:00Z', hash: 'abc' }, a) });
  assert.match(seloAssinatura(f({ score: 0.3, liveness_ok: true }), 'X'), /com reconhecimento facial e prova de vida\./);
  assert.match(seloAssinatura(f({ score: 0.3, liveness_ok: false }), 'X'), /com reconhecimento facial, sem prova de vida\./);
  const sem = seloAssinatura(f({ score: null, liveness_ok: false }), 'X');
  assert.doesNotMatch(sem, /com reconhecimento facial/);
  assert.match(sem, /pela credencial do aparelho, sem verificação facial registrada e sem prova de vida\./);
});

test('nome e função em maiúsculas na folha e na ficha de EPI', () => {
  assert.equal(nomeEFuncao('João Arruda', 'Ajudante'), 'JOÃO ARRUDA (AJUDANTE)');
  assert.equal(nomeEFuncao('ana', ''), 'ANA');
  const folha = { nome: 'João Arruda', funcao: 'Ajudante', matricula: '7', mes: '2026-10', dias: [], rateio: [],
    totais: { dias_trabalhados: 0, trabalhado: 0, extra: 0, extra50: 0, extra100: 0, a_menos: 0, faltas: 0 } };
  const ctx = { empresa: { nome: 'Efrat' } };
  assert.match(htmlFolhas([folha], ctx), /JOÃO ARRUDA \(AJUDANTE\)/);
  const ficha = { nome: 'João Arruda', funcao: 'Líder de equipe', matricula: '7',
    linhas: [{ entregue_em: '2026-10-01', item: 'Bota', ca: '123', quantidade: 1, confirmada_em: '2026-10-01T12:00:00Z', prova: { score: 0.3, liveness_ok: false } },
             { entregue_em: '2026-10-02', item: 'Luva', ca: '', quantidade: 1, confirmada_em: '2026-10-02T12:00:00Z', prova: { liveness_ok: false } }] };
  const html = htmlFichaEpi([ficha], ctx);
  assert.match(html, /JOÃO ARRUDA \(LÍDER DE EQUIPE\)/);
  assert.match(html, /\(rosto, sem prova de vida\)/);
  assert.match(html, /\(sem registro facial nem prova de vida\)/);
});
