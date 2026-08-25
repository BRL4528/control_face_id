// Ponte entre a Vercel e o roteador do nucleo. A JUNTA.
//
// ESTE ARQUIVO NAO MUDA REGRA NENHUMA. Autenticacao, CORS, idempotencia e
// despacho vivem em nucleo/http.js e nucleo/casos/*. Aqui so se traduz o
// formato de requisicao da Vercel para o que o nucleo espera, e a resposta de
// volta. O tradutor reusavel e nucleo/http-vercel.js -- o irmao de
// nucleo/http-node.js, como o proprio http-node.js previu.
//
// COMO O CAMINHO CHEGA (contrato do vercel.json, do DevOps): o rewrite manda
// /efrat/* e /webhook/efrat/* para ca passando o caminho original na query,
// como `base` + `caminho`. Nao se deduz o caminho de req.url: sob rewrite, o
// que req.url carrega e detalhe de plataforma, e rota casa por comparacao
// EXATA -- "/rh/aparelho/aprovar" e "/rh/aparelho" nao podem virar a mesma
// coisa por causa de um prefixo mal remontado.
//
// E O PREFIXO TEM DE CAIR AQUI. `base` chega como "/webhook/efrat" ou
// "/efrat", e a tabela do nucleo (nucleo/rotas.js) registra "/efrat/...". Se a
// ponte entregasse "/webhook/efrat/..." ao roteador, `achar()` devolveria null
// e TODAS as 8 responderiam 404 -- com a ponte de pe, o banco de pe e a tabela
// carregada. Exatamente a forma de defeito do dia 25/08, uma camada adiante.
//
// 404 contra 501 contra 503, e a distincao e o que custou o dia:
//   404 ROTA_DESCONHECIDA  -> a ponte te alcancou e a tabela nao tem esse caminho.
//   501 NAO_IMPLEMENTADO   -> a rota existe e o adaptador de banco ainda lanca.
//   503 CONFIG_INCOMPLETA  -> falta env var, e a resposta NOMEIA qual.
//   503 TABELA_...         -> a copia de build do nucleo nao chegou.
// Nenhuma delas e "nao existe". Um 404 ambiguo escondeu o dia inteiro que o
// n8n nunca saiu do v2.

import crypto from 'node:crypto';
import { criarManipuladorVercel } from '../nucleo/http-vercel.js';
import { criarRepositorioPostgres, NaoRevisado } from '../persistencia/postgres.js';
import { origensPermitidas } from '../lib/origens.js';
import { carregarRotas } from '../lib/rotas.js';

// ---------------------------------------------------------------------------
// CAMINHO: do contrato de rewrite, nao de req.url
// ---------------------------------------------------------------------------
const PREFIXOS = ['/webhook', '/api/roteador', '/api'];

/**
 * O caminho como ele CHEGOU, do contrato de rewrite. Nome e corpo preservados
 * do placeholder do DevOps (9212eef), que os mediu em preview com aninhamento
 * de tres niveis e nos dois prefixos -- nao mexo no que ja foi medido.
 */
export function caminhoDaRequisicao(req) {
  const base = (req.query && req.query.base) || '';
  const resto = Array.isArray(req.query && req.query.caminho)
    ? req.query.caminho.join('/')
    : ((req.query && req.query.caminho) || '');
  return base + (resto ? '/' + resto : '');
}

/**
 * E AQUI O PREFIXO CAI, e este e o defeito que a medicao do DevOps mostrou sem
 * poder consertar: `caminhoDaRequisicao` devolve "/webhook/efrat/carga", e a
 * tabela do nucleo (nucleo/rotas.js) registra "/efrat/carga". Entregando o cru
 * ao roteador, `achar()` devolve null e TODAS as 8 dao 404 -- com a ponte de
 * pe, o rewrite certo, o banco de pe e a tabela carregada. E a forma de
 * defeito do dia 25/08 uma camada adiante.
 *
 * Devolve o cru tambem, porque o 404 precisa mostrar os dois: quando eles
 * divergem, a divergencia E o defeito.
 */
function resolverCaminhoDaQuery(req, prefixos) {
  const bruto = caminhoDaRequisicao(req);
  // Sem query (chamada direta a /api/roteador durante depuracao, ou rewrite
  // ainda nao no ar): devolve null e o adaptador cai no farejador padrao.
  if (!bruto) return null;

  let caminho = bruto.split('?')[0];
  if (!caminho.startsWith('/')) caminho = '/' + caminho;
  for (const prefixo of prefixos) {
    if (caminho === prefixo) { caminho = '/'; break; }
    if (caminho.startsWith(prefixo + '/')) { caminho = caminho.slice(prefixo.length); break; }
  }
  return { caminho, caminhoBruto: bruto, tokenDaQuery: String((req.query && req.query.token) || '') };
}

// ---------------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------------
// Faltando uma obrigatoria, a API responde 503 NOMEANDO qual -- nunca degrada
// em silencio.
//
// Por que SAL_IP_HASH nao tem padrao: sem ela o `ip_hash` viraria hash de sal
// vazio, e `pedidos_da_mesma_rede_1h` -- o sinal que o RH usa pra ver enxame de
// pedidos de aparelho (contrato §1.2) -- pararia de agrupar sem ninguem
// perceber. Sinal que morre calado e pior que rota fora do ar: rota fora do ar
// alguem nota.
const OBRIGATORIAS = ['DATABASE_URL', 'SAL_IP_HASH'];
const faltando = () => OBRIGATORIAS.filter(n => !process.env[n]);

class ConfigIncompleta extends Error {
  constructor(ausentes) {
    super('faltam variaveis de ambiente: ' + ausentes.join(', '));
    this.name = 'ConfigIncompleta';
    this.ausentes = ausentes;
  }
}

async function montarContexto() {
  const ausentes = faltando();
  if (ausentes.length) throw new ConfigIncompleta(ausentes);

  const cripto = {
    uuid: () => crypto.randomUUID(),
    tokenAleatorio: n => crypto.randomBytes(n).toString('base64url'),
    inteiroAleatorio: n => crypto.randomInt(n),
    // Mesmo hash do servidor falso: e o que faz `credencial_publica` (gravada
    // no registro do aparelho) casar com o Bearer que ele manda depois.
    sha256: v => crypto.createHash('sha256').update(String(v)).digest('base64url')
  };

  const numero = (nome, padrao) => {
    const v = Number(process.env[nome]);
    return Number.isFinite(v) && v > 0 ? v : padrao;
  };

  const cfg = {
    // Token do piloto v2. Ausente = nenhum token legado e aceito, que e o
    // estado desejado numa origem nova (cliente v3 usa Bearer de aparelho).
    // Valor impossivel em vez de '' para nao casar com corpo sem token.
    tokenLegado: process.env.TOKEN_LEGADO || ' sem-token-legado',
    limiarAceite: Number(process.env.LIMIAR_ACEITE) || 0.45,
    consultarAposS: padrao => numero('CONSULTAR_APOS_S', padrao),
    expiraPendenteMs: numero('EXPIRA_PENDENTE_MS', 24 * 60 * 60 * 1000),
    expiraConviteMs: numero('EXPIRA_CONVITE_MS', 60 * 60 * 1000),
    origemPublica: process.env.ORIGEM_PUBLICA || '',
    cadastroJanelaMs: numero('CADASTRO_JANELA_MS', 60_000),
    cadastroLimite: numero('CADASTRO_LIMITE', 10),
    identificarJanelaMs: numero('IDENTIFICAR_JANELA_MS', 60_000),
    identificarLimite: numero('IDENTIFICAR_LIMITE', 20),
    volumeAnonimoJanelaMs: numero('VOLUME_ANONIMO_JANELA_MS', 60_000),
    volumeAnonimoLimite: numero('VOLUME_ANONIMO_LIMITE', 300),
    salIp: process.env.SAL_IP_HASH
  };

  return { repo: criarRepositorioPostgres({ connectionString: process.env.DATABASE_URL }), cripto, cfg };
}

// ---------------------------------------------------------------------------
// TABELA
// ---------------------------------------------------------------------------
// Vem de lib/rotas.js, que ja e o caminho por onde /api/saude conta as rotas.
// Uma pergunta, um caminho: saude que conta de um jeito e roteador que resolve
// de outro e como uma saude verde com roteador vazio.
async function obterRoteador() {
  const { roteador, erro } = await carregarRotas();
  if (!roteador) throw new Error(erro || 'tabela de rotas ausente');
  return roteador;
}

// ---------------------------------------------------------------------------
// ERROS DE DOMINIO -> RESPOSTA
// ---------------------------------------------------------------------------
// `NaoRevisado` (API-3 lote 2) e metodo que EXISTE e lanca de proposito, em vez
// de fingir que funciona. Ganha 501 e codigo PROPRIO: 501 nao e 404, entao o
// portao das 8 le a rota como PUBLICADA, e o codigo diz que falta
// IMPLEMENTACAO e nao CONFIGURACAO.
function mapearErro(e) {
  if (e instanceof ConfigIncompleta || e.name === 'ConfigIncompleta') {
    return { status: 503, corpo: { ok: false, erro: {
      codigo: 'CONFIG_INCOMPLETA',
      mensagem: 'a API esta sem configuracao obrigatoria',
      // NOMES de variavel, nunca valores: nome ajuda quem opera, valor vaza.
      variaveis: e.ausentes || faltando()
    } } };
  }
  if (e instanceof NaoRevisado || e.name === 'NaoRevisado') {
    return { status: 501, corpo: { ok: false, erro: {
      codigo: 'NAO_IMPLEMENTADO',
      mensagem: 'esta operacao ainda nao foi revisada nesta origem'
    } } };
  }
  if (e.name === 'RepositorioIncompleto') {
    return { status: 503, corpo: { ok: false, erro: {
      codigo: 'REPOSITORIO_INCOMPLETO',
      mensagem: 'adaptador de persistencia incompleto',
      metodos: e.faltando || []
    } } };
  }
  return null;   // desconhecido -> 503 generico, com o erro so no log
}

export default criarManipuladorVercel({
  montarContexto,
  obterRoteador,
  prefixos: PREFIXOS,
  // Injetado: esta ponte SABE como o caminho chegou (contrato do rewrite) e
  // nao precisa farejar. Devolvendo null, cai no farejador padrao -- que e o
  // que faz uma chamada direta a /api/roteador?rota=... continuar respondendo
  // durante depuracao, sem depender do rewrite estar no ar.
  resolverCaminho: resolverCaminhoDaQuery,
  origensPermitidas,
  mapearErro
});
