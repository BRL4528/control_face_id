// A ULTIMA LINHA: as corridas contra a PILHA COMPLETA, por HTTP.
//
// Todas as outras medicoes deste diretorio param antes da rede: chamam os casos
// de uso direto, ou o adaptador direto. Esta atravessa tudo — funcao da Vercel,
// rewrite, roteador, autenticacao, nucleo, adaptador, Neon.
//
// SEMEIA PELAS ROTAS REAIS, nunca por SQL. Duas razoes, e a segunda e do
// DevOps e e melhor que a minha:
//   1. minha credencial no banco da demo e so-leitura, por desenho;
//   2. semear por INSERT fabrica estado por baixo do sistema — o portao podia
//      ficar verde sobre uma linha que a API NUNCA conseguiria criar. Semear
//      pela rota prova o caminho de criacao junto.
//
// TRAVA DE AMBIENTE — este arquivo GRAVA, e por isso ela existe.
//
// As corridas registram aparelhos e gravam marcacoes DE VERDADE, pelas rotas.
// Nao ha como limpar depois: marcacao, por contrato, nunca e alterada. Apontar
// isto para a origem de producao encheria a aba Aparelhos do cliente de
// "Arnes ..." pendentes e o livro de marcacoes de pontos de gente que nao
// existe — no dia da apresentacao, e de forma irreversivel POR DESENHO.
//
// Entao antes de escrever qualquer coisa o arquivo pergunta ao /api/saude em
// que BANCO aquela origem esta, e so roda contra o descartavel. Repare que o
// /api/saude e usado aqui como IDENTIDADE, nunca como atestado de saude — foi
// justamente ele respondendo {"ok":true,"banco":"ok"} que fez as 8 rotas
// parecerem de pe enquanto respondiam 404 o dia inteiro.
//
// E a terceira trava, com dono e modo de falha diferentes das outras duas:
// a do DevOps por GRANT, a de neon-real.test.js por connection string, esta
// por resposta da propria origem. As tres cairem juntas exige tres enganos sem
// relacao entre si.
//
// AMBIENTE: mede o que ARNES_API_BASE apontar, e o relatorio TEM de dizer qual.
// Em 25/08 as 8 estao publicadas em PREVIEW e producao ainda responde 404 — um
// numero verde sem o ambiente colado seria lido como "a API esta de pe" e
// alguem apontaria o app pra producao.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { derivar } from '../../js/cripto.js';

const BASE = process.env.ARNES_API_BASE;
const BYPASS = process.env.ARNES_BYPASS;
const SENHA_RH = process.env.ARNES_SENHA_RH || 'arnes-senha-de-teste';
const USUARIO_RH = process.env.ARNES_USUARIO_RH || 'rh';

const pular = BASE ? {} : { skip: 'ARNES_API_BASE ausente — sem origem nao ha pilha HTTP para medir.' };

// Aprovacao: UMA rodada. LIMITE_APROVACAO conta tentativa errada por usuario de
// RH (10 em 5 min) e aqui todas as requisicoes usam o MESMO usuario, porque a
// credencial e real. Com 8 simultaneas, 7 perdedores = 7 tentativas erradas na
// rodada 1 e 14 na rodada 2, que estoura o limitador e devolve 429 — vermelho
// verdadeiro, de outro assunto. Uma rodada mede o que precisa ser medido.
const SIMULTANEAS = 8;
const RODADAS_MARCACAO = 3;

const url = r => BASE.replace(/\/$/, '') + r;
const cabecalhos = extra => Object.assign(
  { 'content-type': 'application/json' },
  BYPASS ? { 'x-vercel-protection-bypass': BYPASS } : {}, extra || {});

async function post(rota, corpo, extra) {
  const r = await fetch(url(rota), { method: 'POST', headers: cabecalhos(extra), body: JSON.stringify(corpo || {}) });
  let json = null;
  try { json = JSON.parse(await r.text()); } catch { /* nao-JSON */ }
  return { status: r.status, json };
}

const BANCO_DESCARTAVEL = 'arnes';

const medido = {};
let erroDeSemeadura = null;
let identidade = null;
let recusa = null;

before(async () => {
  if (!BASE) return;
  // --- 0. IDENTIDADE DA ORIGEM, antes de escrever qualquer coisa.
  try {
    const r = await fetch(url('/api/saude'), { headers: cabecalhos() });
    identidade = JSON.parse(await r.text());
  } catch (e) {
    recusa = 'nao consegui ler /api/saude para identificar a origem: ' + String(e.message);
    return;
  }
  if (identidade && identidade.protection) {
    recusa = 'a origem respondeu com a PROTECAO da plataforma — ARNES_BYPASS ausente ou expirado. NAO MEDI.';
    return;
  }
  if (identidade?.banco_nome !== BANCO_DESCARTAVEL) {
    recusa = `RECUSA DE SEGURANCA: a origem ${BASE} usa o banco ` +
      `"${identidade?.banco_nome ?? '(nao informado)'}", nao "${BANCO_DESCARTAVEL}". ` +
      'Este arquivo GRAVA aparelhos e marcacoes pelas rotas e nao consegue limpar — ' +
      'marcacao nunca e alterada. Nao rodo fora do banco descartavel. ' +
      '(Producao nao informa banco_nome de proposito, entao ela cai aqui tambem.)';
    return;
  }

  try {
    const marca = 'qa' + Date.now().toString(36);
    const segredo = 'seg-' + crypto.randomUUID();
    const publica = crypto.createHash('sha256').update(segredo).digest('base64url');

    // --- 1. o aparelho se registra (rota 1 das 8)
    const reg = await post('/webhook/efrat/dispositivo/registrar', {
      dispositivo_id: 'disp-' + marca, credencial_publica: publica,
      apelido: 'Arnes ' + marca, ua: 'arnes/1.0'
    });
    assert.equal(reg.status, 202, 'registrar: ' + JSON.stringify(reg));
    const codigo = reg.json.codigo_curto;
    assert.ok(codigo, 'registrar nao devolveu codigo_curto');

    // --- 2. RH deriva a chave (rota 3 das 8). A senha nunca trafega.
    const sal = await post('/webhook/efrat/rh/sal', { usuario: USUARIO_RH });
    assert.equal(sal.status, 200, 'rh/sal: ' + JSON.stringify(sal));
    const chave = await derivar(SENHA_RH, sal.json.sal, sal.json.iteracoes);

    // --- 3. de quais equipes? pergunta pela rota do RH (rota 4 das 8)
    const aparelhos = await post('/webhook/efrat/rh/aparelhos', { usuario: USUARIO_RH, chave });
    assert.equal(aparelhos.status, 200, 'rh/aparelhos (chave de RH errada?): ' + JSON.stringify(aparelhos));
    // As equipes saem de `ativos[].equipes_ids` — a rota nao lista equipes, e
    // nao ha rota de equipes entre as 8. Tirar do BANCO seria mais direto e
    // seria semear por baixo do sistema; aqui o dado vem por rota, como o
    // resto. Depende de existir ao menos um aparelho ja ativo no ambiente, o
    // que e verdade porque a semente do API-2 cria um.
    const equipes = [...new Set((aparelhos.json.ativos || []).flatMap(a => a.equipes_ids || []))];
    const equipeId = equipes[0];
    assert.ok(equipeId,
      'nenhuma equipe alcancavel por rota: rh/aparelhos nao trouxe aparelho ativo com equipes_ids. ' +
      'Sem isso nao da pra aprovar aparelho, e a corrida NAO foi medida.');

    // --- 4. o RH aprova pelo codigo (rota 5 das 8)
    const aprov = await post('/webhook/efrat/rh/aparelho/aprovar', {
      usuario: USUARIO_RH, chave, codigo, equipes_ids: [equipeId], idempotency_key: marca + '-apr'
    });
    assert.equal(aprov.status, 200, 'aprovar: ' + JSON.stringify(aprov));

    // --- 5. o aparelho baixa a carga (rota 7 das 8) e descobre quem existe
    const carga = await post('/webhook/efrat/carga',
      { dispositivo_id: 'disp-' + marca, modelo_id: 'modelo-arnes' },
      { authorization: 'Bearer ' + segredo });
    assert.equal(carga.status, 200, 'carga: ' + JSON.stringify(carga).slice(0, 200));
    const pessoaId = (carga.json.pessoas || [])[0]?.pessoa_id;
    assert.ok(pessoaId, 'carga sem pessoas na equipe ' + equipeId);

    // ================= CORRIDA 1: marcacao duplicada (rota 8 das 8) =========
    let quebradasM = 0, piorAceitos = 0;
    for (let r = 0; r < RODADAS_MARCACAO; r++) {
      const idCliente = `${marca}-m${r}`;
      const marcacao = { id_cliente: idCliente, pessoa_id: pessoaId,
        marcado_em: new Date().toISOString(), tipo: 'entrada', veredito: 'aceito' };
      const respostas = await Promise.all(Array.from({ length: SIMULTANEAS }, () =>
        post('/webhook/efrat/marcacoes', { dispositivo_id: 'disp-' + marca, marcacoes: [marcacao] },
          { authorization: 'Bearer ' + segredo })));
      const itens = respostas.map(x => x.json?.resultados?.[0]?.status ?? ('http_' + x.status));
      const aceitos = itens.filter(s => s === 'aceito').length;
      const dups = itens.filter(s => s === 'duplicado').length;
      piorAceitos = Math.max(piorAceitos, aceitos);
      if (aceitos !== 1 || dups !== SIMULTANEAS - 1) quebradasM++;
    }
    medido.marcacao = { quebradas: quebradasM, rodadas: RODADAS_MARCACAO, piorAceitos };

    // ================= CORRIDA 2: aprovacao por codigo, uma rodada ==========
    const reg2 = await post('/webhook/efrat/dispositivo/registrar', {
      dispositivo_id: 'disp-' + marca + '-p', credencial_publica: crypto.createHash('sha256').update('x' + marca).digest('base64url'),
      apelido: 'Pendente ' + marca, ua: 'arnes/1.0'
    });
    assert.equal(reg2.status, 202, 'registrar pendente: ' + JSON.stringify(reg2));
    const codigo2 = reg2.json.codigo_curto;

    // Escopo DISTINTO por requisicao (quando ha mais de uma equipe): e o que
    // torna visivel quem de fato ganhou versus quem foi informado que ganhou.
    const respostas = await Promise.all(Array.from({ length: SIMULTANEAS }, (_, i) =>
      post('/webhook/efrat/rh/aparelho/aprovar', {
        usuario: USUARIO_RH, chave, codigo: codigo2,
        equipes_ids: [equipes[i % equipes.length]],
        idempotency_key: `${marca}-race-${i}`
      }).then(resp => ({ i, resp }))));
    const ganhadores = respostas.filter(x => x.resp.status === 200);
    const recusados = respostas.filter(x =>
      x.resp.status === 404 && x.resp.json?.erro?.codigo === 'CODIGO_NAO_ENCONTRADO').length;
    const outros = respostas
      .filter(x => x.resp.status !== 200 && !(x.resp.status === 404 && x.resp.json?.erro?.codigo === 'CODIGO_NAO_ENCONTRADO'))
      .map(x => ({ http: x.resp.status, codigo: x.resp.json?.erro?.codigo }));
    medido.aprovacao = { ganhadores: ganhadores.length, recusados, outros };

    console.log(`\n[corridas-http] AMBIENTE: ${BASE}`);
    console.log(`  identidade da origem: ${JSON.stringify(identidade)}`);
    console.log(`  marcacao duplicada .... ${medido.marcacao.quebradas}/${RODADAS_MARCACAO} quebradas | pior caso ${piorAceitos} aceito(s)`);
    console.log(`  aprovacao (1 rodada) .. ${medido.aprovacao.ganhadores} aprovacao(oes), ${recusados} CODIGO_NAO_ENCONTRADO` +
      (outros.length ? ` | fora do contrato: ${JSON.stringify(outros)}` : ''));
  } catch (e) {
    erroDeSemeadura = e;
  }
}, { timeout: 600000 });

test('a origem e o banco descartavel, nunca producao', pular, () => {
  assert.equal(recusa, null, recusa || '');
});

test('a semeadura pelas rotas reais funcionou', pular, () => {
  assert.equal(recusa, null, 'origem recusada; nada foi medido');
  assert.equal(erroDeSemeadura, null,
    'nao consegui semear pelas rotas reais, entao NAO MEDI as corridas:\n' + (erroDeSemeadura && erroDeSemeadura.message));
});

test('HTTP: mesmo id_cliente simultaneo -> um aceito, resto duplicado', pular, () => {
  assert.equal(recusa, null, 'origem recusada; nada foi medido');
  assert.equal(erroDeSemeadura, null, 'semeadura falhou; este resultado nao existe');
  assert.equal(medido.marcacao.quebradas, 0,
    `pior caso: ${medido.marcacao.piorAceitos} aceitos para o mesmo id_cliente, na pilha completa.`);
});

test('HTTP: mesmo codigo simultaneo -> uma aprovacao so', pular, () => {
  assert.equal(recusa, null, 'origem recusada; nada foi medido');
  assert.equal(erroDeSemeadura, null, 'semeadura falhou; este resultado nao existe');
  assert.equal(medido.aprovacao.ganhadores, 1,
    `${medido.aprovacao.ganhadores} aprovacoes bem-sucedidas para um codigo de uso unico.`);
  assert.deepEqual(medido.aprovacao.outros, [],
    'respostas fora do contrato: ' + JSON.stringify(medido.aprovacao.outros));
});
