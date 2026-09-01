// Prova de vida leve: pede uma piscada e a detecta pela razão de aspecto do
// olho (EAR — eye aspect ratio) nos landmarks que o motor já rastreia. Uma foto
// estática na tela nunca pisca, então reprova; um rosto vivo pisca em segundos.
//
// Não é liveness certificado ISO 30107-3 (isso exige hardware/vídeo e vem
// depois). É a barreira barata que, somada à cerca e ao 1:1, torna a fraude por
// foto impraticável no dia a dia.
//
// EAR = (‖p2-p6‖ + ‖p3-p5‖) / (2·‖p1-p4‖) sobre os 6 pontos do olho do modelo
// de 68 landmarks (olho esquerdo 36-41, direito 42-47). Aberto ~0.3, fechado
// <0.18. Detectamos a transição aberto→fechado→aberto.
const ABERTO = 0.24, FECHADO = 0.18;

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
 * Máquina de estado de uma piscada. Alimente com o EAR de cada quadro; quando
 * ver aberto→fechado→aberto, `completo` fica true uma vez.
 */
export function criarDetectorPiscada() {
  let fase = 'aguardando_fechar';   // aguardando_fechar → aguardando_abrir → completo
  return {
    completo: false,
    alimentar(valorEar) {
      if (this.completo) return true;
      if (fase === 'aguardando_fechar' && valorEar < FECHADO) fase = 'aguardando_abrir';
      else if (fase === 'aguardando_abrir' && valorEar > ABERTO) { fase = 'completo'; this.completo = true; }
      return this.completo;
    },
    reiniciar() { fase = 'aguardando_fechar'; this.completo = false; }
  };
}
