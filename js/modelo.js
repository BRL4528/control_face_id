// Identidade do modelo de reconhecimento que gerou um vetor
// (docs/fase3-contrato.md § 4.7). `modelo_id` = SHA-256 sobre os bytes dos 7
// arquivos do pipeline (3 pesos, os 3 manifestos do PRÓPRIO face-api que
// acompanham cada peso, e o motor `vendor/face-api.js`), concatenados em
// ordem fixa. Calculado NO NAVEGADOR, na carga da página — nunca em build:
// um manifesto gerado no build não descreve os bytes que o navegador de fato
// recebeu (cache do service worker, `Cache-Control: immutable` sem hash na
// URL, cópia de build da origem pública desatualizada, borda de CDN).
//
// Nível de garantia: PRÁTICO, não "por construção". `js/face.js:109-111` usa
// `loadFromUri()` — o próprio face-api busca os arquivos, então o
// `ArrayBuffer` não fica na mão de ninguém. A saída escolhida é um `fetch`
// próprio dos mesmos 7 arquivos, logo após a carga do motor, só para
// hashear — SEM `cache: 'no-store'`/`'reload'` (usa o padrão do navegador de
// propósito, pra bater no mesmo cache, SW ou HTTP, que o face-api acabou de
// popular; forçar rede nova pode hashear um deploy mais recente do que o que
// o motor carregou, o inverso do que se quer). A alternativa — trocar o
// loader para entregar os buffers ao face-api em vez de deixá-lo buscar —
// dá garantia sem nenhuma janela teórica, mas põe código nosso no caminho de
// carga do motor: se quebrar num bump de biblioteca, quebra o
// RECONHECIMENTO, não só o carimbo. Péssima troca para endurecer um sinal
// secundário e consultivo. A janela teórica da escolha (cache despejado
// entre os dois fetches, na mesma carga de página) tem modo de falha
// benigno: carimba uma versão real, servida um instante antes — nunca lixo.
//
// `modelo_id` é procedência DECLARADA pelo cliente, não prova — o servidor
// nunca recusa por causa dele (§4.7). Depende de tests/e2e/estaticos.test.js
// (guarda 6 / conteúdo do sw.js) para que "os bytes que o navegador tem em
// cache" e "os bytes do deploy atual" sejam a mesma coisa; sem essa guarda,
// o carimbo continuaria correto (ele mede o que está em cache), só que o
// cache poderia estar velho — problema diferente, que a guarda do
// Especialista DevOps cobre.
//
// Ordem fixa do digest — reproduzida por quem comparar as duas origens byte
// a byte (docs/fase3-contrato.md § 7, critério 16-B): NÃO reordenar.
const ARQUIVOS_MODELO = [
  'tiny_face_detector_model.bin',
  'face_landmark_68_model.bin',
  'face_recognition_model.bin',
  'tiny_face_detector_model-weights_manifest.json',
  'face_landmark_68_model-weights_manifest.json',
  'face_recognition_model-weights_manifest.json'
];

function concatenarBuffers(buffers) {
  const total = buffers.reduce((soma, b) => soma + b.byteLength, 0);
  const saida = new Uint8Array(total);
  let offset = 0;
  for (const b of buffers) { saida.set(new Uint8Array(b), offset); offset += b.byteLength; }
  return saida;
}

function paraHex(buffer) {
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @param {string} baseModelos  mesma raiz passada a `Face.carregar()` (padrão `./models`)
 * @param {string} caminhoMotor script do face-api nesta origem (padrão `./vendor/face-api.js`)
 * @returns {Promise<string|null>} hex do SHA-256, ou `null` se qualquer um dos 7
 *   arquivos falhar ao buscar — nunca um id parcial ou inventado.
 */
export async function calcularModeloId(baseModelos, caminhoMotor) {
  const base = (baseModelos || './models').replace(/\/+$/, '');
  const motor = caminhoMotor || './vendor/face-api.js';
  const urls = ARQUIVOS_MODELO.map(a => base + '/' + a).concat([motor]);
  try {
    const respostas = await Promise.all(urls.map(u => fetch(u)));
    if (respostas.some(r => !r.ok)) return null;
    const buffers = await Promise.all(respostas.map(r => r.arrayBuffer()));
    const digest = await crypto.subtle.digest('SHA-256', concatenarBuffers(buffers));
    return paraHex(digest);
  } catch (e) {
    return null;
  }
}
