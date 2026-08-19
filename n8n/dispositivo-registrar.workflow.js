import { workflow, node, trigger, ifElse, expr } from '@n8n/workflow-sdk';

const webhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Webhook',
    parameters: { httpMethod: 'POST', path: 'efrat/dispositivo/registrar', responseMode: 'responseNode', options: {} },
  },
});

const consultarDispositivos = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Consultar Dispositivos',
    parameters: {
      resource: 'row', operation: 'get',
      dataTableId: { __rl: true, mode: 'name', value: 'efrat_dispositivo' },
      returnAll: true, options: {},
    },
  },
});

const decidir = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Validar e Decidir Cadastro',
    parameters: { mode: 'runOnceForAllItems', jsCode: "const req = $('Webhook').first().json;\nconst body = req.body || {};\nconst headers = req.headers || {};\nconst requestId = String(req.requestId || Date.now());\nconst resposta = (status, codigo, mensagem, extra) => ({\n  status_http: status,\n  resposta: Object.assign(status < 400 ? { ok: true } : { ok: false, erro: { codigo, mensagem } }, extra || {}, { request_id: requestId })\n});\nif (!body.dispositivo_id || !body.credencial_publica || !body.apelido || !body.ua) {\n  return [{ json: Object.assign({ acao: 'responder' }, resposta(400, 'CORPO_INVALIDO', 'campos obrigatorios ausentes')) }];\n}\nconst rows = $input.all().map(i => i.json).filter(r => r && r.dispositivo_id);\nconst existente = rows.find(r => r.dispositivo_id === body.dispositivo_id);\nif (existente) {\n  if (existente.credencial_hash !== body.credencial_publica) {\n    return [{ json: Object.assign({ acao: 'responder' }, resposta(409, 'DISPOSITIVO_CONFLITO', 'dispositivo ja cadastrado')) }];\n  }\n  return [{ json: {\n    acao: 'responder', status_http: 202,\n    resposta: { ok: true, estado: existente.estado, dispositivo_id: existente.dispositivo_id,\n      codigo_curto: existente.codigo_curto || undefined, consultar_apos_s: 10, request_id: requestId }\n  } }];\n}\nconst auth = String(headers.authorization || '');\nconst tokenLegado = auth.startsWith('Bearer ') ? auth.slice(7) : '';\nif (tokenLegado) {\n  const legado = rows.find(r => r.token === tokenLegado);\n  if (!legado) return [{ json: Object.assign({ acao: 'responder' }, resposta(401, 'TOKEN_LEGADO_INVALIDO', 'token legado invalido')) }];\n  if (legado.dispositivo_id) return [{ json: Object.assign({ acao: 'responder' }, resposta(409, 'TOKEN_LEGADO_CONSUMIDO', 'token legado ja migrado')) }];\n  return [{ json: {\n    acao: 'migrar', token: tokenLegado, dispositivo_id: body.dispositivo_id,\n    credencial_hash: body.credencial_publica, estado: 'ativo', codigo_curto: '',\n    apelido: body.apelido, ua: body.ua, geo: JSON.stringify(body.geo || null),\n    tentativas: 1, local_id: legado.local_id || '', configuracao_versao: Number(legado.configuracao_versao || 1),\n    aprovado_por: 'migracao-v3', aprovado_em: new Date().toISOString(),\n    status_http: 200, resposta: { ok: true, estado: 'ativo', migrado: true,\n      dispositivo_id: body.dispositivo_id, request_id: requestId }\n  } }];\n}\nconst usados = new Set(rows.filter(r => r.estado === 'pendente').map(r => r.codigo_curto));\nconst alfabeto = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';\nlet codigo = '';\nfor (let tentativa = 0; tentativa < 3 && !codigo; tentativa++) {\n  const bytes = new Uint8Array(6);\n  globalThis.crypto.getRandomValues(bytes);\n  const candidato = Array.from(bytes, b => alfabeto[b % alfabeto.length]).join('');\n  if (!usados.has(candidato)) codigo = candidato;\n}\nif (!codigo) return [{ json: Object.assign({ acao: 'responder' }, resposta(503, 'CODIGO_INDISPONIVEL', 'nao foi possivel gerar codigo')) }];\nreturn [{ json: {\n  acao: 'inserir', dispositivo_id: body.dispositivo_id, credencial_hash: body.credencial_publica,\n  estado: 'pendente', codigo_curto: codigo, apelido: body.apelido, ua: body.ua,\n  geo: JSON.stringify(body.geo || null), tentativas: 1, local_id: '', equipes_ids: '',\n  configuracao_versao: 0, aprovado_por: '', aprovado_em: '',\n  status_http: 202, resposta: { ok: true, estado: 'pendente', dispositivo_id: body.dispositivo_id,\n    codigo_curto: codigo, consultar_apos_s: 10, request_id: requestId }\n} }];" },
  },
});

const ehInsercao = ifElse({
  version: 2.2,
  config: {
    name: 'Inserir Novo',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ id: 'inserir', leftValue: expr('{{ $json.acao }}'), rightValue: 'inserir', operator: { type: 'string', operation: 'equals' } }],
        combinator: 'and',
      },
    },
  },
});

const ehMigracao = ifElse({
  version: 2.2,
  config: {
    name: 'Migrar Legado',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ id: 'migrar', leftValue: expr('{{ $json.acao }}'), rightValue: 'migrar', operator: { type: 'string', operation: 'equals' } }],
        combinator: 'and',
      },
    },
  },
});

const schemaDispositivo = [
  'dispositivo_id', 'credencial_hash', 'estado', 'codigo_curto', 'apelido', 'ua',
  'geo', 'tentativas', 'local_id', 'equipes_ids', 'configuracao_versao',
  'aprovado_por', 'aprovado_em',
].map((id) => ({
  id, displayName: id, required: false, defaultMatch: id === 'dispositivo_id',
  display: true, type: id === 'tentativas' || id === 'configuracao_versao' ? 'number' : 'string',
  canBeUsedToMatch: id === 'dispositivo_id',
}));

const valoresDispositivo = Object.fromEntries(schemaDispositivo.map(({ id }) => [id, expr('{{ $json.' + id + ' }}')]));

const inserir = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Inserir Dispositivo Pendente',
    parameters: {
      resource: 'row', operation: 'insert',
      dataTableId: { __rl: true, mode: 'name', value: 'efrat_dispositivo' },
      columns: { mappingMode: 'defineBelow', value: valoresDispositivo, schema: schemaDispositivo },
      options: {},
    },
  },
});

const migrar = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Vincular Dispositivo ao Token Legado',
    parameters: {
      resource: 'row', operation: 'update',
      dataTableId: { __rl: true, mode: 'name', value: 'efrat_dispositivo' },
      matchingColumns: ['token'],
      columns: {
        mappingMode: 'defineBelow',
        value: { ...valoresDispositivo, token: expr('{{ $json.token }}') },
        schema: [...schemaDispositivo, { id: 'token', displayName: 'token', required: false, defaultMatch: true, display: true, type: 'string', canBeUsedToMatch: true }],
      },
      options: {},
    },
  },
});

const prepararResposta = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Recuperar Resposta',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: "return [{ json: $('Validar e Decidir Cadastro').first().json }];",
    },
  },
});

const responder = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Responder',
    parameters: {
      respondWith: 'json',
      responseBody: expr('{{ $json.resposta }}'),
      options: {
        responseCode: expr('{{ $json.status_http }}'),
        responseHeaders: { entries: [{ name: 'Access-Control-Allow-Origin', value: '*' }] },
      },
    },
  },
});

export default workflow('efrat-dispositivo-registrar-v3', 'Efrat v3 · Dispositivo · Registrar')
  .add(webhook)
  .to(consultarDispositivos)
  .to(decidir)
  .to(ehInsercao)
  .onTrue(inserir.to(prepararResposta).to(responder))
  .onFalse(ehMigracao.onTrue(migrar.to(prepararResposta).to(responder)).onFalse(responder));
