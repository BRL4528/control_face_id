// Descritores sintéticos com distância euclidiana CONTROLADA, para testar a
// regra de coerência do lote de 3 fotos (docs/fase3-seguranca.md §4).
//
// Por que este arquivo existe em vez de reaproveitar `vetorDe` do
// servidor-falso: `vetorDe` é ótimo para "duas pessoas distintas na galeria",
// mas não é calibrado em distância. Medido:
//
//     distancia(vetorDe('p-ana'), vetorDe('p-bruno')) === 4.069
//
// 4,069 está uma ordem de grandeza acima de qualquer número real do domínio
// (as referências medidas em README.md:129 vão de 0,094 a 0,80). Um teste que
// recusa a 4,069 não prova nada sobre o limiar de 0,45 — prova que a regra
// recusa lixo. Aqui as distâncias são construídas, então o teste senta no
// limiar de verdade.
//
// CORREÇÃO DE UM ERRO MEU (QA, docs/fase3-seguranca.md §4.3): o documento pediu
// um lote "0,094 entre as duas primeiras e 0,61 e 0,80 contra a terceira".
// Esse triângulo não existe em espaço métrico nenhum — a desigualdade
// triangular obriga d(A2,B) a cair em [0,61-0,094 ; 0,61+0,094] = [0,516 ;
// 0,704], e 0,80 está fora. Os números de README.md:129 são pares medidos
// independentes ("pessoas diferentes: 0,61 e 0,80" são DOIS pares), não os três
// lados de um mesmo triângulo. Os lotes abaixo usam um par por vez, que é o que
// as medições de fato sustentam.

const DIMENSOES = 128;

/** Base arbitrária. Distância é invariante a translação, então o valor não importa. */
function base() {
  const v = new Array(DIMENSOES).fill(0);
  for (let i = 0; i < DIMENSOES; i++) v[i] = ((i * 7) % 100) / 250;
  return v;
}

/** `origem` deslocado de exatamente `distancia` ao longo do eixo `eixo`. */
export function afastar(origem, distancia, eixo) {
  const v = origem.slice();
  v[eixo] += distancia;
  return v;
}

export function distancia(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s);
}

/** Maior distância par a par — o número que a regra do servidor tem de olhar. */
export function maiorDistanciaParAPar(vetores) {
  let maior = 0;
  for (let i = 0; i < vetores.length; i++) {
    for (let j = i + 1; j < vetores.length; j++) {
      maior = Math.max(maior, distancia(vetores[i], vetores[j]));
    }
  }
  return maior;
}

/**
 * Três capturas da MESMA pessoa, em poses diferentes.
 * Pares: 0,094 · 0,094 · 0,133 (= 0,094·√2). Maior = 0,133, bem abaixo de 0,45.
 * Referência da pose: README.md:129 (mesma pessoa, pose diferente: 0,094).
 */
export function loteMesmaPessoa() {
  const a = base();
  return [a, afastar(a, 0.094, 0), afastar(a, 0.094, 1)];
}

/**
 * Duas capturas da mesma pessoa (0,094) + uma de OUTRA pessoa (0,61 da
 * primeira). Maior par ≈ 0,617. É o lote que não pode gerar template.
 * Referência: README.md:129 (pessoas diferentes: 0,61).
 */
export function loteDuasPessoas() {
  const a = base();
  return [a, afastar(a, 0.094, 0), afastar(a, 0.61, 1)];
}

/**
 * Variante com o segundo par medido de pessoas diferentes (0,80), para o caso
 * em que as duas primeiras capturas já são de pessoas distintas.
 */
export function loteDuasPessoasDistante() {
  const a = base();
  return [a, afastar(a, 0.80, 0), afastar(a, 0.094, 1)];
}

/** Lote cuja maior distância par a par é exatamente `alvo`. */
export function loteComMaiorDistancia(alvo) {
  const a = base();
  return [a, afastar(a, alvo, 0), afastar(a, Math.min(alvo, 0.01), 1)];
}

/**
 * Lote cuja maior distância par a par é EXATAMENTE `alvo`, para testar a
 * fronteira sem margem de erro.
 *
 * `loteComMaiorDistancia` não serve aqui: ela desloca em eixos ortogonais, então
 * o par mais distante vale √(alvo² + ε²), que fica ACIMA do alvo — medido,
 * `loteComMaiorDistancia(0.45)` dá 0,45011. Um teste de fronteira alimentado com
 * 0,45011 passa por estar acima do limiar, não por estar nele, e não prova nada.
 *
 * Aqui os três pontos são colineares: a, a+alvo, a+alvo/2. Os pares valem
 * `alvo`, `alvo/2` e `alvo/2`, então o maior é `alvo` exato.
 */
export function loteExatamenteNoLimiar(alvo) {
  const a = base();
  return [a, afastar(a, alvo, 0), afastar(a, alvo / 2, 0)];
}
