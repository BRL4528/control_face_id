// Configuração de runtime. Não passa por build, então pode ser editada
// direto no servidor sem republicar o app.
//
// Nada aqui é segredo. O token do aparelho NÃO mora neste arquivo: ele é
// digitado pelo gestor no primeiro acesso e fica só no IndexedDB daquele
// celular. Num site estático tudo que entra no bundle é público.
// Object.assign preserva o que ja tiver sido definido antes deste arquivo — e
// assim que o ambiente de teste, ou um deploy especifico, troca a apiBase sem
// precisar editar nada.
window.EFRAT_CFG = Object.assign({
  apiBase: 'https://n8n.samasc.com.br/webhook',

  // Distância euclidiana entre descritores de 128 dimensões.
  limiarAceite: 0.45,   // abaixo disso registra direto
  limiarCinza: 0.58,    // entre os dois registra e sinaliza ao RH

  // Qualidade mínima da captura.
  minFace: 0.25,        // largura do rosto / largura do quadro
  minSharp: 20,         // variância do laplaciano sobre o rosto em 160x160
  minBright: 55,
  maxBright: 215,
  maxYaw: 0.30,

  inputSize: 416,       // resolução do detector no quadro inteiro
  roiInputSize: 224,    // resolução do detector no recorte rastreado

  autoCapturaCiclos: 2, // ciclos consecutivos com qualidade OK antes de disparar
  falhasParaManual: 3,  // tentativas antes de oferecer registro manual
  cooldownMs: 60000,    // mesma pessoa não marca de novo dentro deste tempo
  geoTimeoutMs: 3000,   // fila não pode parar esperando GPS
  syncIntervalMs: 60000,
  loteMax: 50
}, window.EFRAT_CFG || {});
