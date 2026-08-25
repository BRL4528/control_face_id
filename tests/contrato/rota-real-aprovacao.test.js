// A CORRIDA CONTRA A ROTA DE VERDADE — nucleo/casos/aparelho.js `aprovar`,
// com banco real. Sugestao do proprio API-4, e ele estava certo: e o mesmo
// truque hibrido da marcacao, so mudando qual metodo aponta para onde.
//
// Aqui o hibrido precisa de mais cuidado que na marcacao. La bastava a
// marcacao morar em Postgres. Aqui as DUAS operacoes de aparelho tem de morar
// no MESMO lugar — `lerDispositivoPorCodigoPendente` (a leitura que valida o
// escopo) e `aprovarDispositivoPorCodigo` (o compare-and-set que ativa). Se a
// leitura fosse memoria e a escrita Postgres, o CAS nao acharia linha nenhuma
// e o teste reprovaria por desencontro de armazenamento, nao por corrida — um
// vermelho que nao significa nada e custaria meia hora de investigacao.
//
// Equipes, auditoria, idempotencia e o limitador ficam em memoria: nenhum
// deles participa da janela entre ler e gravar o APARELHO.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { subirBanco, motivoIndisponivel, politicaDeAusencia } from './arnes/banco.js';
import crypto from 'node:crypto';
import { aprovar } from '../../nucleo/casos/aparelho.js';

const impedimento = await motivoIndisponivel();
const { opcoes: pular, reprovar } = politicaDeAusencia(impedimento);

const SIMULTANEAS = 8;
const RODADAS = 5;
const EXPIRA_PENDENTE_MS = 24 * 3600 * 1000;

const DDL = `create table dispositivo_rota (
  dispositivo_id text primary key, pendente_id text, apelido text,
  estado text not null, codigo_curto text, criado_em timestamptz not null,
  equipes_ids text[], unidade text, configuracao_versao int, aprovado_por text, aprovado_em timestamptz)`;

const casCodigo = async (pool, { codigo, criadoDepoisDe, campos }) => {
  const r = await pool.query(
    `update dispositivo_rota
        set estado='ativo', codigo_curto=null, equipes_ids=$3, unidade=$4,
            configuracao_versao=$5, aprovado_por=$6, aprovado_em=$7
      where codigo_curto=$1 and estado='pendente' and criado_em > $2
    returning *`,
    [codigo, new Date(criadoDepoisDe).toISOString(), campos.equipes_ids, campos.unidade,
     campos.configuracao_versao, campos.aprovado_por, campos.aprovado_em]
  );
  return { trocado: r.rowCount === 1, dispositivo: r.rows[0] || null };
};

/** O MESMO if/else, so que lendo antes e gravando depois. */
const lerDepoisGravar = async (pool, { codigo, criadoDepoisDe, campos }) => {
  const atual = await pool.query(
    'select * from dispositivo_rota where codigo_curto = $1', [codigo]);
  const linha = atual.rows[0];
  if (!linha || linha.estado !== 'pendente') return { trocado: false, dispositivo: linha || null };
  if (new Date(linha.criado_em).getTime() <= criadoDepoisDe) return { trocado: false, dispositivo: linha };
  const r = await pool.query(
    `update dispositivo_rota
        set estado='ativo', codigo_curto=null, equipes_ids=$2, unidade=$3,
            configuracao_versao=$4, aprovado_por=$5, aprovado_em=$6
      where dispositivo_id=$1 returning *`,
    [linha.dispositivo_id, campos.equipes_ids, campos.unidade,
     campos.configuracao_versao, campos.aprovado_por, campos.aprovado_em]
  );
  return { trocado: true, dispositivo: r.rows[0] };
};

function repositorioHibrido(pool, trocar) {
  const idem = new Map(), erradas = new Map();
  return {
    // --- APARELHO: as duas no MESMO armazenamento, Postgres.
    async lerDispositivoPorCodigoPendente(codigo, agoraMs, expiraEmMs) {
      const r = await pool.query(
        `select * from dispositivo_rota
          where codigo_curto=$1 and estado='pendente' and criado_em > $2`,
        [codigo, new Date(agoraMs - expiraEmMs).toISOString()]);
      return r.rows[0] || null;
    },
    aprovarDispositivoPorCodigo: p => trocar(pool, p),

    // --- fora da janela de corrida: memoria basta e nao esconde nada.
    async lerEquipe(id) { return { equipe_id: id, nome: id, unidade: 'Campo Grande', ativo: true }; },
    async lerIdempotencia(chave) { return idem.get(chave) || null; },
    async gravarIdempotencia(chave, registro) { idem.set(chave, registro); },
    async tentativasNaJanela(_b, chave) { return erradas.get(chave) || []; },
    async registrarTentativaErrada(_b, chave, agoraMs) {
      erradas.set(chave, [...(erradas.get(chave) || []), agoraMs]);
    },
    async registrarAuditoriaAprovacao() { /* so acrescenta; nao participa da corrida */ }
  };
}

let banco;
const medido = {};

async function medir(pool, trocar) {
  await pool.query('drop table if exists dispositivo_rota cascade');
  await pool.query(DDL);
  const ctx = {
    repo: repositorioHibrido(pool, trocar),
    // Mesmo formato que servidor-falso.js:230 monta — `idempotencia` em
    // nucleo/contexto.js:75 usa sha256 para casar corpo com chave.
    cripto: {
      uuid: () => crypto.randomUUID(),
      tokenAleatorio: n => crypto.randomBytes(n).toString('base64url'),
      inteiroAleatorio: n => crypto.randomInt(n),
      sha256: v => crypto.createHash('sha256').update(String(v)).digest('base64url')
    },
    cfg: { expiraPendenteMs: EXPIRA_PENDENTE_MS }
  };

  let rodadasQuebradas = 0, piorGanhadores = 0, incoerencias = 0;
  for (let r = 0; r < RODADAS; r++) {
    const dispositivoId = `disp-${r}`;
    const codigo = 'ABC' + String(234 + r);
    await pool.query(
      `insert into dispositivo_rota (dispositivo_id, pendente_id, apelido, estado, codigo_curto, criado_em)
       values ($1,$2,'Aparelho','pendente',$3, now())`,
      [dispositivoId, 'pd-' + r, codigo]);

    const agoraMs = Date.now();
    // Usuario de RH distinto por requisicao E por rodada: o LIMITE_APROVACAO
    // conta por usuario, e reusar um so faria o limitador disparar 429 no meio
    // da medicao -- vermelho verdadeiro, mas de outro assunto.
    const respostas = await Promise.all(Array.from({ length: SIMULTANEAS }, (_, i) =>
      aprovar(ctx, {
        corpo: { codigo, equipes_ids: [`eq-${r}-${i}`], idempotency_key: `k-${r}-${i}` },
        rh: { usuario: `rh-${r}-${i}` },
        agoraMs, agoraIso: new Date(agoraMs).toISOString()
      }).then(resp => ({ i, resp }))));

    const ganhadores = respostas.filter(x => x.resp.status === 200);
    const recusados = respostas.filter(x =>
      x.resp.status === 404 && x.resp.corpo.erro.codigo === 'CODIGO_NAO_ENCONTRADO').length;
    const gravado = (await pool.query('select * from dispositivo_rota where dispositivo_id=$1', [dispositivoId])).rows[0];

    piorGanhadores = Math.max(piorGanhadores, ganhadores.length);
    let quebrou = ganhadores.length !== 1 || recusados !== SIMULTANEAS - 1 || gravado.estado !== 'ativo';
    if (ganhadores.length === 1) {
      // Coerencia: o escopo persistido pertence a quem recebeu o 200?
      const esperado = `eq-${r}-${ganhadores[0].i}`;
      if (gravado.aprovado_por !== `rh-${r}-${ganhadores[0].i}` || (gravado.equipes_ids || []).join(',') !== esperado) {
        quebrou = true; incoerencias++;
      }
    }
    if (quebrou) rodadasQuebradas++;
  }
  return { rodadasQuebradas, piorGanhadores, incoerencias };
}

before(async () => {
  if (impedimento) return;
  banco = await subirBanco();
  medido.atomico = await medir(banco.pool, casCodigo);
  medido.ingenuo = await medir(banco.pool, lerDepoisGravar);
  console.log(`\n[rota-real] nucleo/casos/aparelho.js aprovar(), ${SIMULTANEAS} simultaneas, ${RODADAS} rodadas`);
  console.log(`  repo ATOMICO: ${medido.atomico.rodadasQuebradas}/${RODADAS} quebradas | pior caso ${medido.atomico.piorGanhadores} aprovacao(oes)`);
  console.log(`  repo INGENUO: ${medido.ingenuo.rodadasQuebradas}/${RODADAS} quebradas | pior caso ${medido.ingenuo.piorGanhadores} aprovacao(oes)`);
}, { timeout: 300000 });

after(async () => { if (banco) await banco.parar(); });

test('aprovar() real: um codigo de uso unico ativa UMA vez, com repositorio atomico', pular, () => {
  if (reprovar) assert.fail(reprovar);
  assert.equal(
    medido.atomico.rodadasQuebradas, 0,
    `aprovar() REPROVOU com repositorio atomico — o defeito estaria na CAMADA DE ROTA. ` +
    `Pior caso: ${medido.atomico.piorGanhadores} aprovacoes simultaneas, ${medido.atomico.incoerencias} incoerencias.`
  );
});

test('a mesma aprovar() REPROVA quando o repositorio e ler-depois-gravar', pular, () => {
  if (reprovar) assert.fail(reprovar);
  assert.equal(
    medido.ingenuo.rodadasQuebradas, RODADAS,
    'aprovar() passou mesmo com repositorio ingenuo — entao o verde acima nao mede a ' +
    'prova de posse de uso unico, e nao vale como garantia.'
  );
});
