// Coerência do lote de 3 fotos no cadastro de face. Função pura — sem DOM,
// sem rede, sem IndexedDB (mesmo padrão de js/regras.js) — porque é a ÚNICA
// fonte da regra "recusa quando a maior distância par a par >= limiar". Os
// três caminhos de cadastro (câmera do RH, upload, link público) têm de
// chamar esta mesma função: se algum deles guardar cópia própria, o bug de
// T-8ADD9C só muda de lugar (docs/fase3-contrato.md § 4.2).
//
// Limite conhecido, registrado aqui porque é aqui que ele importa: o
// embedding é gerado no navegador (docs/validacao-biometrica.md § 0.4). Esta
// função verifica coerência ENTRE os vetores recebidos — nunca que eles vieram
// das fotos que a pessoa de fato enviou. Fechar essa lacuna exige mover a
// extração do embedding para o servidor; fora do escopo desta regra.
import { euclidiana } from './regras.js';

export const DIMENSAO_DESCRITOR = 128;

// Piso aprovado pelo Arquiteto (T-65D806): abaixo disto as 3 capturas não têm
// nem a variação de pose de fotos genuínas da mesma pessoa — é o mesmo arquivo
// (ou quase) submetido 3 vezes. Checado contra a MAIOR distância par a par,
// não a menor: "mesmo arquivo 3x" é as três quase idênticas ENTRE SI, não só
// um par coincidir por acaso.
export const PISO_MESMO_ARQUIVO = 0.02;

function descritorValido(v) {
  return Array.isArray(v) && v.length === DIMENSAO_DESCRITOR
    && v.every(n => typeof n === 'number' && isFinite(n));
}

/**
 * @param {number[][]} vetores  exatamente 3 descritores, um por captura
 * @param {number} limiar       cfg.limiarAceite — fonte única, nunca duplicar
 *                               o número aqui dentro (docs/fase3-seguranca.md § 4.2c)
 *
 * Em exatamente `limiar` o cadastro RECUSA (`>=`), enquanto
 * `vereditoPorDistancia` (js/regras.js) ACEITA nesse mesmo ponto (`<=`) no
 * reconhecimento. A assimetria é intencional, não descuido: no reconhecimento
 * a fronteira decide um evento só, reversível, e cai na mesa do RH se estiver
 * errada; no cadastro o template grava uma vez e vale para sempre — um lote
 * que já nasce na fronteira produz erro em toda marcação futura daquela
 * pessoa, corretamente aceita, sem nada retido para revisar. Cadastro é mais
 * conservador de propósito.
 */
export function avaliarLoteFace(vetores, limiar) {
  // Códigos de erro fixados em docs/fase3-contrato.md § 4.2 / § 7 (tabela de
  // erros) — mesmos três códigos em /efrat/cadastro, /efrat/rh/face/cadastrar
  // e /efrat/rh/face/convite/enviar. Não renomear sem atualizar o contrato.
  if (!Array.isArray(vetores) || vetores.length !== 3) {
    return { ok: false, codigo: 'VETORES_INVALIDOS', mensagem: 'envie exatamente 3 capturas' };
  }
  if (!vetores.every(descritorValido)) {
    return {
      ok: false, codigo: 'VETORES_INVALIDOS',
      mensagem: 'cada captura precisa de ' + DIMENSAO_DESCRITOR + ' números finitos'
    };
  }
  // Maior distância, não média: a média de (0,094 · 0,094 · 0,61) esconde o
  // par ruim (docs/fase3-seguranca.md § 4.2a).
  const maiorDistancia = Math.max(
    euclidiana(vetores[0], vetores[1]),
    euclidiana(vetores[0], vetores[2]),
    euclidiana(vetores[1], vetores[2])
  );
  if (maiorDistancia < PISO_MESMO_ARQUIVO) {
    return {
      ok: false, codigo: 'FOTOS_IGUAIS', maiorDistancia,
      mensagem: 'as 3 capturas parecem o mesmo arquivo — envie 3 fotos de verdade, com leve variação de pose'
    };
  }
  if (maiorDistancia >= limiar) {
    return {
      ok: false, codigo: 'COERENCIA_INSUFICIENTE', maiorDistancia,
      mensagem: 'as 3 capturas não parecem ser da mesma pessoa'
    };
  }
  return { ok: true, maiorDistancia };
}
