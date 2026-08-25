// A ULTIMA CAMADA: adaptador do API-3 EM EXECUCAO contra NEON DE VERDADE.
//
// Os outros arquivos medem contra Postgres em container. Este mede contra o
// banco gerenciado, pelo driver HTTP real do Neon — sem mock, sem emulacao.
// E o unico tier que exercita `neon()` como a producao exercita, e foi
// exatamente ali que morava o bug do fdbd786 (7 metodos chamando
// sql(texto, params), forma que o driver nao aceita).
//
// BANCO: `arnes`, descartavel, separado do banco da demo (`neondb`). Nao e
// branch — e outro banco no mesmo projeto Neon, o que preserva o host e
// portanto o `import { neon }` fixo do adaptador.
//
// POR QUE A TRAVA ABAIXO EXISTE: minhas corridas GRAVAM aparelhos e marcacoes
// de verdade e eu NAO consigo limpar (e nem deveria: marcacao, por contrato,
// nunca e alterada). Rodar isto contra o banco da demo seria irreversivel por
// desenho — deixaria "Aparelho arnes" pendentes e pontos de gente que nao
// existe no livro do cliente, no dia da apresentacao. O DevOps ja fechou essa
// porta por GRANT (medido: arnes_escrita nao le nem escreve em neondb). A trava
// aqui e a segunda linha, e ela e minha: se a env apontar para qualquer banco
// que nao seja `arnes`, este arquivo REPROVA em vez de rodar.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const URL_ESCRITA = process.env.ARNES_PG_URL_ESCRITA;
const BANCO_ESPERADO = 'arnes';

/** null quando pode rodar; string com o motivo quando nao. */
function impedimentoDeSeguranca() {
  if (!URL_ESCRITA) {
    return 'ARNES_PG_URL_ESCRITA ausente — pegue com `vercel env pull` em servidor/.';
  }
  let alvo;
  try { alvo = new URL(URL_ESCRITA).pathname.replace(/^\//, '').split('?')[0]; }
  catch { return 'ARNES_PG_URL_ESCRITA nao e uma URL valida.'; }
  if (alvo !== BANCO_ESPERADO) {
    // NAO e pulo: apontar escrita para outro banco e o erro que este arquivo
    // existe para impedir, e pular deixaria a esteira verde.
    return `RECUSA DE SEGURANCA: ARNES_PG_URL_ESCRITA aponta para "${alvo}", nao "${BANCO_ESPERADO}". ` +
      'Este arquivo GRAVA marcacoes, e marcacao nunca e apagada. Nao rodo fora do banco descartavel.';
  }
  return null;
}

const impedimento = impedimentoDeSeguranca();
// `!!` de proposito: sem `!!` isto vale `null` quando nao ha impedimento, e
// `assert.equal(null, false)` reprova — a trava acusaria a si mesma.
const bancoErrado = !!(impedimento && impedimento.startsWith('RECUSA'));
// Sem credencial: pula com motivo. Credencial apontando para o banco errado:
// REPROVA. As duas situacoes sao diferentes e nao podem ter o mesmo desfecho.
const pular = impedimento && !bancoErrado ? { skip: impedimento } : {};

const SIMULTANEAS = 8;
const RODADAS = 3;   // menos que em container: cada ida e volta e rede real.

const cripto = {
  uuid: () => crypto.randomUUID(),
  tokenAleatorio: n => crypto.randomBytes(n).toString('base64url'),
  inteiroAleatorio: n => crypto.randomInt(n),
  sha256: v => crypto.createHash('sha256').update(String(v)).digest('base64url')
};

const medido = {};
let repo;

before(async () => {
  if (impedimento) return;
  const { criarRepositorioPostgres } = await import('../../servidor/persistencia/postgres.js');
  const { enviarLote } = await import('../../nucleo/casos/marcacao.js');
  const { aprovar } = await import('../../nucleo/casos/aparelho.js');

  repo = criarRepositorioPostgres({ connectionString: URL_ESCRITA });
  const ctx = { repo, cripto, cfg: { expiraPendenteMs: 24 * 3600 * 1000 } };

  // A semente do DevOps ja trouxe equipes e pessoas; so falta o aparelho.
  const pessoas = await repo.listarPessoas();
  const equipes = await repo.listarEquipes();
  assert.ok(pessoas.length > 0, 'banco arnes sem pessoas semeadas');
  const pessoa = pessoas[0];
  const equipe = equipes[0];

  const marca = 'qa' + Date.now().toString(36);
  await repo.inserirDispositivoSeAusente({
    dispositivo_id: 'disp-' + marca, pendente_id: 'pd-' + marca,
    credencial_hash: cripto.sha256('s-' + marca), apelido: 'Arnes ' + marca,
    estado: 'ativo', equipes_ids: [equipe.equipe_id], criado_em: new Date().toISOString()
  });

  // ---------------- corrida 1: marcacao duplicada ----------------
  let quebradasM = 0, piorAceitos = 0;
  for (let r = 0; r < RODADAS; r++) {
    const idCliente = `${marca}-m${r}`;
    const agoraMs = Date.now();
    const req = {
      corpo: { dispositivo_id: 'disp-' + marca, marcacoes: [{
        id_cliente: idCliente, pessoa_id: pessoa.pessoa_id,
        marcado_em: new Date(agoraMs).toISOString(), tipo: 'entrada', veredito: 'aceito' }] },
      agoraMs, agoraIso: new Date(agoraMs).toISOString()
    };
    const itens = (await Promise.all(Array.from({ length: SIMULTANEAS }, () => enviarLote(ctx, req))))
      .map(x => x.corpo.resultados[0].status);
    const aceitos = itens.filter(s => s === 'aceito').length;
    const dups = itens.filter(s => s === 'duplicado').length;
    piorAceitos = Math.max(piorAceitos, aceitos);
    if (aceitos !== 1 || dups !== SIMULTANEAS - 1) quebradasM++;
  }
  medido.marcacao = { quebradas: quebradasM, piorAceitos };

  // ---------------- corrida 2: aprovacao por codigo ----------------
  let quebradasA = 0, piorGanhadores = 0, incoerencias = 0;
  const alfabeto = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  for (let r = 0; r < RODADAS; r++) {
    const codigo = Array.from({ length: 6 }, () => alfabeto[crypto.randomInt(alfabeto.length)]).join('');
    const id = `disp-${marca}-p${r}`;
    await repo.inserirDispositivoSeAusente({
      dispositivo_id: id, pendente_id: `pd-${marca}-p${r}`,
      credencial_hash: cripto.sha256(id), apelido: 'Pendente ' + r,
      estado: 'pendente', codigo_curto: codigo, criado_em: new Date().toISOString()
    });
    const agoraMs = Date.now();
    const respostas = await Promise.all(Array.from({ length: SIMULTANEAS }, (_, i) =>
      aprovar(ctx, {
        corpo: { codigo, equipes_ids: [equipe.equipe_id], idempotency_key: `${marca}-ik-${r}-${i}` },
        rh: { usuario: `rh-${marca}-${r}-${i}` },
        agoraMs, agoraIso: new Date(agoraMs).toISOString()
      }).then(resp => ({ i, resp }))));

    const ganhadores = respostas.filter(x => x.resp.status === 200);
    const recusados = respostas.filter(x =>
      x.resp.status === 404 && x.resp.corpo.erro.codigo === 'CODIGO_NAO_ENCONTRADO').length;
    const linha = await repo.lerDispositivo(id);
    piorGanhadores = Math.max(piorGanhadores, ganhadores.length);
    let quebrou = ganhadores.length !== 1 || recusados !== SIMULTANEAS - 1 || linha.estado !== 'ativo';
    if (ganhadores.length === 1 && linha.aprovado_por !== `rh-${marca}-${r}-${ganhadores[0].i}`) {
      quebrou = true; incoerencias++;
    }
    if (quebrou) quebradasA++;
  }
  medido.aprovacao = { quebradas: quebradasA, piorGanhadores, incoerencias };

  console.log('\n[neon-real] adaptador API-3 + driver neon() real + Neon gerenciado');
  console.log(`  marcacao duplicada .... ${medido.marcacao.quebradas}/${RODADAS} quebradas | pior caso ${medido.marcacao.piorAceitos} aceito(s)`);
  console.log(`  aprovacao por codigo .. ${medido.aprovacao.quebradas}/${RODADAS} quebradas | pior caso ${medido.aprovacao.piorGanhadores} aprovacao(oes) | ${medido.aprovacao.incoerencias} incoerencia(s)`);
}, { timeout: 600000 });

after(async () => { /* banco descartavel: o lixo fica de proposito, e evidencia */ });

test('a env de escrita aponta para o banco descartavel, nunca para a demo', () => {
  assert.equal(bancoErrado, false, impedimento || '');
});

test('Neon real: marcacao duplicada NAO passa sob concorrencia', pular, () => {
  if (bancoErrado) assert.fail(impedimento);
  assert.equal(medido.marcacao.quebradas, 0,
    `pior caso: ${medido.marcacao.piorAceitos} aceitos para o mesmo id_cliente em Neon real.`);
});

test('Neon real: um codigo de uso unico ativa UMA vez', pular, () => {
  if (bancoErrado) assert.fail(impedimento);
  assert.equal(medido.aprovacao.quebradas, 0,
    `pior caso: ${medido.aprovacao.piorGanhadores} aprovacoes, ${medido.aprovacao.incoerencias} incoerencias.`);
});
