// Motor de reconhecimento. Isola tudo que depende do face-api e da câmera,
// para que a orquestração da tela não precise saber nada disso.
import { euclidiana, yaw } from './regras.js';
import { calcularModeloId } from './modelo.js';

const cfg = () => window.EFRAT_CFG;

const NORM = 160;
const quadro = document.createElement('canvas');
const qctx = quadro.getContext('2d', { willReadFrequently: true });
const recorte = document.createElement('canvas');
const amostra = document.createElement('canvas');
amostra.width = amostra.height = NORM;
const actx = amostra.getContext('2d', { willReadFrequently: true });

/**
 * Nitidez e brilho medidos sobre o rosto REAMOSTRADO para 160x160.
 * Sem normalizar, o mesmo limiar se comporta diferente em cada câmera e o
 * número perde sentido entre aparelhos.
 * Referência medida: nítido ~48, mesma imagem com desfoque forte ~6.
 */
function metricas(canvas, box) {
  const x = Math.max(0, Math.round(box.x)), y = Math.max(0, Math.round(box.y));
  const w = Math.min(canvas.width - x, Math.round(box.width));
  const h = Math.min(canvas.height - y, Math.round(box.height));
  if (w < 10 || h < 10) return { sharp: 0, bright: 0 };
  actx.drawImage(canvas, x, y, w, h, 0, 0, NORM, NORM);
  const d = actx.getImageData(0, 0, NORM, NORM).data;
  const g = new Float32Array(NORM * NORM);
  let soma = 0;
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    g[j] = v; soma += v;
  }
  let ls = 0, ls2 = 0, n = 0;
  for (let yy = 1; yy < NORM - 1; yy++) {
    for (let xx = 1; xx < NORM - 1; xx++) {
      const i = yy * NORM + xx;
      const l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - NORM] - g[i + NORM];
      ls += l; ls2 += l * l; n++;
    }
  }
  const media = ls / n;
  return { sharp: ls2 / n - media * media, bright: soma / (NORM * NORM) };
}


export const DICA_ADORNO = 'Nenhum rosto — tire óculos escuros, máscara ou touca';

function avaliar(det, canvas, boxCheia) {
  const c = cfg();
  if (!det) return { ok: false, rosto: false, msg: 'Nenhum rosto detectado' };
  const box = boxCheia || det.detection.box;
  const rel = box.width / canvas.width;
  const m = metricas(canvas, box);
  const g = Math.abs(yaw(det.landmarks));
  const q = {
    rosto: true, rel, sharp: m.sharp, bright: m.bright, yaw: g, box,
    okTam: rel >= c.minFace,
    okNitidez: m.sharp >= c.minSharp,
    okLuz: m.bright >= c.minBright && m.bright <= c.maxBright,
    okPose: g <= c.maxYaw
  };
  q.ok = q.okTam && q.okNitidez && q.okLuz && q.okPose;
  q.msg = !q.okTam ? 'Aproxime o rosto'
    : !q.okLuz ? (m.bright < c.minBright ? 'Muito escuro' : 'Muito claro / contraluz')
    : !q.okNitidez ? 'Imagem tremida'
    : !q.okPose ? 'Olhe de frente'
    : 'Pronto';
  return q;
}

function miniatura(canvas, box, lado) {
  const t = document.createElement('canvas');
  t.width = t.height = lado || 128;
  const folga = box.width * 0.28;
  t.getContext('2d').drawImage(canvas,
    Math.max(0, box.x - folga), Math.max(0, box.y - folga),
    box.width + folga * 2, box.height + folga * 2, 0, 0, t.width, t.height);
  return t.toDataURL('image/jpeg', 0.72);
}

// Modo de teste: substitui a inferência por descritores determinísticos, para
// que o fluxo (fila, envio, offline) possa ser testado sem rosto de verdade.
function fingido() { return window.__EFRAT_FAKE_FACE || null; }

export const Face = {
  pronto: false,
  backend: null,
  _ctl: null,
  _bom: { canvas: null, em: 0 },
  _rastro: { box: null, perdas: 0 },
  _seguidos: 0,
  latencia: 0,
  modo: 'full',
  modeloId: null,

  async carregar(base) {
    // Fingido não busca peso nenhum — nada pra hashear, e hashear de verdade
    // aqui só custaria 7MB por teste sem testar nada real (docs/fase3-contrato.md
    // §4.7: modelo_id no navegador, não em build).
    if (fingido()) { this.pronto = true; this.backend = 'fake'; this.modeloId = 'fingido'; return; }
    const t0 = performance.now();
    try { await faceapi.tf.setBackend('webgl'); await faceapi.tf.ready(); }
    catch (e) { await faceapi.tf.setBackend('cpu'); await faceapi.tf.ready(); }
    const raiz = base || './models';
    await faceapi.nets.tinyFaceDetector.loadFromUri(raiz);
    await faceapi.nets.faceLandmark68Net.loadFromUri(raiz);
    await faceapi.nets.faceRecognitionNet.loadFromUri(raiz);
    this.pronto = true;
    this.backend = faceapi.tf.getBackend();
    this.msCarga = Math.round(performance.now() - t0);
    // Uma vez por carga de página, não por cadastro (§4.7): computado agora,
    // logo após o motor carregar, para bater no mesmo cache que ele populou.
    // null se algum dos 7 arquivos falhar — quem cadastra decide o que fazer
    // com a ausência, esta função nunca fabrica id parcial.
    this.modeloId = await calcularModeloId(raiz);
  },

  _opts(tam) {
    return new faceapi.TinyFaceDetectorOptions({ inputSize: tam, scoreThreshold: 0.4 });
  },

  _capturarQuadro(video) {
    quadro.width = video.videoWidth;
    quadro.height = video.videoHeight;
    qctx.drawImage(video, 0, 0);
    return quadro;
  },

  /**
   * Loop auto-agendado, nunca setInterval: em aparelho lento a inferência
   * demora mais que o intervalo e as chamadas se empilham até travar.
   *
   * O detector completo só roda quando não há rosto rastreado — mesmo padrão
   * do MediaPipe Face Mesh. Medido: 1188ms -> 488ms por ciclo.
   */
  iniciar(video, overlay, cb) {
    this.parar();
    const ctl = { parar: false };
    this._ctl = ctl;
    this._seguidos = 0;
    this._rastro = { box: null, perdas: 0 };

    const passo = async () => {
      if (!this.pronto || !video.videoWidth) return;
      const f = fingido();
      if (f) {
        const q = { ok: f.qualidadeOk !== false, rosto: true, rel: 0.5, sharp: 300, bright: 120, yaw: 0.05, msg: f.qualidadeOk === false ? 'Muito escuro' : 'Pronto', box: { x: 10, y: 10, width: 100, height: 100 } };
        cb.onQualidade && cb.onQualidade(q);
        if (q.ok && cb.autoCaptura && cb.autoCaptura()) {
          this._seguidos++;
          if (this._seguidos >= cfg().autoCapturaCiclos) {
            this._seguidos = 0;
            cb.onCaptura && cb.onCaptura(this._capturaFingida());
          }
        } else { this._seguidos = 0; }
        return;
      }

      const cv = this._capturarQuadro(video);
      const tr = this._rastro;
      let det = null, boxCheia = null;

      if (tr.box) {
        const b = tr.box, folga = b.width * 0.45;
        const rx = Math.max(0, b.x - folga), ry = Math.max(0, b.y - folga);
        const rw = Math.min(cv.width - rx, b.width + folga * 2);
        const rh = Math.min(cv.height - ry, b.height + folga * 2);
        if (rw > 20 && rh > 20) {
          const alvo = cfg().roiInputSize + 64;
          recorte.width = alvo;
          recorte.height = Math.round(alvo * rh / rw);
          recorte.getContext('2d').drawImage(cv, rx, ry, rw, rh, 0, 0, recorte.width, recorte.height);
          try {
            det = await faceapi.detectSingleFace(recorte, this._opts(cfg().roiInputSize)).withFaceLandmarks();
          } catch (e) { det = null; }
          if (det) {
            const k = rw / recorte.width, d = det.detection.box;
            boxCheia = { x: rx + d.x * k, y: ry + d.y * k, width: d.width * k, height: d.height * k };
            tr.box = boxCheia; tr.perdas = 0; this.modo = 'track';
          } else if (++tr.perdas >= 2) { tr.box = null; }
        } else { tr.box = null; }
      }

      if (!det && !tr.box) {
        try { det = await faceapi.detectSingleFace(cv, this._opts(cfg().inputSize)).withFaceLandmarks(); }
        catch (e) { return; }
        this.modo = 'full';
        if (det) { boxCheia = det.detection.box; tr.box = boxCheia; tr.perdas = 0; }
      }
      if (ctl.parar) return;

      const q = avaliar(det, cv, boxCheia);

      // Guarda o último quadro APROVADO. Sem isso, a captura acontece num
      // quadro diferente do que o usuário viu aprovado e reprova por engano.
      if (q.ok) {
        if (!this._bom.canvas) this._bom.canvas = document.createElement('canvas');
        const g = this._bom.canvas;
        if (g.width !== cv.width || g.height !== cv.height) { g.width = cv.width; g.height = cv.height; }
        g.getContext('2d').drawImage(cv, 0, 0);
        this._bom.em = performance.now();
      }

      if (overlay) {
        overlay.width = cv.width; overlay.height = cv.height;
        const c = overlay.getContext('2d');
        c.clearRect(0, 0, overlay.width, overlay.height);
        if (boxCheia) {
          c.strokeStyle = q.ok ? '#28a745' : '#e0a800';
          c.lineWidth = Math.max(3, overlay.width / 160);
          c.strokeRect(boxCheia.x, boxCheia.y, boxCheia.width, boxCheia.height);
        }
      }

      cb.onQualidade && cb.onQualidade(q);

      if (q.ok && cb.autoCaptura && cb.autoCaptura()) {
        this._seguidos++;
        if (this._seguidos >= cfg().autoCapturaCiclos) {
          this._seguidos = 0;
          const r = await this.capturar(video);
          if (r && cb.onCaptura) cb.onCaptura(r);
        }
      } else {
        this._seguidos = 0;
      }
    };

    (async () => {
      while (!ctl.parar) {
        const t0 = performance.now();
        try { await passo(); } catch (e) { /* um ciclo ruim não derruba o loop */ }
        const gasto = performance.now() - t0;
        this.latencia = Math.round(gasto);
        await new Promise(r => setTimeout(r, Math.max(100, 320 - gasto)));
      }
    })();
  },

  parar() {
    if (this._ctl) this._ctl.parar = true;
    this._ctl = null;
    this._bom = { canvas: null, em: 0 };
    this._rastro = { box: null, perdas: 0 };
  },

  /**
   * `f.descritor`, quando presente, vence o cálculo por semente — hook só
   * para teste controlar a distância exata entre capturas (ex.: simular 3
   * poses coerentes de cadastro, que a semente por pessoa não consegue: o
   * mesmo `pessoa` sempre dá distância 0 entre capturas, e pessoas diferentes
   * dão ~4 — nem "mesmo arquivo" nem "pose diferente" de verdade, os dois
   * extremos que a regra de coerência do T-8ADD9C tem que distinguir do meio).
   * Sem `f.descritor`, comportamento idêntico ao de sempre — nenhum teste
   * existente é afetado.
   */
  _capturaFingida() {
    const f = fingido();
    let base = f.descritor;
    if (!base) {
      base = new Array(128).fill(0);
      const semente = String(f.pessoa || 'x');
      for (let i = 0; i < 128; i++) base[i] = ((semente.charCodeAt(i % semente.length) * (i + 7)) % 100) / 100;
    }
    return { descritor: base, thumb: 'data:image/jpeg;base64,TEST', qualidade: { ok: true, sharp: 300, bright: 120 } };
  },

  /**
   * Upload de 3 fotos (T-D30529): a foto já existe, não tem retry de câmera —
   * uma tentativa, motivo específico na recusa (texto aprovado com o
   * Designer, aplicado por quem chama esta função, não aqui).
   *
   * `detectAllFaces`, não `detectSingleFace`: precisa DISTINGUIR zero rostos
   * de mais de um, porque o texto de recusa é diferente pros dois casos.
   *
   * HEIC é recusado antes de tentar decodificar — `createImageBitmap` falha
   * pra HEIC do mesmo jeito que falha pra arquivo corrompido, e são erros
   * que pedem ações diferentes da pessoa.
   */
  async capturarDeArquivo(file) {
    const nome = String((file && file.name) || '').toLowerCase();
    if (/\.(heic|heif)$/.test(nome)) return { ok: false, motivo: 'formato_heic' };
    if (fingido()) return this._capturaFingidaDeArquivo(file, nome);

    let bitmap;
    try { bitmap = await createImageBitmap(file); }
    catch (e) { return { ok: false, motivo: 'formato' }; }

    // Reduz a maior aresta pra 1280px antes da inferência (docs/fase3-contrato.md
    // §4.3, caminho 3): foto de 12MP não deixa o descritor melhor e trava a
    // máquina do RH.
    const escala = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    const cv = document.createElement('canvas');
    cv.width = Math.round(bitmap.width * escala);
    cv.height = Math.round(bitmap.height * escala);
    cv.getContext('2d').drawImage(bitmap, 0, 0, cv.width, cv.height);
    if (bitmap.close) bitmap.close();

    let dets;
    try {
      dets = await faceapi.detectAllFaces(cv, this._opts(cfg().inputSize))
        .withFaceLandmarks().withFaceDescriptor();
    } catch (e) { return { ok: false, motivo: 'tecnico' }; }

    if (!dets || dets.length === 0) return { ok: false, motivo: 'sem_rosto' };
    if (dets.length > 1) return { ok: false, motivo: 'multiplos_rostos' };

    const det = dets[0];
    const q = avaliar(det, cv, det.detection.box);
    if (!q.ok) return { ok: false, motivo: 'qualidade', qualidade: q };
    return {
      ok: true, descritor: Array.from(det.descriptor),
      thumb: miniatura(cv, det.detection.box, 128), qualidade: q
    };
  },

  /**
   * Convenção de nome pro modo fingido, pra e2e simular os erros do upload
   * sem foto de verdade: `sem-rosto*`, `dois-rostos*`, `qualidade-ruim*`
   * disparam a recusa correspondente; qualquer outro nome vira o "pessoa"
   * que gera o descritor (mesma técnica de `_capturaFingida`).
   *
   * `f.descritoresPorArquivo[file.name]`, quando presente, vence — mesmo
   * motivo do `f.descritor` de `_capturaFingida`: simular 3 fotos coerentes
   * (ou incoerentes de propósito) exige controlar a distância exata, e nome
   * de arquivo vira semente da mesma forma bimodal (idêntico ou ~4, nunca o
   * meio).
   */
  _capturaFingidaDeArquivo(file, nomeMinusculo) {
    if (nomeMinusculo.includes('sem-rosto')) return { ok: false, motivo: 'sem_rosto' };
    if (nomeMinusculo.includes('dois-rostos')) return { ok: false, motivo: 'multiplos_rostos' };
    if (nomeMinusculo.includes('qualidade-ruim')) return { ok: false, motivo: 'qualidade' };
    const f = fingido();
    const mapa = f && f.descritoresPorArquivo;
    if (mapa && mapa[file.name]) {
      return { ok: true, descritor: mapa[file.name], thumb: 'data:image/jpeg;base64,TEST', qualidade: { ok: true, sharp: 300, bright: 120 } };
    }
    const pessoa = nomeMinusculo.replace(/\.[a-z0-9]+$/, '') || 'x';
    const base = new Array(128).fill(0);
    for (let i = 0; i < 128; i++) base[i] = ((pessoa.charCodeAt(i % pessoa.length) * (i + 7)) % 100) / 100;
    return { ok: true, descritor: base, thumb: 'data:image/jpeg;base64,TEST', qualidade: { ok: true, sharp: 300, bright: 120 } };
  },

  /** Usa o último quadro aprovado se for recente; tenta algumas vezes antes de desistir. */
  async capturar(video, tentativas) {
    if (fingido()) return this._capturaFingida();
    const max = tentativas || 3;
    for (let i = 0; i < max; i++) {
      const usarBom = this._bom.canvas && (performance.now() - this._bom.em) < 1200;
      const cv = usarBom ? this._bom.canvas : this._capturarQuadro(video);
      let det = null;
      try {
        det = await faceapi.detectSingleFace(cv, this._opts(cfg().inputSize))
          .withFaceLandmarks().withFaceDescriptor();
      } catch (e) { det = null; }
      if (det) {
        const q = avaliar(det, cv, det.detection.box);
        if (q.ok || i === max - 1) {
          return {
            descritor: Array.from(det.descriptor),
            thumb: miniatura(cv, det.detection.box, 128),
            qualidade: q,
            reprovado: !q.ok
          };
        }
      } else if (i === max - 1) {
        return null;
      }
      await new Promise(r => setTimeout(r, 250));
    }
    return null;
  },

  /**
   * Uma captura manual de vídeo com resultado tipado (T-D30529: página
   * pública, "tirar uma foto de cada vez"). Diferente de `capturar()`:
   * usa `detectAllFaces` pra DISTINGUIR zero rostos de mais de um — a página
   * pública precisa dos dois textos, "não encontrei" e "mais de uma pessoa",
   * que `capturar()` (single-face) não separa.
   */
  async capturarUnico(video, tentativas) {
    if (fingido()) {
      const nome = String(fingido().pessoa || '');
      if (nome === 'sem-rosto') return { ok: false, motivo: 'sem_rosto' };
      if (nome === 'dois-rostos') return { ok: false, motivo: 'multiplos_rostos' };
      if (nome === 'qualidade-ruim') return { ok: false, motivo: 'qualidade', qualidade: { ok: false, msg: 'ruim' } };
      return Object.assign({ ok: true }, this._capturaFingida());
    }
    const max = tentativas || 3;
    for (let i = 0; i < max; i++) {
      const usarBom = this._bom.canvas && (performance.now() - this._bom.em) < 1200;
      const cv = usarBom ? this._bom.canvas : this._capturarQuadro(video);
      let dets;
      try {
        dets = await faceapi.detectAllFaces(cv, this._opts(cfg().inputSize)).withFaceLandmarks().withFaceDescriptor();
      } catch (e) { dets = null; }
      if (dets && dets.length > 1) return { ok: false, motivo: 'multiplos_rostos' };
      if (dets && dets.length === 1) {
        const det = dets[0];
        const q = avaliar(det, cv, det.detection.box);
        if (q.ok) return { ok: true, descritor: Array.from(det.descriptor), thumb: miniatura(cv, det.detection.box, 128), qualidade: q };
        if (i === max - 1) return { ok: false, motivo: 'qualidade', qualidade: q };
      } else if (i === max - 1) {
        return { ok: false, motivo: 'sem_rosto' };
      }
      await new Promise(r => setTimeout(r, 250));
    }
    return { ok: false, motivo: 'sem_rosto' };
  },

  distancia: euclidiana
};
