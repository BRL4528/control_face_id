// Guarda de paridade entre js/config.js e publico/js/config-face.js (T-A17B32,
// 2026-08-25). Achado real, duas vezes no mesmo dia: campo lido por cfg.X ou
// cfg().X num destes três módulos, ausente em config-face.js, vira `undefined`
// — e qualquer comparação com `undefined` é sempre `false`. O gate não quebra
// visível, ele passa a responder sempre a mesma coisa, calado
// (`maxInconsistenciaPose` recusava 100% das fotos; `roiInputSize` era inerte,
// mas só por não ser alcançado hoje — comentário sozinho não impede o próximo).
//
// Não importa js/face.js nem publico/js/config-face.js — nenhum dos dois é
// módulo importável em Node (o primeiro faz document.createElement no topo, o
// segundo é <script> global que referencia `window`; mesma razão de
// tests/unit/pose.test.js não importar js/face.js). Lê como texto, como
// pose.test.js já faz com js/config.js.
//
// O QUE ESTE TESTE NÃO COBRE: não descobre campo novo sozinho. Se um `cfg().x`
// ou `cfg.x` novo entrar em js/face.js, js/regras.js ou js/coerencia.js, é
// preciso adicionar a linha aqui na mesma mudança — a lista abaixo foi
// auditada a mão em 2026-08-25 via `grep -no` nos três arquivos, não é gerada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const CAMPOS_LIDOS = {
  'js/face.js': ['autoCapturaCiclos', 'inputSize', 'roiInputSize', 'maxBright', 'maxYaw', 'minBright', 'minFace', 'minSharp'],
  'js/regras.js': ['limiarAceite', 'limiarCinza', 'maxInconsistenciaPose']
  // js/coerencia.js recebe `limiar` por parâmetro (avaliarLoteFace) — não lê
  // cfg diretamente, nada a auditar aqui.
};

const raiz = path.join(import.meta.dirname, '..', '..');
const configFace = fs.readFileSync(path.join(raiz, 'publico', 'js', 'config-face.js'), 'utf8');
const comentarioTopo = configFace.slice(0, configFace.indexOf('window.EFRAT_CFG'));

/** Ou é chave viva no objeto (`campo:`), ou está citado no comentário de
 * omissões declaradas no topo do arquivo — as duas contam como "tratado". */
function tratado(campo) {
  const chaveViva = new RegExp('^\\s*' + campo + '\\s*:', 'm').test(configFace);
  const omissaoDeclarada = comentarioTopo.includes(campo);
  return chaveViva || omissaoDeclarada;
}

for (const [arquivo, campos] of Object.entries(CAMPOS_LIDOS)) {
  for (const campo of campos) {
    test(`config-face.js trata '${campo}' (lido por ${arquivo}) — presente ou omissão declarada`, () => {
      assert.ok(tratado(campo),
        `'${campo}' é lido de cfg por ${arquivo}, mas publico/js/config-face.js nem declara o campo ` +
        `nem cita ele no comentário de omissões no topo do arquivo. Campo ausente vira 'undefined', e ` +
        `toda comparação com 'undefined' é sempre false — o gate não falha, ele passa a responder ` +
        `sempre a mesma coisa, calado.`);
    });
  }
}
