// Semeia o banco da API com o minimo que o roteiro do teste precisa.
//
// NAO ESCREVE SQL, de proposito. Tudo passa pela interface de nucleo/
// repositorio.js. Se a semente falasse SQL, existiriam duas fontes do schema —
// a DDL e ela — e elas divergiriam em silencio no primeiro ALTER: a semente
// continuaria rodando, gravando na forma velha, e ninguem veria ate o teste.
//
// A senha do RH nunca e gravada nem impressa. O servidor guarda so a chave
// PBKDF2-SHA256/256, derivada pelo MESMO js/cripto.js que o navegador usa —
// importado, nao reimplementado. Reimplementar em Node criaria a segunda fonte
// que diverge no dia em que alguem trocar o hash, e o sintoma seria o RH nao
// conseguir entrar, sem erro que explique.
//
// Uso:
//   SENHA_RH='...' node servidor/semear.mjs --repo memoria   # prova, sem banco
//   SENHA_RH='...' node servidor/semear.mjs --repo pg        # banco real
//
// Idempotente: rodar de novo nao duplica.

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..');

const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const qual = arg('--repo') || 'memoria';
let urlPg = null;
const planoPath = arg('--plano') || path.join(AQUI, 'semente.json');

const morrer = m => { console.error('\n  ERRO: ' + m + '\n'); process.exit(1); };

const senhaRh = process.env.SENHA_RH;
if (!senhaRh) {
  morrer('falta SENHA_RH no ambiente.\n\n' +
    '  Ela nao vive em arquivo nenhum e nao da para recuperar depois: o servidor\n' +
    '  guarda so a chave derivada. Combine a senha com quem vai operar o RH no\n' +
    '  teste ANTES de semear.\n\n' +
    "    SENHA_RH='...' node servidor/semear.mjs --repo " + qual);
}
if (senhaRh.length < 8) morrer('SENHA_RH com menos de 8 caracteres — nao vai para producao assim.');

const plano = JSON.parse(fs.readFileSync(planoPath, 'utf8'));

// ---------------------------------------------------------------- repositorio
const nucleo = path.join(RAIZ, 'nucleo');
if (!fs.existsSync(nucleo)) {
  morrer('nucleo/ nao existe nesta arvore.\n\n' +
    '  A semente escreve pela interface de nucleo/repositorio.js (cartao API-1).\n' +
    '  Traga o nucleo antes de semear — a alternativa seria a semente falar SQL,\n' +
    '  e ai o schema teria duas fontes.');
}

let repo;
if (qual === 'memoria') {
  // ANDAIME, e so para --repo memoria: a de memoria foi feita para sentar sobre
  // o `estado` que tests/e2e/servidor-falso.js monta, e esse objeto e dele, nao
  // meu. Aqui monto a forma vazia so para PROVAR a semente antes de o adaptador
  // de banco existir. Quando o servidor falso exportar o construtor do estado,
  // isto vira uma linha de import e some — nao ha invariante morando aqui.
  const vazio = () => new Map();
  const estado = {
    equipes: vazio(), dispositivos: vazio(), marcacoes: vazio(), convites: vazio(),
    codigosPendentes: vazio(), pendentesPorId: vazio(), idempotencia: vazio(),
    sessoesGestor: vazio(), modelosObservados: vazio(), tokenHashParaConvite: vazio(),
    limitesAprovacao: vazio(), limitesCadastro: vazio(),
    limitesIdentificacao: vazio(), limitesVolumeAnonimo: vazio(),
    inativos: new Set(),
    correcoes: [], decisoes: [], recadastros: [], equipesCriadas: [],
    colaboradoresCriados: [], auditoriaIdentificacao: [], auditoriaAprovacao: [],
    referenciaModeloApp: null, tokenLegadoConsumido: false
  };
  const { criarRepositorioMemoria } = await import(path.join(nucleo, 'memoria.js'));
  repo = criarRepositorioMemoria({ estado, pessoas: [], rhUsuario: null });
} else if (qual === 'pg') {
  // O adaptador e do cartao API-3 e o caminho dele ainda pode mudar. Procuro
  // nos lugares plausiveis e, se nao achar, DIGO ONDE PROCUREI — erro que
  // esconde onde olhou faz a pessoa procurar de novo pelo mesmo lugar.
  const candidatos = ['persistencia/postgres.js'].map(c => path.join(AQUI, c));
  const adaptador = candidatos.find(c => fs.existsSync(c));
  if (!adaptador) {
    morrer('nao achei o adaptador de Postgres (cartao API-3). Procurei em:\n' +
      candidatos.map(c => '    ' + path.relative(RAIZ, c)).join('\n') +
      '\n\n  Ate ele chegar, prove a semente contra a de memoria:\n' +
      '    SENHA_RH=... node servidor/semear.mjs --repo memoria');
  }
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) morrer('falta DATABASE_URL — rode `vercel env pull` em servidor/.');
  const { criarRepositorioPostgres } = await import(adaptador);
  repo = criarRepositorioPostgres({ connectionString: url });
  urlPg = url;
} else {
  morrer(`--repo desconhecido: ${qual} (use memoria ou pg)`);
}

// --------------------------------------------------------------------- semear
const feito = [];
const jaEstava = [];

// Equipes. inserirEquipeSeNomeLivre e ATOMICO e ja devolve se inseriu — nao ha
// ler-antes-de-escrever aqui, mesmo numa semente de rodar uma vez so.
for (const e of plano.equipes || []) {
  const r = await repo.inserirEquipeSeNomeLivre(e);
  (r && r.inserida === false ? jaEstava : feito).push(`equipe ${e.nome}`);
}

// Pessoas. Nascem SEM biometria: o rosto entra ao vivo no teste, pela camera do
// PC (rota /efrat/rh/face/cadastrar). Vetor de fixture nao casa com ninguem
// real, entao semear rosto daria verde e falharia na frente da camera.
const existentes = new Set((await repo.listarPessoas()).map(p => p.pessoa_id));
for (const p of plano.pessoas || []) {
  if (existentes.has(p.pessoa_id)) { jaEstava.push(`pessoa ${p.nome}`); continue; }
  await repo.inserirPessoa({ ...p, versao_cadastro: 0, vetores: null, miniatura: null });
  feito.push(`pessoa ${p.nome}`);
}

// Usuario de RH. Sal NOVO a cada semeadura — sal fixo e do fixture do e2e.
const { derivar } = await import(path.join(RAIZ, 'js/cripto.js'));
const cfgRh = plano.usuario_rh || {};
const iteracoes = cfgRh.iteracoes || 150000;
const sal = randomBytes(16).toString('hex');
const chave = await derivar(senhaRh, sal, iteracoes);

// A UNICA EXCECAO A REGRA DE NAO ESCREVER SQL, e ela e deliberada.
//
// Nao existe inserirUsuarioRh na interface, e nao vai existir. Decisao do
// Orquestrador com o Engenheiro de Persistencia, por desenho e nao por prazo:
// nenhuma das 8 rotas CRIA usuario de RH, entao abrir esse metodo poria na
// producao uma capacidade privilegiada de escrita que nenhum caminho de
// produto exercita — porta que fica aberta para sempre porque um dia a semente
// precisou dela. Gestao de usuario de RH vira produto de verdade depois (rota,
// autenticacao, auditoria), nao agora pela porta dos fundos.
//
// Semente e concern de semente. O preco e este arquivo conhecer UM nome de
// tabela e seis colunas — e por isso este bloco esta isolado aqui embaixo, e
// nao espalhado.
if (qual === 'memoria') {
  console.log('\n  (--repo memoria: usuario de RH nao e gravado, a de memoria o recebe na construcao)');
} else {
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(urlPg);
  // chave_hash, nunca a chave em claro: e o material de conferencia que
  // lerUsuarioRh devolve. ON CONFLICT para a semente ser idempotente e para
  // resemear trocar a senha sem precisar apagar linha.
  await sql`
    insert into efrat_usuario_rh (usuario, nome, sal, iteracoes, chave_hash, ativo)
    values (${cfgRh.usuario}, ${cfgRh.nome}, ${sal}, ${iteracoes}, ${chave}, true)
    on conflict (usuario) do update
      set nome = excluded.nome, sal = excluded.sal,
          iteracoes = excluded.iteracoes, chave_hash = excluded.chave_hash,
          ativo = true`;
  feito.push(`usuario de RH "${cfgRh.usuario}" (SQL direto — excecao documentada)`);
}

// ----------------------------------------------------- conferencia da chave
// LINHA EXISTIR NAO PROVA QUE A CHAVE CASA. Se sal, iteracoes ou chave_hash
// sairem dessincronizados do que js/cripto.js produz, /efrat/rh/sal devolve
// numero e o navegador deriva OUTRA coisa: o operador le "usuario ou senha
// invalidos" e vai tentar de novo digitando mais devagar. Mesma tela da senha
// errada, conserto oposto.
//
// Isto aqui fecha a metade que da para fechar sem rota no ar: le de volta o que
// FOI GRAVADO e re-deriva com o mesmo js/cripto.js. A outra metade — login de
// verdade por HTTP — esta no runbook, porque depende das rotas do API-4.
if (qual !== 'memoria') {
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(urlPg);
  const [linha] = await sql`
    select sal, iteracoes, chave_hash from efrat_usuario_rh where usuario = ${cfgRh.usuario}`;
  if (!linha) morrer('a linha de efrat_usuario_rh nao foi gravada.');
  const rederivada = await derivar(senhaRh, linha.sal, linha.iteracoes);
  if (rederivada !== linha.chave_hash) {
    morrer('a chave gravada NAO bate com a que js/cripto.js deriva do sal e das\n' +
      '  iteracoes que o servidor vai devolver. O login do RH falharia amanha\n' +
      '  dizendo "usuario ou senha invalidos" — e a senha estaria certa.');
  }
  if (linha.iteracoes !== 150000) {
    morrer(`iteracoes gravado = ${linha.iteracoes}, e o cliente de producao usa 150000.\n` +
      '  Divergiu: PARE e avise antes de seguir.');
  }
  feito.push(`chave do RH conferida por re-derivacao (${linha.iteracoes} iteracoes)`);
}

// ------------------------------------------------------------------ relatorio
// Nunca imprime senha, chave nem sal: o log de um CI e lido por muita gente.
console.log(`\nsemeado em --repo ${qual}:`);
for (const f of feito) console.log('  +  ' + f);
for (const j of jaEstava) console.log('  =  ' + j + ' (ja estava)');
console.log('\n  aparelho: NENHUM — o codigo curto nasce no proprio aparelho, no passo 1');
console.log('  rosto:    NENHUM — entra ao vivo pelo RH, pela camera do PC');
console.log('  marcacao: NENHUMA — o roteiro nao depende de historico');
console.log(`\n  a senha do RH nao foi gravada nem impressa; so a chave derivada (${iteracoes} iteracoes).\n`);
