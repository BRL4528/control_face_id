import { workflow, node, trigger, ifElse, expr } from '@n8n/workflow-sdk';

const webhook = trigger({
  type: 'n8n-nodes-base.webhook', version: 2.1,
  config: { name: 'Webhook', parameters: { httpMethod: 'POST', path: 'efrat/carga-v3', responseMode: 'responseNode', options: { allowedOrigins: '*' } } },
});

const dispositivos = node({
  type: 'n8n-nodes-base.dataTable', version: 1.1,
  config: { name: 'Consultar Dispositivos', parameters: {
    resource: 'row', operation: 'get',
    dataTableId: { __rl: true, mode: 'list', value: 'gFJaT1uUyeVpHC74', cachedResultName: 'efrat_dispositivo' },
    matchType: 'allConditions',
    filters: { conditions: [{ keyName: 'dispositivo_id', condition: 'eq', keyValue: expr('{{ $("Webhook").first().json.body.dispositivo_id }}') }] },
    returnAll: true, options: {},
  }, executeOnce: true },
});

const autenticar = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: { name: 'Autenticar e Calcular Escopo', parameters: { mode: 'runOnceForAllItems', jsCode: "const req = $('Webhook').first().json;\nconst body = req.body || {};\nconst requestId = String(req.requestId || Date.now());\nconst auth = String((req.headers || {}).authorization || '');\nconst credencial = auth.startsWith('Bearer ') ? auth.slice(7) : '';\nconst falha = (status, codigo, mensagem) => [{ json: { autorizado: false, status_http: status,\n  resposta: { ok: false, erro: { codigo, mensagem }, request_id: requestId } } }];\nif (!body.dispositivo_id || !credencial) return falha(401, 'CREDENCIAL_INVALIDA', 'credencial invalida');\nconst digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(credencial));\nconst hash = Buffer.from(digest).toString('base64url');\nconst dispositivo = $input.all().map(i => i.json).find(d => d.dispositivo_id === body.dispositivo_id);\nif (!dispositivo || dispositivo.credencial_hash !== hash) return falha(401, 'CREDENCIAL_INVALIDA', 'credencial invalida');\nif (dispositivo.estado === 'pendente') return falha(403, 'DISPOSITIVO_PENDENTE', 'dispositivo aguarda aprovacao');\nif (dispositivo.estado !== 'ativo') return falha(403, 'DISPOSITIVO_INATIVO', 'dispositivo inativo');\nconst equipes = String(dispositivo.equipes_ids || '').split(',').map(s => s.trim()).filter(Boolean);\nif (!equipes.length) return falha(403, 'DISPOSITIVO_SEM_ESCOPO', 'dispositivo sem equipes');\nreturn [{ json: { autorizado: true, dispositivo_id: dispositivo.dispositivo_id,\n  equipes_ids: equipes, versao: Number(dispositivo.configuracao_versao || 0),\n  desde_versao: body.desde_versao == null ? null : Number(body.desde_versao), request_id: requestId } }];" } },
});

const autorizado = ifElse({
  version: 2.2,
  config: { name: 'Dispositivo Autorizado', parameters: { conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
    conditions: [{ id: 'autorizado', leftValue: expr('{{ $json.autorizado }}'), rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }],
    combinator: 'and',
  } } },
});

const pessoas = node({
  type: 'n8n-nodes-base.dataTable', version: 1.1,
  config: { name: 'Consultar Pessoas', parameters: {
    resource: 'row', operation: 'get',
    dataTableId: { __rl: true, mode: 'list', value: 'ZB53ZUrgAgv1u7Mg', cachedResultName: 'efrat_pessoa' },
    returnAll: true, options: {},
    executeOnce: true,
  } },
});

const templates = node({
  type: 'n8n-nodes-base.dataTable', version: 1.1,
  config: { name: 'Consultar Templates', parameters: {
    resource: 'row', operation: 'get',
    dataTableId: { __rl: true, mode: 'list', value: 'T33xTjG0vmcQlMem', cachedResultName: 'efrat_template' },
    returnAll: true, options: {},
    executeOnce: true,
  } },
});

const montar = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: { name: 'Montar Carga Escopada', parameters: { mode: 'runOnceForAllItems', jsCode: "const acesso = $('Autenticar e Calcular Escopo').first().json;\nconst pessoas = $('Consultar Pessoas').all().map(i => i.json).filter(p => p.ativo !== false && acesso.equipes_ids.includes(p.equipe_id));\nconst templates = $input.all().map(i => i.json).filter(t => t.status === 'ativo');\nconst semMudanca = acesso.desde_versao !== null && acesso.desde_versao === acesso.versao;\nconst saida = semMudanca ? [] : pessoas.map(p => {\n  const ts = templates.filter(t => t.pessoa_id === p.pessoa_id);\n  return {\n    pessoa_id: p.pessoa_id, nome: p.nome, equipe_id: p.equipe_id, papel: p.papel,\n    template: { versao: Math.max(0, ...ts.map(t => Number(t.versao || 0))),\n      vetores: ts.flatMap(t => {\n        try { return Array.isArray(t.vetores) ? t.vetores : JSON.parse(t.vetores || '[]'); }\n        catch (e) { return []; }\n      }) },\n    miniatura: ts.find(t => t.miniatura)?.miniatura || ''\n  };\n});\nreturn [{ json: { status_http: 200, resposta: { ok: true, versao: acesso.versao,\n  gerado_em: new Date().toISOString(), escopo: { equipes_ids: acesso.equipes_ids },\n  pessoas: saida, removidos_ids: [], request_id: acesso.request_id } } }];" } },
});

const responder = node({
  type: 'n8n-nodes-base.respondToWebhook', version: 1.5,
  config: { name: 'Responder', parameters: {
    respondWith: 'json', responseBody: expr('{{ $json.resposta }}'),
    options: {
      responseCode: expr('{{ $json.status_http }}'),
      responseHeaders: { entries: [
          { name: 'Access-Control-Allow-Origin', value: '*' },
          { name: 'Access-Control-Allow-Headers', value: 'content-type' },
        ] },
    },
  } },
});

export default workflow('efrat-carga-escopada-v3', 'Efrat v3 · Carga Escopada')
  .add(webhook).to(dispositivos).to(autenticar).to(autorizado)
  .onTrue(pessoas.to(templates).to(montar).to(responder))
  .onFalse(responder);
