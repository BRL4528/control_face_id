// Prova de vida leve: pede para fechar e abrir os olhos e detecta pela razão de aspecto do
// olho (EAR — eye aspect ratio) nos landmarks que o motor já rastreia. Uma foto
// estática na tela nunca fecha os olhos, então reprova; um rosto vivo faz em segundos.
//
// Não é liveness certificado ISO 30107-3 (isso exige hardware/vídeo e vem
// depois). É a barreira barata que, somada à cerca e ao 1:1, torna a fraude por
// foto impraticável no dia a dia.
//
// EAR = (‖p2-p6‖ + ‖p3-p5‖) / (2·‖p1-p4‖) sobre os 6 pontos do olho do modelo
// de 68 landmarks (olho esquerdo 36-41, direito 42-47).
//
// O "fechado" é RELATIVO ao olho aberto da própria pessoa. O limiar fixo antigo
// (aberto 0.24, fechado 0.18) quase nunca era atingido: o EAR varia com a pessoa,
// o ângulo e a precisão dos landmarks, e o app só analisa 2 a 3 quadros por
// segundo, então uma piscada (0,1 a 0,4 s) caía entre dois quadros. Em out/2026,
// 944 de 947 batidas reprovaram. Agora o app pede "feche os olhos e abra" (dura
// vários quadros) e compara cada quadro com a linha de base de olho aberto.
const FECHOU = 0.75;    // olho fechado: abaixo de 75% da abertura normal da pessoa
const ABRIU = 0.9;      // reabriu: voltou a 90% da abertura normal
const MIN_BASE = 3;     // quadros de olho aberto para formar a linha de base

function mediana(xs) {
  const v = xs.filter(x => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function ear(p, ids) {
  const [p1, p2, p3, p4, p5, p6] = ids.map(i => p[i]);
  const v = dist(p2, p6) + dist(p3, p5);
  const h = 2 * dist(p1, p4) || 1;
  return v / h;
}

/** EAR médio dos dois olhos a partir dos landmarks do face-api. */
export function earDosOlhos(landmarks) {
  const p = landmarks.positions;
  const esq = ear(p, [36, 37, 38, 39, 40, 41]);
  const dir = ear(p, [42, 43, 44, 45, 46, 47]);
  return (esq + dir) / 2;
}

/**
 * Máquina de estado de "fechou e abriu os olhos". `base`: EARs dos quadros de
 * olho aberto logo antes da prova de vida (a fase de enquadrar o rosto); sem
 * eles, os primeiros quadros formam a linha de base. Alimente com o EAR de cada
 * quadro; quando ver aberto→fechado→aberto, `completo` fica true uma vez.
 * Foto parada não fecha os olhos, então nunca completa.
 */
export function criarDetectorPiscada(base) {
  const inicio = (base || []).filter(x => Number.isFinite(x) && x > 0).slice(-8);
  let ref = inicio.length >= MIN_BASE ? mediana(inicio) : null;
  const juntando = ref == null ? inicio.slice() : null;
  let fase = 'aguardando_fechar';   // aguardando_fechar → aguardando_abrir → completo
  let minimo = null, quadros = 0;
  return {
    completo: false,
    get base() { return ref; },
    /** Para diagnóstico quando reprova: linha de base, menor EAR visto e quadros analisados. */
    get diagnostico() { return { base: ref, minimo, quadros }; },
    alimentar(valorEar) {
      if (this.completo) return true;
      if (!Number.isFinite(valorEar) || valorEar <= 0) return false;
      quadros++;
      if (minimo == null || valorEar < minimo) minimo = valorEar;
      if (ref == null) {
        juntando.push(valorEar);
        if (juntando.length >= MIN_BASE) ref = mediana(juntando);
        return false;
      }
      if (fase === 'aguardando_fechar' && valorEar < ref * FECHOU) fase = 'aguardando_abrir';
      else if (fase === 'aguardando_abrir' && valorEar > ref * ABRIU) { fase = 'completo'; this.completo = true; }
      return this.completo;
    },
    reiniciar() { fase = 'aguardando_fechar'; this.completo = false; }
  };
}
