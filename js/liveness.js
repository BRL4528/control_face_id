// Prova de vida leve: pede para virar o rosto para um lado e voltar. Mede o giro
// (yaw) pelos landmarks que o motor já rastreia: a posição do nariz em relação ao
// meio dos olhos. Uma foto parada (mesmo inclinada na frente da câmera) não muda
// esse giro, porque nariz e olhos estão no mesmo plano; um rosto vivo muda.
//
// Não é liveness certificado ISO 30107-3 (isso exige hardware/vídeo). É a barreira
// barata que, somada à cerca e ao 1:1, torna a fraude por foto impraticável no dia a dia.
//
// Histórico: até 30/10/2026 o desafio era piscar / fechar os olhos (razão de
// aspecto do olho). O diagnóstico gravado em 125 batidas reais mostrou que o
// modelo de 68 pontos não acompanha a pálpebra: com o olho fechado a medida caía
// só ~6% (mediana mínimo/base 0,94 em ~24 quadros). Reprovava 100%. O giro da
// cabeça é estável nesse modelo (é o mesmo usado para pedir "olhe de frente").
// 04/11/2026: 0,18 → 0,12. Em 106 reprovações reais (01–04/11) o maior desvio
// mediano foi 0,038 e o p90 0,143: quase ninguém virava o bastante. Com a dica que
// muda quando a pessoa vira (fase), 0,12 ainda fica 3x acima do ruído de uma foto.
const GIROU = 0.12;     // virou: afastou-se pelo menos isto do giro de base (de frente)
const VOLTOU = 0.09;    // voltou: ficou a no máximo isto do giro de base
const MIN_BASE = 2;     // quadros de frente para formar a linha de base

function mediana(xs) {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * Máquina de estado de "virou o rosto e voltou". `base`: giros (yaw) dos quadros
 * de frente logo antes da prova de vida (a fase de enquadrar o rosto); sem eles,
 * os primeiros quadros formam a base. Alimente com o yaw de cada quadro; quando
 * ver frente → virado (para qualquer lado) → frente, `completo` fica true uma vez.
 */
export function criarDetectorGiro(base) {
  const inicio = (base || []).filter(Number.isFinite).slice(-8);
  let ref = inicio.length >= MIN_BASE ? mediana(inicio) : null;
  const juntando = ref == null ? inicio.slice() : null;
  let fase = 'aguardando_virar';   // aguardando_virar → aguardando_voltar → completo
  let maior = 0, quadros = 0;
  return {
    completo: false,
    get base() { return ref; },
    /** 'aguardando_virar' | 'aguardando_voltar' | 'completo': a tela troca a dica por fase. */
    get fase() { return fase; },
    /** Para diagnóstico quando reprova: giro de base, maior desvio e quadros analisados. */
    get diagnostico() { return { base: ref, maior_desvio: maior, quadros }; },
    alimentar(yaw) {
      if (this.completo) return true;
      if (!Number.isFinite(yaw)) return false;
      quadros++;
      if (ref == null) {
        juntando.push(yaw);
        if (juntando.length >= MIN_BASE) ref = mediana(juntando);
        return false;
      }
      const desvio = Math.abs(yaw - ref);
      if (desvio > maior) maior = desvio;
      if (fase === 'aguardando_virar' && desvio >= GIROU) fase = 'aguardando_voltar';
      else if (fase === 'aguardando_voltar' && desvio <= VOLTOU) { fase = 'completo'; this.completo = true; }
      return this.completo;
    },
    reiniciar() { fase = 'aguardando_virar'; this.completo = false; }
  };
}
