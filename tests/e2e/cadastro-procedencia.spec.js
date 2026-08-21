// Procedência do template gravado por /efrat/cadastro (T-8ADD9C, achado do
// Orquestrador sobre docs/fase3-seguranca.md § 5.1a): o campo `coerencia` sai
// do CORPO da requisição (o cliente não escolhe mais o próprio veredito), mas
// o servidor persiste e devolve, na RESPOSTA DA ROTA DE ESCRITA, o valor que
// calculou — para log, teste e recalibração (validacao-biometrica.md:85 avisa
// que o limiar vai ser recalibrado com dados da população real).
//
// O que o decimal NÃO faz mais (correção do Orquestrador/Arquiteto,
// docs/fase3-contrato.md § 4.3 + critério 14, depois deste arquivo ter sido
// escrito): não trafega em `/efrat/rh/dados`. A tabela de adornos do
// README.md mostra a faixa aceita legitimamente ocupada por variação de
// pessoa real até quase o limiar (capacete de obra sozinho custa 0,257) —
// mostrar o número treinaria o RH a ignorá-lo. O REGISTRO continua gravando
// `coerencia` (fiel a uma coluna de verdade); só a SERIALIZAÇÃO de
// `/rh/dados` a omite (mapeada na saída pelo handler de 508cd44fd2, nunca
// deixando de gravar na entrada — senão o teste de omissão passaria por
// vacuidade, não haveria nada pra provar que foi removido).
import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import { criarServidor } from './servidor-falso.js';
import { loteMesmaPessoa, maiorDistanciaParAPar } from './fixtures-biometria.js';

const CREDENCIAL = 'credencial-de-teste';

let ctx;

test.beforeEach(async () => {
  const { servidor, estado, pessoas } = criarServidor({});
  await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve));
  ctx = { servidor, estado, pessoas, base: `http://127.0.0.1:${servidor.address().port}/webhook` };
  ctx.estado.dispositivos.set('disp-1', {
    dispositivo_id: 'disp-1',
    credencial_hash: crypto.createHash('sha256').update(CREDENCIAL).digest('base64url'),
    estado: 'ativo', codigo_curto: null, apelido: 'Tablet teste', ua: 'teste',
    geo: null, tentativas: 1, local_id: 'local-piloto', equipes_ids: ['eq-1'],
    configuracao_versao: 1
  });
});

test.afterEach(async () => { await new Promise(resolve => ctx.servidor.close(resolve)); });

async function cadastrar(request, corpo) {
  return request.post(`${ctx.base}/efrat/cadastro`, {
    headers: { Authorization: `Bearer ${CREDENCIAL}`, 'Content-Type': 'application/json' },
    data: Object.assign({ dispositivo_id: 'disp-1', miniatura: '' }, corpo),
    failOnStatusCode: false
  });
}

test('cadastro via RH grava origem e coerência calculada, para procedência (§ 5.1a)', async ({ request }) => {
  const vetores = loteMesmaPessoa();
  const r = await cadastrar(request, { origem: 'rh', nome: 'Ana', matricula: 'M-PROV-RH', equipe_id: 'eq-1', vetores });
  const corpo = await r.json();

  expect(corpo.ok).toBe(true);
  expect(corpo.coerencia).toBeCloseTo(maiorDistanciaParAPar(vetores), 9);

  const gravado = ctx.pessoas.find(p => p.matricula === 'M-PROV-RH');
  expect(gravado.origem).toBe('rh');
  expect(gravado.coerencia).toBeCloseTo(maiorDistanciaParAPar(vetores), 9);
  expect(gravado.criado_em).toBeTruthy();
});

test('cadastro pendente (caminho do gestor) entra na fila do RH — coerência persistida, mas não trafega em /rh/dados', async ({ request }) => {
  const vetores = loteMesmaPessoa();
  const r = await cadastrar(request, {
    origem: 'gestor', pessoa_id: 'p-ana', nome: 'Ana Souza', matricula: '001', equipe_id: 'eq-1', vetores
  });
  const corpo = await r.json();
  expect(corpo.ok).toBe(true);
  expect(corpo.status).toBe('pendente');

  // O registro (equivalente a uma linha de Data Table) guarda o decimal —
  // é o insumo de auditoria/recalibração que docs/fase3-contrato.md § 4.7 pede.
  const registro = ctx.estado.recadastros.find(t => t.pessoa_id === 'p-ana');
  expect(registro, 'o recadastro do gestor precisa existir no estado do servidor').toBeTruthy();
  expect(registro.coerencia).toBeCloseTo(maiorDistanciaParAPar(vetores), 9);

  // A RESPOSTA que o RH lê não carrega o decimal — só a existência da
  // pendência. Mostrar o número treinaria o RH a ignorá-lo (README.md: a
  // faixa aceita já é ocupada por variação legítima até perto do limiar).
  const dados = await (await request.post(`${ctx.base}/efrat/rh/dados`, {
    data: { usuario: 'rh', chave: 'CHAVE-DE-TESTE', dias: 30 }
  })).json();
  const pendencia = dados.recadastros.find(t => t.pessoa_id === 'p-ana');
  expect(pendencia, 'o recadastro do gestor precisa aparecer na fila do RH').toBeTruthy();
  expect(pendencia.coerencia).toBeUndefined();
});
