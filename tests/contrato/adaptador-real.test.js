// O TIER MAIS ALTO QUE EXISTE HOJE: rota real do API-4 + adaptador real do
// API-3 + DDL real (0001_init.sql) + Postgres real. Sem uma linha alterada em
// nenhum dos dois codigos.
//
// Como, se o adaptador so fala com Neon: `mock.module` troca
// `@neondatabase/serverless` por uma emulacao do `sql` sobre `pg`
// (arnes/sql-pg.js). O que executa continua sendo servidor/persistencia/postgres.js.
//
// POR QUE ISTO IMPORTA, e nao e luxo: conferir a DDL e o SQL por LEITURA — que
// eu ja fiz, e estao certos — nao pega erro de `construirSet`, de ordem dos $n,
// nem de mapeamento de linha. E ali que bug de adaptador mora. Sem isto, o
// adaptador so poderia ser exercitado contra um Neon com escrita, e nenhum
// existia a tempo.
//
// Rodar: node --experimental-test-module-mocks --test tests/contrato/adaptador-real.test.js
import test, { before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { subirBanco, motivoIndisponivel, politicaDeAusencia } from './arnes/banco.js';
import { sqlSobrePg } from './arnes/sql-pg.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const impedimento = await motivoIndisponivel();
const { opcoes: pular, reprovar } = politicaDeAusencia(impedimento);

const SIMULTANEAS = 8;
const RODADAS = 5;

const cripto = {
  uuid: () => crypto.randomUUID(),
  tokenAleatorio: n => crypto.randomBytes(n).toString('base64url'),
  inteiroAleatorio: n => crypto.randomInt(n),
  sha256: v => crypto.createHash('sha256').update(String(v)).digest('base64url')
};

let banco, repo, enviarLote, aprovar;
const medido = {};

before(async () => {
  if (impedimento) return;
  banco = await subirBanco();

  // A DDL DE VERDADE, do commit do API-3.
  const ddl = fs.readFileSync(path.join(RAIZ, 'servidor/persistencia/migrations/0001_init.sql'), 'utf8');
  await banco.pool.query(ddl);

  // O adaptador real, falando com este Postgres em vez de Neon.
  // O especificador tem de ser o modulo que o ADAPTADOR carrega: ele vive em
  // servidor/node_modules, entao o nome nu nao resolve a partir deste arquivo.
  mock.module(path.join(RAIZ, 'servidor/node_modules/@neondatabase/serverless/index.mjs'), {
    namedExports: { neon: () => sqlSobrePg(banco.pool) }
  });
  const { criarRepositorioPostgres } = await import('../../servidor/persistencia/postgres.js');
  ({ enviarLote } = await import('../../nucleo/casos/marcacao.js'));
  ({ aprovar } = await import('../../nucleo/casos/aparelho.js'));

  // Passa por verificarRepositorio dentro da propria fabrica.
  repo = criarRepositorioPostgres({ connectionString: banco.url });

  const ctx = { repo, cripto, cfg: { expiraPendenteMs: 24 * 3600 * 1000 } };

  // ---- semeadura pelo PROPRIO adaptador, nao por SQL cru: exercita mais
  // codigo dele e nao depende de eu adivinhar nomes de coluna.
  await repo.inserirEquipeSeNomeLivre({
    equipe_id: 'eq-1', nome: 'Equipe Um', unidade: 'Campo Grande', ativo: true
  });
  await repo.inserirPessoa({
    pessoa_id: 'ps-1', nome: 'Pessoa Um', matricula: '001', equipe_id: 'eq-1',
    papel: 'colaborador', ativo: true, versao: 1, versao_cadastro: 1, vetores: [], miniatura: ''
  });
  await repo.inserirDispositivoSeAusente({
    dispositivo_id: 'disp-ativo', credencial_hash: cripto.sha256('segredo-ativo'),
    apelido: 'Ativo', estado: 'ativo', equipes_ids: ['eq-1'],
    pendente_id: 'pd-ativo', criado_em: new Date().toISOString()
  });

  // ================= CORRIDA 1 — marcacao duplicada =================
  let quebradasM = 0, piorAceitos = 0;
  for (let r = 0; r < RODADAS; r++) {
    const idCliente = `adp-${r}-${crypto.randomUUID().slice(0, 8)}`;
    const agoraMs = Date.now();
    const req = {
      corpo: { dispositivo_id: 'disp-ativo', marcacoes: [{
        id_cliente: idCliente, pessoa_id: 'ps-1',
        marcado_em: new Date(agoraMs).toISOString(), tipo: 'entrada', veredito: 'aceito' }] },
      agoraMs, agoraIso: new Date(agoraMs).toISOString()
    };
    const respostas = await Promise.all(Array.from({ length: SIMULTANEAS }, () => enviarLote(ctx, req)));
    const itens = respostas.map(x => x.corpo.resultados[0].status);
    const aceitos = itens.filter(s => s === 'aceito').length;
    const dups = itens.filter(s => s === 'duplicado').length;
    const linhas = (await banco.pool.query(
      'select count(*)::int n from efrat_marcacao where id_cliente=$1', [idCliente])).rows[0].n;
    piorAceitos = Math.max(piorAceitos, aceitos);
    if (aceitos !== 1 || dups !== SIMULTANEAS - 1 || linhas !== 1) quebradasM++;
  }
  medido.marcacao = { quebradas: quebradasM, piorAceitos };

  // ================= CORRIDA 2 — aprovacao por codigo =================
  let quebradasA = 0, piorGanhadores = 0, incoerencias = 0;
  const alfabeto = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  for (let r = 0; r < RODADAS; r++) {
    const codigo = Array.from({ length: 6 }, () => alfabeto[crypto.randomInt(alfabeto.length)]).join('');
    const dispositivoId = 'disp-pend-' + r;
    await repo.inserirDispositivoSeAusente({
      dispositivo_id: dispositivoId, pendente_id: 'pd-' + r,
      credencial_hash: cripto.sha256('segredo-' + r), apelido: 'Pendente',
      estado: 'pendente', codigo_curto: codigo, criado_em: new Date().toISOString()
    });
    const agoraMs = Date.now();
    const respostas = await Promise.all(Array.from({ length: SIMULTANEAS }, (_, i) =>
      aprovar(ctx, {
        corpo: { codigo, equipes_ids: ['eq-1'], idempotency_key: `ik-${r}-${i}` },
        rh: { usuario: `rh-${r}-${i}` },
        agoraMs, agoraIso: new Date(agoraMs).toISOString()
      }).then(resp => ({ i, resp }))));

    const ganhadores = respostas.filter(x => x.resp.status === 200);
    const recusados = respostas.filter(x =>
      x.resp.status === 404 && x.resp.corpo.erro.codigo === 'CODIGO_NAO_ENCONTRADO').length;
    const linha = (await banco.pool.query(
      'select * from efrat_dispositivo where dispositivo_id=$1', [dispositivoId])).rows[0];
    piorGanhadores = Math.max(piorGanhadores, ganhadores.length);
    let quebrou = ganhadores.length !== 1 || recusados !== SIMULTANEAS - 1 || linha.estado !== 'ativo';
    if (ganhadores.length === 1 && linha.aprovado_por !== `rh-${r}-${ganhadores[0].i}`) {
      quebrou = true; incoerencias++;
    }
    if (quebrou) quebradasA++;
  }
  medido.aprovacao = { quebradas: quebradasA, piorGanhadores, incoerencias };

  console.log('\n[adaptador-real] rota API-4 + adaptador API-3 + 0001_init.sql + Postgres');
  console.log(`  marcacao duplicada .... ${medido.marcacao.quebradas}/${RODADAS} quebradas | pior caso ${medido.marcacao.piorAceitos} aceito(s)`);
  console.log(`  aprovacao por codigo .. ${medido.aprovacao.quebradas}/${RODADAS} quebradas | pior caso ${medido.aprovacao.piorGanhadores} aprovacao(oes) | ${medido.aprovacao.incoerencias} incoerencia(s)`);
}, { timeout: 300000 });

after(async () => { if (banco) await banco.parar(); });

test('adaptador real: marcacao duplicada NAO passa sob concorrencia', pular, () => {
  if (reprovar) assert.fail(reprovar);
  assert.equal(medido.marcacao.quebradas, 0,
    `ON CONFLICT do API-3 nao segurou. Pior caso: ${medido.marcacao.piorAceitos} aceitos para o mesmo id_cliente.`);
});

test('adaptador real: um codigo de uso unico ativa UMA vez', pular, () => {
  if (reprovar) assert.fail(reprovar);
  assert.equal(medido.aprovacao.quebradas, 0,
    `CAS do API-3 nao segurou. Pior caso: ${medido.aprovacao.piorGanhadores} aprovacoes, ${medido.aprovacao.incoerencias} incoerencias.`);
});
