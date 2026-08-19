import { workflow, node, trigger, expr } from '@n8n/workflow-sdk';

const webhook = trigger({
  type: 'n8n-nodes-base.webhook', version: 2.1,
  config: { name: 'Webhook', parameters: { httpMethod: 'POST', path: 'efrat/dispositivo/estado', responseMode: 'responseNode', options: { allowedOrigins: '*' } } },
});

const consultar = node({
  type: 'n8n-nodes-base.dataTable', version: 1.1,
  config: {
    name: 'Consultar Dispositivos',
    parameters: {
      resource: 'row', operation: 'get',
      dataTableId: { __rl: true, mode: 'list', value: 'gFJaT1uUyeVpHC74', cachedResultName: 'efrat_dispositivo' },
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'dispositivo_id', condition: 'eq', keyValue: expr('{{ $("Webhook").first().json.body.dispositivo_id }}') }] },
      returnAll: true, options: {},
    },
    executeOnce: true,
  },
});

const autenticar = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: { name: 'Autenticar e Montar Estado', parameters: { mode: 'runOnceForAllItems', jsCode: "const req = $('Webhook').first().json;\nconst body = req.body || {};\nconst requestId = String(req.requestId || Date.now());\nconst auth = String((req.headers || {}).authorization || '');\nconst credencial = auth.startsWith('Bearer ') ? auth.slice(7) : '';\nconst erro = (status, codigo, mensagem) => [{ json: { status_http: status, resposta: { ok: false, erro: { codigo, mensagem }, request_id: requestId } } }];\nif (!body.dispositivo_id || !credencial) return erro(401, 'CREDENCIAL_INVALIDA', 'credencial invalida');\nconst bytes = new TextEncoder().encode(credencial);\nconst digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);\nconst hash = Buffer.from(digest).toString('base64url');\nconst dispositivo = $input.all().map(i => i.json).find(d => d.dispositivo_id === body.dispositivo_id);\nif (!dispositivo) return erro(404, 'DISPOSITIVO_NAO_ENCONTRADO', 'dispositivo nao encontrado');\nif (dispositivo.credencial_hash !== hash) return erro(401, 'CREDENCIAL_INVALIDA', 'credencial invalida');\nif (dispositivo.estado === 'pendente') {\n  return [{ json: { status_http: 200, resposta: { ok: true, estado: 'pendente',\n    codigo_curto: dispositivo.codigo_curto, consultar_apos_s: 15, request_id: requestId } } }];\n}\nif (dispositivo.estado !== 'ativo') {\n  return [{ json: { status_http: 200, resposta: { ok: true, estado: dispositivo.estado, request_id: requestId } } }];\n}\nreturn [{ json: { status_http: 200, resposta: { ok: true, estado: 'ativo',\n  dispositivo: { dispositivo_id: dispositivo.dispositivo_id, apelido: dispositivo.descricao,\n    equipes_ids: String(dispositivo.equipes_ids || '').split(',').filter(Boolean),\n    configuracao_versao: Number(dispositivo.configuracao_versao || 0) },\n  request_id: requestId } } }];" } },
});

const responder = node({
  type: 'n8n-nodes-base.respondToWebhook', version: 1.5,
  config: {
    name: 'Responder',
    parameters: {
      respondWith: 'json', responseBody: expr('{{ $json.resposta }}'),
      options: {
        responseCode: expr('{{ $json.status_http }}'),
        responseHeaders: { entries: [
          { name: 'Access-Control-Allow-Origin', value: '*' },
          { name: 'Access-Control-Allow-Headers', value: 'content-type' },
        ] },
      },
    },
  },
});

export default workflow('efrat-dispositivo-estado-v3', 'Efrat v3 · Dispositivo · Estado')
  .add(webhook).to(consultar).to(autenticar).to(responder);
