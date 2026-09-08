// Configuração de runtime. Não passa por build — editável direto no servidor.
//
// v4 (produto): backend próprio na mesma origem (/api/*), servido pela Vercel.
// Não há mais domínio externo de API; por isso a CSP usa connect-src 'self'.
// Nada aqui é segredo: num site estático tudo que entra no bundle é público. A
// credencial de 256 bits do celular e o token do RH vivem só no navegador.
window.EFRAT_CFG = Object.assign({
  apiBase: '/api',

  // Reconhecimento facial 1:1: a distância do rosto capturado ao template do
  // PRÓPRIO colaborador. Abaixo do limiar, confirma que é ele.
  limiarAceite: 0.45,   // referência medida: mesma pessoa ~0.09, outra ~0.6+
  limiarCinza: 0.58,    // entre os dois: registra e sinaliza ao RH

  // Qualidade mínima da captura.
  minFace: 0.25, minSharp: 20, minBright: 55, maxBright: 215, maxYaw: 0.30,
  inputSize: 416, roiInputSize: 224,
  autoCapturaCiclos: 2,

  // Liveness (prova de vida leve): pede uma piscada. Sem isso, foto na tela
  // passa. Combinado com cerca + 1:1, torna a fraude impraticável sem hardware.
  livenessAtivo: true,
  livenessTimeoutMs: 6000,

  cooldownMs: 60000,    // mesma pessoa não marca de novo dentro deste tempo
  geoTimeoutMs: 8000,   // ponto não trava esperando GPS, mas a cerca precisa dele
  syncIntervalMs: 60000,
  loteMax: 50
}, window.EFRAT_CFG || {});
