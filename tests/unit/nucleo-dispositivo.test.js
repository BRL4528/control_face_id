import { test } from 'node:test';
import assert from 'node:assert/strict';
import { obterCarga } from '../../nucleo/casos/dispositivo.js';

// Guarda de regressao pro achado da auditoria de T-D3DC5C (2026-08-25): o
// closure antigo de /efrat/carga (servidor-falso.js pre-extracao) fazia DUAS
// escritas quando o app reportava modelo_id -- registrarModeloObservado(id,
// 'app') e SO DEPOIS estado.referenciaModeloApp = id. O metodo do repositorio
// com o mesmo nome (nucleo/memoria.js) so faz a segunda, de proposito -- um
// metodo faz uma coisa so. Sem este teste, obterCarga podia voltar a chamar
// so definirReferenciaModeloApp e ninguem notaria: nenhum e2e le
// estado.modelosObservados, entao a regressao seria silenciosa por meses.

function ctxComRepoEspiao(pessoas) {
  const chamadas = [];
  const repo = {
    async registrarModeloObservado(modeloId, origem, agoraIso) {
      chamadas.push({ metodo: 'registrarModeloObservado', modeloId, origem, agoraIso });
    },
    async definirReferenciaModeloApp(modeloId) {
      chamadas.push({ metodo: 'definirReferenciaModeloApp', modeloId });
    },
    async listarPessoas() { return pessoas; }
  };
  const ctx = { repo, cripto: { uuid: () => 'req-1' }, cfg: {} };
  return { ctx, chamadas };
}

const DISPOSITIVO_ATIVO = {
  dispositivo_id: 'd1', estado: 'ativo', equipes_ids: ['eq-1'], configuracao_versao: 3
};

test('obterCarga com modelo_id: registra a observacao ANTES de mover a referencia', async () => {
  const { ctx, chamadas } = ctxComRepoEspiao([]);
  const req = {
    dispositivo: DISPOSITIVO_ATIVO, corpo: { modelo_id: 'modelo-xyz' },
    agoraIso: '2026-08-25T10:00:00.000Z'
  };

  const resposta = await obterCarga(ctx, req);

  assert.equal(resposta.status, 200);
  assert.deepEqual(chamadas, [
    { metodo: 'registrarModeloObservado', modeloId: 'modelo-xyz', origem: 'app', agoraIso: req.agoraIso },
    { metodo: 'definirReferenciaModeloApp', modeloId: 'modelo-xyz' }
  ]);
});

test('obterCarga sem modelo_id: nenhuma das duas escritas acontece', async () => {
  const { ctx, chamadas } = ctxComRepoEspiao([]);
  const req = { dispositivo: DISPOSITIVO_ATIVO, corpo: {}, agoraIso: '2026-08-25T10:00:00.000Z' };

  const resposta = await obterCarga(ctx, req);

  assert.equal(resposta.status, 200);
  assert.deepEqual(chamadas, []);
});

test('obterCarga filtra pessoas por equipe do aparelho e por ativo', async () => {
  const pessoas = [
    { pessoa_id: 'p1', nome: 'Ana', equipe_id: 'eq-1', papel: 'colaborador', ativo: true, versao: 1, vetores: [], miniatura: '' },
    { pessoa_id: 'p2', nome: 'Bruno', equipe_id: 'eq-2', papel: 'colaborador', ativo: true, versao: 1, vetores: [], miniatura: '' },
    { pessoa_id: 'p3', nome: 'Carla', equipe_id: 'eq-1', papel: 'colaborador', ativo: false, versao: 1, vetores: [], miniatura: '' }
  ];
  const { ctx } = ctxComRepoEspiao(pessoas);
  const req = { dispositivo: DISPOSITIVO_ATIVO, corpo: {}, agoraIso: '2026-08-25T10:00:00.000Z' };

  const resposta = await obterCarga(ctx, req);

  assert.equal(resposta.corpo.pessoas.length, 1);
  assert.equal(resposta.corpo.pessoas[0].pessoa_id, 'p1');
});

test('obterCarga: aparelho pendente/inativo/sem escopo nao chega a ler pessoas', async () => {
  const { ctx } = ctxComRepoEspiao([]);
  const base = { corpo: {}, agoraIso: '2026-08-25T10:00:00.000Z' };

  const pendente = await obterCarga(ctx, Object.assign({}, base, { dispositivo: Object.assign({}, DISPOSITIVO_ATIVO, { estado: 'pendente' }) }));
  assert.equal(pendente.status, 403);
  assert.equal(pendente.corpo.erro.codigo, 'DISPOSITIVO_PENDENTE');

  const revogado = await obterCarga(ctx, Object.assign({}, base, { dispositivo: Object.assign({}, DISPOSITIVO_ATIVO, { estado: 'revogado' }) }));
  assert.equal(revogado.status, 403);
  assert.equal(revogado.corpo.erro.codigo, 'DISPOSITIVO_INATIVO');

  const semEscopo = await obterCarga(ctx, Object.assign({}, base, { dispositivo: Object.assign({}, DISPOSITIVO_ATIVO, { equipes_ids: [] }) }));
  assert.equal(semEscopo.status, 403);
  assert.equal(semEscopo.corpo.erro.codigo, 'DISPOSITIVO_SEM_ESCOPO');
});
