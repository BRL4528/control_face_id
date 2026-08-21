// Configuração de runtime. Não passa por build, então pode ser editada
// direto no servidor sem republicar o app.
//
// ATENÇÃO: apiBase está vinculado à política de CSP (connect-src em _headers e
// vercel.json). Se trocar o domínio de apiBase, é OBRIGATÓRIO atualizar a CSP
// nesses arquivos, caso contrário as chamadas de API serão bloqueadas.
//
// Nada aqui é segredo — num site estático tudo que entra no bundle é
// público. O v3 não tem mais token digitado (docs/adr-acesso-v3.md): o
// aparelho se autocadastra e a credencial de 256 bits fica só no IndexedDB
// daquele celular, nunca aqui.
// Object.assign preserva o que ja tiver sido definido antes deste arquivo — e
// assim que o ambiente de teste, ou um deploy especifico, troca a apiBase sem
// precisar editar nada.
//
// A ORDEM DOS ARGUMENTOS AQUI E LOAD-BEARING. O default de producao vai no
// primeiro argumento e o window.EFRAT_CFG existente no ultimo, de proposito:
// e assim que tests/e2e/servir.js sobrepoe a apiBase sem editar este arquivo.
// Trocar por objeto literal ou inverter a ordem faz todo `npm run serve`
// apontar para o n8n de PRODUCAO, sem erro nenhum na tela — a guarda de CI
// pega (T-F1E72A), mas só depois. Decisão e motivo em docs/fase3-contrato.md
// § Restrição de arquitetura, item 1.
window.EFRAT_CFG = Object.assign({
  apiBase: 'https://n8n.samasc.com.br/webhook', // se alterar o domínio, atualize connect-src em _headers e vercel.json

  // Distância euclidiana entre descritores de 128 dimensões.
  limiarAceite: 0.45,   // abaixo disso registra direto
  limiarCinza: 0.58,    // entre os dois registra e sinaliza ao RH

  // Qualidade mínima da captura.
  minFace: 0.25,        // largura do rosto / largura do quadro
  minSharp: 20,         // variância do laplaciano sobre o rosto em 160x160
  minBright: 55,
  maxBright: 215,
  maxYaw: 0.30,

  // Consistência de pose ENTRE as 3 fotos do lote de cadastro (T-5EC67B), não
  // pitch absoluto — pitch absoluto em 2D exigiria assumir uma razão
  // antropométrica, e isso produz viés demográfico (docs/validacao-biometrica.md:101).
  // Julgamento, não medição de população real, como o próprio limiarAceite:
  // ~15° de queixo baixo numa anatomia mediana. Recalibrar aqui, não no teste.
  maxInconsistenciaPose: 0.12,

  inputSize: 416,       // resolução do detector no quadro inteiro
  roiInputSize: 224,    // resolução do detector no recorte rastreado

  autoCapturaCiclos: 2, // ciclos consecutivos com qualidade OK antes de disparar
  falhasParaManual: 3,  // tentativas antes de oferecer registro manual
  cooldownMs: 60000,    // mesma pessoa não marca de novo dentro deste tempo
  geoTimeoutMs: 3000,   // fila não pode parar esperando GPS
  syncIntervalMs: 60000,
  loteMax: 50,

  // Painel do RH. Degraus de presença por equipe e limiar de alarme de
  // registro manual (o mesmo do monitor diário em n8n).
  limiarPresenca: { bom: 0.95, atencao: 0.85, serio: 0.70 },
  alarmeManual: 20,     // taxa de registro manual (%) que acende o alerta
  chartCdn: './vendor/chart.umd.min.js'
}, window.EFRAT_CFG || {});
