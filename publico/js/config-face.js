// Configuração da origem pública — subconjunto mínimo (docs/fase3-contrato.md
// § 4.6, item d). NÃO carrega limiarCinza, limiarPresenca, alarmeManual,
// chartCdn, loteMax nem syncIntervalMs: a página pública não precisa nem deve
// conhecer a calibragem operacional do RH.
//
// A ORDEM DOS ARGUMENTOS AQUI É LOAD-BEARING, mesma razão de js/config.js: o
// default de produção vai primeiro e `window.EFRAT_CFG` existente por último,
// para o e2e sobrepor a apiBase sem editar este arquivo. Trocar a ordem faz
// a página apontar para o n8n de PRODUÇÃO sem erro nenhum na tela.
window.EFRAT_CFG = Object.assign({
  apiBase: 'https://n8n.samasc.com.br/webhook', // se alterar, atualize connect-src em publico/vercel.json
  empresa: 'Efrat', // nome mostrado na saudação — piloto de um cliente só, sem multi-tenant

  // Cópia de retorno rápido (§4.2): o servidor decide sempre, isto só evita
  // subir um lote que já vai ser recusado.
  limiarAceite: 0.45,

  // Qualidade mínima da captura — mesmos limiares do app, item d.
  minFace: 0.25,
  minSharp: 20,
  minBright: 55,
  maxBright: 215,
  maxYaw: 0.30,

  inputSize: 416,
  autoCapturaCiclos: 2
}, window.EFRAT_CFG || {});
