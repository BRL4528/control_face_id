// Configuração da origem pública — subconjunto mínimo (docs/fase3-contrato.md
// § 4.6, item d). NÃO carrega limiarCinza, limiarPresenca, alarmeManual,
// chartCdn, loteMax nem syncIntervalMs: a página pública não precisa nem deve
// conhecer a calibragem operacional do RH.
//
// NÃO carrega roiInputSize: só é lido dentro de Face.iniciar() (js/face.js),
// no laço de rastreamento por ROI com overlay ao vivo — e só js/fila.js chama
// Face.iniciar() (js/app.js, tela de marcação). Esta página nunca chama
// Face.iniciar(), só Face.capturarUnico() (captura única por clique, sem
// overlay contínuo); se algum dia isto mudar, o campo entra aqui junto.
//
// REGRA DA CASA (achado do T-A17B32/config-face.js): todo campo que js/face.js,
// js/regras.js ou js/coerencia.js leem de `cfg` e que esta config NÃO carrega
// tem de estar nesta lista, com o motivo — nunca faltar em silêncio. Campo
// ausente vira `undefined`, e comparação com `undefined` é sempre `false`: o
// gate não falha, ele passa a responder sempre a mesma coisa, calado
// (foi o que aconteceu com maxInconsistenciaPose, abaixo).
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

  // Gate de consistência de pose ENTRE as 3 fotos do lote (T-5EC67B/T-A17B32),
  // mesmo valor e mesmo raciocínio de js/config.js — não duplicar o número
  // sem duplicar o comentário lá se recalibrar.
  maxInconsistenciaPose: 0.12,

  inputSize: 416,
  autoCapturaCiclos: 2
}, window.EFRAT_CFG || {});
