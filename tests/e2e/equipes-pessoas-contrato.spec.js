// Contrato de /efrat/rh/equipe, /efrat/rh/colaborador e as duas rotas de
// ativação — docs/fase3-contrato.md §2 e §3. Cartão: T-8188C6.
//
// Nível de contrato (chamada direta à rota via `request`), não de tela — a
// cobertura de tela fica em equipes-pessoas.spec.js. Aqui o que importa é a
// regra de negócio: telefone E.164 e duplicidade, campos imutáveis/derivados,
// concorrência otimista (versao_cadastro), e equipe com membros.
import { test, expect } from '@playwright/test';
import { criarServidor } from './servidor-falso.js';

const RH = { usuario: 'rh', chave: 'CHAVE-DE-TESTE' };
let ctx;

test.beforeEach(async () => {
  const { servidor, estado } = criarServidor({});
  await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve));
  ctx = { servidor, estado, base: `http://127.0.0.1:${servidor.address().port}/webhook` };
});
test.afterEach(async () => { await new Promise(resolve => ctx.servidor.close(resolve)); });

const colaborador = (request, corpo) => request.post(`${ctx.base}/efrat/rh/colaborador`, { data: { ...RH, ...corpo } });
const equipe = (request, corpo) => request.post(`${ctx.base}/efrat/rh/equipe`, { data: { ...RH, ...corpo } });
const dados = async request => (await request.post(`${ctx.base}/efrat/rh/dados`, { data: { ...RH, dias: 30 } })).json();
const inativar = (request, corpo) => request.post(`${ctx.base}/efrat/rh/colaborador/inativar`, { data: { ...RH, ...corpo } });
const reativar = (request, corpo) => request.post(`${ctx.base}/efrat/rh/colaborador/reativar`, { data: { ...RH, ...corpo } });

/* --------------------------------------------------------------- telefone */

test('colaborador/criar: telefone ausente devolve TELEFONE_OBRIGATORIO', async ({ request }) => {
  const r = await colaborador(request, { nome: 'Fulano', matricula: '900' });
  expect(r.status()).toBe(422);
  expect((await r.json()).erro.codigo).toBe('TELEFONE_OBRIGATORIO');
});

test('colaborador/criar: fixo de 10 digitos devolve TELEFONE_NAO_MOVEL', async ({ request }) => {
  const r = await colaborador(request, { nome: 'Fulano', matricula: '900', telefone: '6733224455' });
  expect(r.status()).toBe(422);
  expect((await r.json()).erro.codigo).toBe('TELEFONE_NAO_MOVEL');
});

test('colaborador/criar: celular valido normaliza para E.164 e aparece em /rh/dados', async ({ request }) => {
  const r = await colaborador(request, { nome: 'Fulano', matricula: '900', telefone: '(67) 99876-5432' });
  expect(r.status()).toBe(200);
  const corpo = await dados(request);
  const pessoa = corpo.pessoas.find(p => p.matricula === '900');
  expect(pessoa.telefone).toBe('+5567998765432');
});

test('colaborador/criar: telefone duplicado com pessoa ativa devolve 409 nomeando quem já usa', async ({ request }) => {
  await colaborador(request, { nome: 'Primeiro', matricula: '900', telefone: '67998765432' });
  const r = await colaborador(request, { nome: 'Segundo', matricula: '901', telefone: '67998765432' });
  expect(r.status()).toBe(409);
  const json = await r.json();
  expect(json.erro.codigo).toBe('TELEFONE_DUPLICADO');
  expect(json.nome).toBe('Primeiro');
});

test('colaborador/criar: telefone duplicado com autorizacao e motivo curto ainda recusa', async ({ request }) => {
  await colaborador(request, { nome: 'Primeiro', matricula: '900', telefone: '67998765432' });
  const r = await colaborador(request, {
    nome: 'Segundo', matricula: '901', telefone: '67998765432',
    autorizar_telefone_duplicado: true, motivo_telefone_duplicado: 'curto'
  });
  expect(r.status()).toBe(422);
});

test('colaborador/criar: telefone duplicado autorizado com motivo valido grava as duas e ambas ficam telefone_compartilhado', async ({ request }) => {
  await colaborador(request, { nome: 'Primeiro', matricula: '900', telefone: '67998765432' });
  const r = await colaborador(request, {
    nome: 'Segundo', matricula: '901', telefone: '67998765432',
    autorizar_telefone_duplicado: true, motivo_telefone_duplicado: 'pai e filho no mesmo canteiro'
  });
  expect(r.status()).toBe(200);
  const corpo = await dados(request);
  const primeiro = corpo.pessoas.find(p => p.matricula === '900');
  const segundo = corpo.pessoas.find(p => p.matricula === '901');
  expect(primeiro.telefone_compartilhado).toBe(true);
  expect(primeiro.telefone_compartilhado_com).toEqual([{ pessoa_id: segundo.pessoa_id, nome: 'Segundo' }]);
  expect(segundo.telefone_compartilhado).toBe(true);
});

/* -------------------------------------------------------------- edição §3.2 */

test('colaborador/editar: corpo com "ativo" devolve 400 CAMPO_NAO_EDITAVEL', async ({ request }) => {
  const corpo = await dados(request);
  const p = corpo.pessoas[0];
  const r = await colaborador(request, { pessoa_id: p.pessoa_id, versao_cadastro: p.versao_cadastro, ativo: false });
  expect(r.status()).toBe(400);
  expect((await r.json()).erro.codigo).toBe('CAMPO_NAO_EDITAVEL');
});

test('colaborador/editar: campo derivado (tem_biometria) devolve 400 CAMPO_DERIVADO', async ({ request }) => {
  const corpo = await dados(request);
  const p = corpo.pessoas[0];
  const r = await colaborador(request, { pessoa_id: p.pessoa_id, versao_cadastro: p.versao_cadastro, tem_biometria: true });
  expect(r.status()).toBe(400);
  expect((await r.json()).erro.codigo).toBe('CAMPO_DERIVADO');
});

test('colaborador/editar: versao_cadastro divergente devolve 409 com o registro atual', async ({ request }) => {
  const corpo = await dados(request);
  const p = corpo.pessoas[0];
  const r = await colaborador(request, { pessoa_id: p.pessoa_id, versao_cadastro: p.versao_cadastro + 1, nome: 'Outro Nome' });
  expect(r.status()).toBe(409);
  const json = await r.json();
  expect(json.erro.codigo).toBe('CADASTRO_DESATUALIZADO');
  expect(json.registro_atual.pessoa_id).toBe(p.pessoa_id);
});

test('colaborador/editar: matricula muda livremente antes da primeira marcacao', async ({ request }) => {
  const corpo = await dados(request);
  const p = corpo.pessoas.find(x => x.pessoa_id === 'p-carla');
  const r = await colaborador(request, { pessoa_id: p.pessoa_id, versao_cadastro: p.versao_cadastro, matricula: '999' });
  expect(r.status()).toBe(200);
});

test('colaborador/editar: matricula trava depois da primeira marcacao', async ({ request }) => {
  ctx.estado.marcacoes.set('m1', { id_cliente: 'm1', pessoa_id: 'p-carla', tipo: 'entrada', marcado_em: '2026-08-20T10:00:00Z' });
  const corpo = await dados(request);
  const p = corpo.pessoas.find(x => x.pessoa_id === 'p-carla');
  const r = await colaborador(request, { pessoa_id: p.pessoa_id, versao_cadastro: p.versao_cadastro, matricula: '999' });
  expect(r.status()).toBe(422);
  expect((await r.json()).erro.codigo).toBe('MATRICULA_IMUTAVEL');
});

test('colaborador/editar: equipe_id null e estado valido (sem equipe)', async ({ request }) => {
  const corpo = await dados(request);
  const p = corpo.pessoas.find(x => x.pessoa_id === 'p-carla');
  const r = await colaborador(request, { pessoa_id: p.pessoa_id, versao_cadastro: p.versao_cadastro, equipe_id: null });
  expect(r.status()).toBe(200);
  const depois = await dados(request);
  expect(depois.pessoas.find(x => x.pessoa_id === 'p-carla').equipe_id).toBe(null);
});

/* -------------------------------------------------------- inativar/reativar */

test('colaborador/inativar: sem idempotency_key devolve 400', async ({ request }) => {
  const r = await inativar(request, { pessoa_id: 'p-carla', versao_cadastro: 1, motivo: 'saiu da empresa' });
  expect(r.status()).toBe(400);
  expect((await r.json()).erro.codigo).toBe('IDEMPOTENCIA_AUSENTE');
});

test('colaborador/inativar: motivo curto devolve 422', async ({ request }) => {
  const corpo = await dados(request);
  const p = corpo.pessoas.find(x => x.pessoa_id === 'p-carla');
  const r = await inativar(request, { pessoa_id: p.pessoa_id, versao_cadastro: p.versao_cadastro, motivo: 'curto', idempotency_key: 'k1' });
  expect(r.status()).toBe(422);
});

test('colaborador/inativar: sucesso zera biometria, marcacoes ficam intactas, e a chamada e idempotente', async ({ request }) => {
  ctx.estado.marcacoes.set('m1', { id_cliente: 'm1', pessoa_id: 'p-carla', tipo: 'entrada', marcado_em: '2026-08-20T10:00:00Z' });
  const antes = await dados(request);
  const p = antes.pessoas.find(x => x.pessoa_id === 'p-carla');

  const r1 = await inativar(request, { pessoa_id: p.pessoa_id, versao_cadastro: p.versao_cadastro, motivo: 'saiu da empresa', idempotency_key: 'k-inativa-1' });
  expect(r1.status()).toBe(200);
  const depois = await dados(request);
  const pDepois = depois.pessoas.find(x => x.pessoa_id === 'p-carla');
  expect(pDepois.ativo).toBe(false);
  expect(pDepois.tem_biometria).toBe(false);
  expect(ctx.estado.marcacoes.get('m1')).toBeTruthy();

  // idempotente: mesma chave, mesmo corpo, repete sem exigir versao_cadastro nova
  const r2 = await inativar(request, { pessoa_id: p.pessoa_id, versao_cadastro: p.versao_cadastro, motivo: 'saiu da empresa', idempotency_key: 'k-inativa-1' });
  expect(r2.status()).toBe(200);
});

test('colaborador/reativar: exige telefone valido no corpo e devolve sem biometria', async ({ request }) => {
  const antes = await dados(request);
  const p = antes.pessoas.find(x => x.pessoa_id === 'p-carla');
  await inativar(request, { pessoa_id: p.pessoa_id, versao_cadastro: p.versao_cadastro, motivo: 'saiu da empresa', idempotency_key: 'k-inativa-2' });
  const inativa = (await dados(request)).pessoas.find(x => x.pessoa_id === 'p-carla');

  const semTelefone = await reativar(request, { pessoa_id: p.pessoa_id, versao_cadastro: inativa.versao_cadastro, telefone: '', idempotency_key: 'k-reativa-1' });
  expect(semTelefone.status()).toBe(422);

  const r = await reativar(request, { pessoa_id: p.pessoa_id, versao_cadastro: inativa.versao_cadastro, telefone: '67998760099', idempotency_key: 'k-reativa-2' });
  expect(r.status()).toBe(200);
  const ativaDeNovo = (await dados(request)).pessoas.find(x => x.pessoa_id === 'p-carla');
  expect(ativaDeNovo.ativo).toBe(true);
  expect(ativaDeNovo.tem_biometria).toBe(false);
});

/* --------------------------------------------------------------------- equipe */

test('equipe/criar: nome duplicado entre equipes ativas devolve 409', async ({ request }) => {
  const r = await equipe(request, { nome: 'Equipe Um' });
  expect(r.status()).toBe(409);
  expect((await r.json()).erro.codigo).toBe('EQUIPE_DUPLICADA');
});

test('equipe/inativar: com membro ativo devolve 422 com a contagem', async ({ request }) => {
  const r = await equipe(request, { equipe_id: 'eq-1', nome: 'Equipe Um', ativo: false });
  expect(r.status()).toBe(422);
  const json = await r.json();
  expect(json.erro.codigo).toBe('EQUIPE_COM_MEMBROS');
  expect(json.membros_ativos).toBeGreaterThan(0);
});

test('equipe/inativar: sem membro ativo funciona e tira a equipe do escopo dos aparelhos que a tinham', async ({ request }) => {
  const criada = await (await equipe(request, { nome: 'Equipe Vazia' })).json();
  ctx.estado.dispositivos.set('disp-x', {
    dispositivo_id: 'disp-x', credencial_hash: 'x', estado: 'ativo',
    equipes_ids: ['eq-1', criada.equipe_id], configuracao_versao: 1
  });
  const r = await equipe(request, { equipe_id: criada.equipe_id, nome: 'Equipe Vazia', ativo: false });
  expect(r.status()).toBe(200);
  const disp = ctx.estado.dispositivos.get('disp-x');
  expect(disp.equipes_ids).toEqual(['eq-1']);
  expect(disp.configuracao_versao).toBe(2);
});
