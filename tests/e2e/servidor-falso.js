// Servidor de teste: serve o app e finge os endpoints do n8n.
// Reproduz as regras que o servidor real aplica — idempotência por id_cliente,
// rejeição de colaborador inativo — para que o E2E valide o contrato, e não
// uma versão otimista dele.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { avaliarLoteFace } from '../../js/coerencia.js';
import { normalizarTelefone, telefonesCompartilhados } from '../../js/regras.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');


export function extrairCspDeHeaders() {
  const conteudo = fs.readFileSync(path.join(RAIZ, '_headers'), 'utf8');
  const match = conteudo.match(/Content-Security-Policy:\s*(.+)/);
  return match ? match[1].trim() : '';
}

// T-D00CE0 (docs/fase3-contrato.md §1.6 e §3.3.3): decisão de servidor sobre
// se uma marcação entra, fica retida ou é rejeitada — pura, sem estado além
// do que recebe, testável em Node. Mora aqui e não em js/regras.js de
// propósito: o cliente nunca decide isso, só lê o `status`/`motivo_codigo`
// que a rota devolve (mesmo raciocínio da coerência — número/decisão sem
// função no cliente não deve viajar no bundle).
export const JANELA_DRENAGEM_MS = 30 * 24 * 3600 * 1000;
export const TETO_RETIDAS_POS_REVOGACAO = 500;

/** null = segue o fluxo normal (aparelho ativo). Senão, {status, motivo_codigo}. */
export function resultadoPorEstadoAparelho(dispositivo, agoraMs) {
  if (!dispositivo || dispositivo.estado === 'pendente' || dispositivo.estado === 'negado') {
    return { status: 'rejeitado', motivo_codigo: 'aparelho_nunca_liberado' };
  }
  if (dispositivo.estado === 'ativo') return null;
  if (dispositivo.estado === 'revogado') {
    const desde = Date.parse(dispositivo.revogado_em);
    if (isFinite(desde) && (agoraMs - desde) > JANELA_DRENAGEM_MS) {
      return { status: 'rejeitado', motivo_codigo: 'janela_de_drenagem_encerrada' };
    }
    if ((dispositivo.retidasPosRevogacao || 0) >= TETO_RETIDAS_POS_REVOGACAO) {
      return { status: 'rejeitado', motivo_codigo: 'limite_pos_revogacao' };
    }
    return { status: 'retido', motivo_codigo: 'aparelho_revogado' };
  }
  return { status: 'rejeitado', motivo_codigo: 'aparelho_nunca_liberado' };
}

/**
 * null = segue o fluxo normal (pessoa ativa e conhecida). `pessoa` precisa
 * trazer `.ativo` e `.inativado_em` já resolvidos — a função não sabe de
 * `estado.inativos`, só decide a partir do que recebe.
 */
export function resultadoPorEstadoPessoa(pessoa, marcadoEmIso) {
  if (!pessoa) return { status: 'rejeitado', motivo_codigo: 'pessoa_desconhecida' };
  if (pessoa.ativo === false) {
    const inativadoEm = Date.parse(pessoa.inativado_em);
    const marcadoEm = Date.parse(marcadoEmIso);
    if (isFinite(inativadoEm) && isFinite(marcadoEm) && marcadoEm < inativadoEm) {
      return { status: 'retido', motivo_codigo: 'pessoa_inativa_no_envio' };
    }
    return { status: 'rejeitado', motivo_codigo: 'pessoa_inativa' };
  }
  return null;
}

// Frase de gente pra cada motivo_codigo — o cliente escolhe por código
// (§1.6), isto aqui é só o texto que a rota falsa devolve pronto, igual o
// servidor real faria.
export const FRASES_MOTIVO = {
  aparelho_revogado: 'Aparelho revogado: o RH vai conferir esta marcação.',
  janela_de_drenagem_encerrada: 'Aparelho revogado há mais de 30 dias: este ponto não é mais aceito.',
  limite_pos_revogacao: 'Muitas marcações deste aparelho depois da revogação: este ponto não é mais aceito.',
  aparelho_nunca_liberado: 'Este aparelho nunca foi liberado pelo RH.',
  pessoa_inativa_no_envio: 'Colaborador foi inativado depois desta marcação: o RH vai conferir.',
  pessoa_inativa: 'Colaborador está inativo: este ponto não é aceito.',
  pessoa_desconhecida: 'Colaborador não encontrado no cadastro.'
};

// _headers e a fonte unica da politica de borda. A CSP ja vinha de la; cache
// tambem tem de vir, senao o E2E valida um cache que nao existe em producao —
// o caso que importa e a pagina publica de uso unico, que nao pode ser servida
// de cache velho.
function blocosDeHeaders() {
  const blocos = [];
  let atual = null;
  for (const linha of fs.readFileSync(path.join(RAIZ, '_headers'), 'utf8').split('\n')) {
    if (!linha.trim() || linha.trim().startsWith('#')) continue;
    if (!/^\s/.test(linha)) { atual = { padrao: linha.trim(), headers: {} }; blocos.push(atual); continue; }
    const sep = linha.indexOf(':');
    if (atual && sep > 0) atual.headers[linha.slice(0, sep).trim()] = linha.slice(sep + 1).trim();
  }
  return blocos;
}

// Todo bloco que casa e aplicado na ordem do arquivo: o mais especifico vem
// depois e sobrescreve, igual a Vercel.
export function headersPara(pathname) {
  const saida = {};
  for (const bloco of blocosDeHeaders()) {
    const re = new RegExp('^' + bloco.padrao.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    if (re.test(pathname)) Object.assign(saida, bloco.headers);
  }
  return saida;
}

// T-B1D7F6: este servidor e de teste, e servidor de teste nunca pode entregar o
// app apontando para producao — registro de aparelho e marcacao de ponto sao
// efeitos colaterais reais e irreversiveis. npm run serve fazia exatamente isso.
// Prepend, nao append: js/config.js faz Object.assign(padroes, window.EFRAT_CFG),
// entao o que ja estiver definido vence. Assim o override que os specs injetam
// por addInitScript continua ganhando — inclusive a apiBase morta de proposito
// em acesso.spec.js, que testa o app sem servidor.
function configLocal(base) {
  return 'window.EFRAT_CFG = Object.assign({ apiBase: ' + JSON.stringify(base + '/webhook') +
    ' }, window.EFRAT_CFG || {});\n';
}

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.bin': 'application/octet-stream', '.css': 'text/css'
};

// Mesma semente do modo fingido em js/face.js — assim o descritor gerado no
// navegador casa exatamente com o template que a carga entrega.
export function vetorDe(semente) {
  const v = new Array(128).fill(0);
  const s = String(semente);
  for (let i = 0; i < 128; i++) v[i] = ((s.charCodeAt(i % s.length) * (i + 7)) % 100) / 100;
  return v;
}

export function semearMarcacao(estado, marcacao) {
  if (!marcacao || !marcacao.id_cliente) throw new Error('seed de marcacao exige id_cliente');
  estado.marcacoes.set(marcacao.id_cliente, Object.assign({}, marcacao));
  return estado.marcacoes.get(marcacao.id_cliente);
}

export function semearPendencia(estado, pendencia) {
  if (!pendencia) throw new Error('seed de pendencia obrigatorio');
  if (pendencia.id_cliente) {
    return semearMarcacao(estado, Object.assign({ requer_revisao: true }, pendencia));
  }
  estado.correcoes.push(Object.assign({ estado: 'pendente_rh' }, pendencia));
  return estado.correcoes.at(-1);
}

export function semearRecadastro(estado, recadastro) {
  if (!recadastro || !recadastro.template_id) throw new Error('seed de recadastro exige template_id');
  estado.recadastros.push(Object.assign({ versao: 1 }, recadastro));
  return estado.recadastros.at(-1);
}

export function criarServidor(opts = {}) {
  // Fonte única do limiar de aceite (docs/fase3-seguranca.md § 4.2c) — o mesmo
  // valor que js/config.js define como cfg.limiarAceite. Configurável só para
  // os testes provarem que mudar a config muda o veredito, sem duplicar 0,45.
  const limiarAceiteCadastro = opts.limiarAceite != null ? opts.limiarAceite : 0.45;
  const estado = {
    token: opts.token || 'TOKEN-TESTE',
    marcacoes: new Map(),      // id_cliente -> marcação
    inativos: new Set(opts.inativos || []),
    fora: false,               // simula servidor inacessível
    chamadas: { carga: 0, marcacoes: 0, cadastro: 0, rh: 0, registrar: 0, estado: 0, identificar: 0 },
    dispositivos: new Map(),
    codigosPendentes: new Map(),
    sessoesGestor: new Map(),
    correcoes: [],
    auditoriaIdentificacao: [],
    limitesIdentificacao: new Map(),
    limitesCadastro: new Map(),
    tokenLegadoConsumido: false,
    idempotencia: new Map(),
    recadastros: [],
    equipesCriadas: [],
    colaboradoresCriados: [],
    decisoes: [],
    lotesSimultaneos: 0,
    maxLotesSimultaneos: 0,
    // T-8188C6: equipe real, não mais hardcoded no corpo de /rh/dados —
    // senão criar/inativar equipe não tem onde persistir (docs/fase3-contrato.md §2.3).
    equipes: new Map([
      ['eq-1', { equipe_id: 'eq-1', nome: 'Equipe Um', unidade: 'Unidade A', ativo: true }],
      ['eq-2', { equipe_id: 'eq-2', nome: 'Equipe Dois', unidade: 'Unidade A', ativo: true }]
    ])
  };

  for (const marcacao of (opts.marcacoes || [])) semearMarcacao(estado, marcacao);
  for (const pendencia of (opts.pendencias || [])) semearPendencia(estado, pendencia);
  for (const recadastro of (opts.recadastros || [])) semearRecadastro(estado, recadastro);

  const rhUsuario = opts.rhUsuario || {
    usuario: 'rh', nome: 'RH Teste',
    sal: '00112233445566778899aabbccddeeff',
    chave: 'CHAVE-DE-TESTE', iteracoes: 1, ativo: true
  };

  const pessoas = (opts.pessoas || [
    { pessoa_id: 'p-ana', nome: 'Ana Souza', matricula: '001', equipe_id: 'eq-1', papel: 'colaborador' },
    { pessoa_id: 'p-bruno', nome: 'Bruno Lima', matricula: '002', equipe_id: 'eq-1', papel: 'colaborador' },
    { pessoa_id: 'p-carla', nome: 'Carla Dias', matricula: '003', equipe_id: 'eq-2', papel: 'colaborador' },
    { pessoa_id: 'p-gestor', nome: 'Gestor Piloto', matricula: 'G01', equipe_id: 'eq-1', papel: 'gestor' }
  ]).map(p => Object.assign({
    versao: 1, vetores: [vetorDe(p.pessoa_id)], miniatura: '',
    // T-8188C6: telefone vazio é tolerado na leitura (§3.1, "sem migração de
    // dados") — só passa a ser exigido na escrita, então o piloto antigo continua
    // legível sem backfill.
    telefone: '', versao_cadastro: 1,
    telefone_autorizado_por: null, telefone_autorizado_em: null, telefone_autorizacao_motivo: null,
    inativado_em: null, inativado_por: null, motivo_inativacao: null
  }, p));

  const alfabetoCodigo = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const requestId = () => crypto.randomUUID();
  const erro = (codigo, mensagem, campo) => ({
    ok: false, erro: Object.assign({ codigo, mensagem }, campo ? { campo } : {}),
    request_id: requestId()
  });
  const bearer = req => {
    const valor = String(req.headers.authorization || '');
    return valor.startsWith('Bearer ') ? valor.slice(7) : '';
  };
  const hashCredencial = valor => crypto.createHash('sha256').update(String(valor)).digest('base64url');
  const codigoAleatorio = () => {
    let codigo = '';
    for (let i = 0; i < 6; i++) codigo += alfabetoCodigo[crypto.randomInt(alfabetoCodigo.length)];
    return codigo;
  };
  // T-87615C: código pendente não fica prova de posse válida pra sempre —
  // depois de 24h o aparelho recebe um novo na próxima consulta de estado
  // (mostrarAparelhosCodigoExpirado) e o antigo para de resolver no /rh/aparelho.
  const EXPIRA_PENDENTE_MS = opts.expiraPendenteMs || 24 * 60 * 60 * 1000;
  const codigoExpirado = dispositivo =>
    !dispositivo.criado_em || (Date.now() - Date.parse(dispositivo.criado_em)) > EXPIRA_PENDENTE_MS;
  const novoCodigoUnico = () => {
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      const codigo = codigoAleatorio();
      if (!estado.codigosPendentes.has(codigo)) return codigo;
    }
    return null;
  };
  // Toda chamada autenticada de aparelho conta como "uso" — é o que a aba
  // Aparelhos do RH mostra como "último uso" nos aprovados (T-87615C).
  const dispositivoAutenticado = (req, dispositivoId) => {
    const dispositivo = estado.dispositivos.get(dispositivoId);
    const credencial = bearer(req);
    if (!dispositivo || !credencial || dispositivo.credencial_hash !== hashCredencial(credencial)) return null;
    dispositivo.ultimo_uso = new Date().toISOString();
    return dispositivo;
  };

  // C1-C3 do contrato (fase3-contrato.md §0): chave de idempotência no CORPO
  // pras rotas /efrat/rh/* (credencial já é corpo). Mesma chave + mesmo corpo
  // repete a resposta gravada; mesma chave + corpo diferente é conflito.
  // Só as rotas NOVAS de escrita exigem a chave (C2) — por isso quem chama
  // decide se `obrigatoria` é true.
  const idempotente = (chave, corpo, obrigatoria) => {
    if (!chave) {
      if (obrigatoria) return { bloqueado: { status: 400, resposta: erro('IDEMPOTENCIA_AUSENTE', 'chave de idempotência obrigatória') } };
      return { hash: null };
    }
    const hash = hashCredencial(JSON.stringify(corpo));
    const anterior = estado.idempotencia.get(chave);
    if (anterior && anterior.hash !== hash) {
      return { bloqueado: { status: 409, resposta: erro('IDEMPOTENCIA_CONFLITANTE', 'chave reutilizada com outro corpo') } };
    }
    if (anterior) return { cache: anterior };
    return { hash };
  };
  const gravarIdempotencia = (chave, hash, status, resposta) => {
    if (chave && hash) estado.idempotencia.set(chave, { hash, status, resposta });
  };

  // T-8188C6: forma pública de uma pessoa, para corpo de erro (CADASTRO_DESATUALIZADO)
  // e pra base do cálculo de telefone_compartilhado — a mesma forma que /rh/dados devolve.
  const pessoaParaResposta = p => ({
    pessoa_id: p.pessoa_id, matricula: p.matricula, nome: p.nome,
    equipe_id: p.equipe_id, papel: p.papel, ativo: !estado.inativos.has(p.pessoa_id),
    telefone: p.telefone || '', versao_cadastro: p.versao_cadastro,
    tem_biometria: !!(p.vetores && p.vetores.length)
  });

  /**
   * Normaliza e valida telefone (js/regras.js, compartilhado com o cliente);
   * se colide com pessoa ativa diferente, exige autorizar_telefone_duplicado +
   * motivo de 10-200 chars (§3.1). `pessoaIdAtual` exclui a própria pessoa da
   * checagem de colisão (edição/reativação não colide consigo mesma).
   */
  const validarTelefoneOuDuplicado = (corpo, pessoaIdAtual) => {
    const r = normalizarTelefone(corpo.telefone);
    if (!r.ok) return { ok: false, status: 422, corpo: erro(r.codigo, r.mensagem, r.campo) };
    const outra = pessoas.find(p => p.pessoa_id !== pessoaIdAtual && p.telefone === r.e164 && !estado.inativos.has(p.pessoa_id));
    if (!outra) return { ok: true, e164: r.e164, autorizacao: null };
    if (corpo.autorizar_telefone_duplicado === true) {
      const motivo = String(corpo.motivo_telefone_duplicado || '').trim();
      if (motivo.length < 10 || motivo.length > 200) {
        return { ok: false, status: 422, corpo: erro('MOTIVO_INVALIDO', 'o motivo precisa ter entre 10 e 200 caracteres', 'motivo_telefone_duplicado') };
      }
      return {
        ok: true, e164: r.e164,
        autorizacao: {
          telefone_autorizado_por: rhUsuario.usuario, telefone_autorizado_em: new Date().toISOString(),
          telefone_autorizacao_motivo: motivo
        }
      };
    }
    return {
      ok: false, status: 409,
      corpo: Object.assign(erro('TELEFONE_DUPLICADO', 'esse telefone já é de ' + outra.nome, 'telefone'),
        { pessoa_id: outra.pessoa_id, nome: outra.nome })
    };
  };

  const distancia = (a, b) => Math.sqrt(a.reduce((soma, valor, i) => {
    const delta = valor - b[i];
    return soma + delta * delta;
  }, 0));
  const sessaoGestorValida = req => {
    const sessao = estado.sessoesGestor.get(bearer(req));
    const agora = Date.now();
    if (!sessao || agora >= sessao.expira_absoluto || agora - sessao.ultima_atividade >= 5 * 60_000) return null;
    sessao.ultima_atividade = agora;
    return sessao;
  };

  function carga() {
    const fim = new Date(); fim.setHours(23, 59, 59, 0);
    return {
      ok: true,
      gestor: { id: 'p-gestor', nome: 'Gestor Piloto' },
      equipes: [
        { equipe_id: 'eq-1', nome: 'Equipe Um', unidade: 'Unidade A', lat: 0, lng: 0, raio_m: 500, minha: true },
        { equipe_id: 'eq-2', nome: 'Equipe Dois', unidade: 'Unidade A', lat: 0, lng: 0, raio_m: 500, minha: false }
      ],
      pessoas: pessoas.filter(p => !estado.inativos.has(p.pessoa_id)),
      sem_cadastro: [{ pessoa_id: 'p-novo', nome: 'Novato Sem Face', matricula: '009', equipe_id: 'eq-1' }],
      servidor_hora: new Date().toISOString(),
      expira_em: fim.toISOString()
    };
  }

  const servidor = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const responder = (cod, obj) => {
      res.writeHead(cod, {
        'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key'
      });
      res.end(JSON.stringify(obj));
    };

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
      });
      res.end();
      return;
    }

    if (url.pathname.startsWith('/webhook/')) {
      if (estado.fora) { res.destroy(); return; }
      let corpo = '';
      for await (const c of req) corpo += c;
      let body = {};
      try { body = corpo ? JSON.parse(corpo) : {}; } catch (e) { /* body vazio */ }

      const rotaRegistrar = url.pathname === '/webhook/efrat/dispositivo/registrar';
      const rotaEstado = url.pathname === '/webhook/efrat/dispositivo/estado';
      const rotaV3Autenticada = rotaEstado
        || url.pathname === '/webhook/efrat/identificar'
        || url.pathname.startsWith('/webhook/efrat/gestor/');
      // RH conserva usuario + chave nesta rodada. Rotas v3 usam bearer proprio.
      const ehRh = url.pathname.startsWith('/webhook/efrat/rh/');
      if (!ehRh && !rotaRegistrar && !rotaV3Autenticada) {
        const token = body.token || url.searchParams.get('token');
        const dispositivo = body.dispositivo_id && dispositivoAutenticado(req, body.dispositivo_id);
        if (token !== estado.token && !dispositivo) {
          // Compatibilidade do piloto: o cliente v2 ainda espera `erro` textual.
          if (token) return responder(401, { ok: false, erro: 'token invalido' });
          return responder(401, erro('CREDENCIAL_INVALIDA', 'credencial invalida'));
        }
      }

      if (rotaRegistrar) {
        estado.chamadas.registrar++;
        const agora = Date.now();
        const ip = req.socket.remoteAddress || 'desconhecido';
        const janelaMs = opts.cadastroJanelaMs || 60_000;
        const limite = opts.cadastroLimite || 10;
        let contador = estado.limitesCadastro.get(ip);
        if (!contador || agora - contador.inicio >= janelaMs) contador = { inicio: agora, total: 0 };
        contador.total++;
        estado.limitesCadastro.set(ip, contador);
        if (contador.total > limite) {
          res.setHeader('Retry-After', String(Math.max(1, Math.ceil((janelaMs - (agora - contador.inicio)) / 1000))));
          return responder(429, erro('LIMITE_CADASTRO', 'limite de cadastro excedido'));
        }
        if (!body.dispositivo_id || !body.credencial_publica || !body.apelido || !body.ua) {
          return responder(400, erro('CORPO_INVALIDO', 'campos obrigatorios ausentes'));
        }
        const tokenLegado = bearer(req);
        if (tokenLegado) {
          if (tokenLegado !== estado.token) {
            return responder(401, erro('TOKEN_LEGADO_INVALIDO', 'token legado invalido'));
          }
          if (estado.tokenLegadoConsumido) {
            return responder(409, erro('TOKEN_LEGADO_CONSUMIDO', 'token legado ja migrado'));
          }
          const migrado = {
            dispositivo_id: body.dispositivo_id, credencial_hash: body.credencial_publica,
            estado: 'ativo', codigo_curto: null, apelido: body.apelido, ua: body.ua,
            geo: body.geo || null, tentativas: 1, local_id: 'local-piloto',
            equipes_ids: ['eq-1'], configuracao_versao: 1,
            aprovado_por: 'migracao-v3', aprovado_em: new Date().toISOString(),
            criado_em: new Date().toISOString(), ultimo_uso: null
          };
          estado.dispositivos.set(body.dispositivo_id, migrado);
          estado.tokenLegadoConsumido = true;
          return responder(200, {
            ok: true, estado: 'ativo', migrado: true,
            dispositivo_id: body.dispositivo_id, request_id: requestId()
          });
        }
        const existente = estado.dispositivos.get(body.dispositivo_id);
        if (existente) {
          if (existente.credencial_hash !== body.credencial_publica) {
            return responder(409, erro('DISPOSITIVO_CONFLITO', 'dispositivo ja cadastrado'));
          }
          return responder(202, {
            ok: true, estado: existente.estado, dispositivo_id: body.dispositivo_id,
            codigo_curto: existente.codigo_curto, consultar_apos_s: 10, request_id: requestId()
          });
        }
        const codigo = novoCodigoUnico();
        if (!codigo) return responder(503, erro('CODIGO_INDISPONIVEL', 'nao foi possivel gerar codigo'));
        const dispositivo = {
          dispositivo_id: body.dispositivo_id, credencial_hash: body.credencial_publica,
          estado: 'pendente', codigo_curto: codigo, apelido: body.apelido, ua: body.ua,
          geo: body.geo || null, tentativas: 1, local_id: null, equipes_ids: [],
          configuracao_versao: 0, aprovado_por: null, aprovado_em: null,
          criado_em: new Date().toISOString(), ultimo_uso: null
        };
        estado.dispositivos.set(body.dispositivo_id, dispositivo);
        estado.codigosPendentes.set(codigo, body.dispositivo_id);
        return responder(202, {
          ok: true, estado: 'pendente', dispositivo_id: body.dispositivo_id,
          codigo_curto: codigo, consultar_apos_s: 10, request_id: requestId()
        });
      }

      if (rotaEstado) {
        estado.chamadas.estado++;
        const dispositivo = dispositivoAutenticado(req, body.dispositivo_id);
        if (!dispositivo) return responder(401, erro('CREDENCIAL_INVALIDA', 'credencial invalida'));
        if (dispositivo.estado === 'pendente') {
          if (codigoExpirado(dispositivo)) {
            estado.codigosPendentes.delete(dispositivo.codigo_curto);
            const novo = novoCodigoUnico();
            if (novo) {
              dispositivo.codigo_curto = novo;
              dispositivo.criado_em = new Date().toISOString();
              estado.codigosPendentes.set(novo, dispositivo.dispositivo_id);
            }
          }
          return responder(200, {
            ok: true, estado: 'pendente', codigo_curto: dispositivo.codigo_curto,
            consultar_apos_s: 15, request_id: requestId()
          });
        }
        if (dispositivo.estado !== 'ativo') {
          return responder(200, { ok: true, estado: dispositivo.estado, request_id: requestId() });
        }
        return responder(200, {
          ok: true, estado: 'ativo',
          dispositivo: {
            dispositivo_id: dispositivo.dispositivo_id, apelido: dispositivo.apelido,
            equipes_ids: dispositivo.equipes_ids,
            configuracao_versao: dispositivo.configuracao_versao
          },
          request_id: requestId()
        });
      }

      if (url.pathname === '/webhook/efrat/carga') {
        estado.chamadas.carga++;
        if (body.dispositivo_id) {
          const dispositivo = dispositivoAutenticado(req, body.dispositivo_id);
          if (!dispositivo) return responder(401, erro('CREDENCIAL_INVALIDA', 'credencial invalida'));
          if (dispositivo.estado === 'pendente') {
            return responder(403, erro('DISPOSITIVO_PENDENTE', 'dispositivo aguarda aprovacao'));
          }
          if (dispositivo.estado !== 'ativo') {
            return responder(403, erro('DISPOSITIVO_INATIVO', 'dispositivo inativo'));
          }
          if (!dispositivo.equipes_ids.length) {
            return responder(403, erro('DISPOSITIVO_SEM_ESCOPO', 'dispositivo sem equipes'));
          }
          return responder(200, {
            ok: true, versao: dispositivo.configuracao_versao,
            gerado_em: new Date().toISOString(),
            escopo: { equipes_ids: [...dispositivo.equipes_ids] },
            pessoas: pessoas
              .filter(p => !estado.inativos.has(p.pessoa_id) && dispositivo.equipes_ids.includes(p.equipe_id))
              .map(p => ({
                pessoa_id: p.pessoa_id, nome: p.nome, equipe_id: p.equipe_id, papel: p.papel,
                template: { versao: p.versao, vetores: p.vetores }, miniatura: p.miniatura
              })),
            removidos_ids: [], request_id: requestId()
          });
        }
        return responder(200, carga());
      }

      if (url.pathname === '/webhook/efrat/identificar') {
        estado.chamadas.identificar++;
        const dispositivo = dispositivoAutenticado(req, body.dispositivo_id);
        if (!dispositivo) return responder(401, erro('CREDENCIAL_INVALIDA', 'credencial invalida'));
        if (dispositivo.estado !== 'ativo') {
          return responder(403, erro('DISPOSITIVO_INATIVO', 'dispositivo inativo'));
        }
        if (!Array.isArray(body.descritor) || body.descritor.length !== 128
            || body.descritor.some(v => !Number.isFinite(v))) {
          return responder(400, erro('DESCRITOR_INVALIDO', 'descritor invalido', 'descritor'));
        }
        const janelaMs = opts.identificarJanelaMs || 60_000;
        const limite = opts.identificarLimite || 20;
        const agora = Date.now();
        let contador = estado.limitesIdentificacao.get(dispositivo.dispositivo_id);
        if (!contador || agora - contador.inicio >= janelaMs) contador = { inicio: agora, total: 0 };
        contador.total++;
        estado.limitesIdentificacao.set(dispositivo.dispositivo_id, contador);
        if (contador.total > limite) {
          const retryAfter = Math.max(1, Math.ceil((janelaMs - (agora - contador.inicio)) / 1000));
          res.setHeader('Retry-After', String(retryAfter));
          estado.auditoriaIdentificacao.push({
            dispositivo_id: dispositivo.dispositivo_id, instante: new Date().toISOString(),
            resultado: 'limitado', request_id: requestId()
          });
          return responder(429, erro('LIMITE_IDENTIFICACAO', 'limite de identificacao excedido'));
        }
        const candidatos = pessoas.filter(p => !estado.inativos.has(p.pessoa_id));
        const ranking = candidatos
          .map(p => ({ pessoa: p, distancia: Math.min(...p.vetores.map(v => distancia(body.descritor, v))) }))
          .sort((a, b) => a.distancia - b.distancia);
        const melhor = ranking[0];
        const reconhecido = melhor && melhor.distancia < 0.45;
        const auditoria = {
          dispositivo_id: dispositivo.dispositivo_id, instante: new Date().toISOString(),
          resultado: reconhecido ? 'reconhecido' : 'nao_reconhecido',
          pessoa_id: reconhecido ? melhor.pessoa.pessoa_id : undefined, request_id: requestId()
        };
        estado.auditoriaIdentificacao.push(auditoria);
        if (!reconhecido) {
          return responder(200, { ok: true, resultado: 'nao_reconhecido', request_id: auditoria.request_id });
        }
        const pessoa = melhor.pessoa;
        const resposta = {
          ok: true, resultado: 'reconhecido',
          pessoa: {
            pessoa_id: pessoa.pessoa_id, nome: pessoa.nome,
            equipe_id: pessoa.equipe_id, papel: pessoa.papel
          },
          distancia: melhor.distancia,
          pode_registrar: true,
          fora_do_escopo_offline: !dispositivo.equipes_ids.includes(pessoa.equipe_id),
          request_id: auditoria.request_id
        };
        if (pessoa.papel === 'gestor' && melhor.distancia < 0.45) {
          const tokenSessao = crypto.randomBytes(32).toString('base64url');
          estado.sessoesGestor.set(tokenSessao, {
            gestor_id: pessoa.pessoa_id, dispositivo_id: dispositivo.dispositivo_id,
            equipes_ids: [pessoa.equipe_id], criado_em: agora, ultima_atividade: agora,
            expira_absoluto: agora + 10 * 60_000, evento: auditoria.request_id
          });
          resposta.sessao_gestor = tokenSessao;
          resposta.sessao_expira_em = new Date(agora + 10 * 60_000).toISOString();
        }
        return responder(200, resposta);
      }

      if (url.pathname === '/webhook/efrat/gestor/equipe-hoje') {
        const sessao = sessaoGestorValida(req);
        if (!sessao) return responder(401, erro('SESSAO_EXPIRADA', 'sessao expirada'));
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.data_local || ''))) {
          return responder(400, erro('DATA_INVALIDA', 'data local invalida', 'data_local'));
        }
        const equipe = pessoas.filter(p => sessao.equipes_ids.includes(p.equipe_id)
          && !estado.inativos.has(p.pessoa_id));
        const itens = equipe.map(p => {
          const doDia = [...estado.marcacoes.values()]
            .filter(m => m.pessoa_id === p.pessoa_id && String(m.marcado_em).slice(0, 10) === body.data_local)
            .sort((a, b) => String(a.marcado_em).localeCompare(String(b.marcado_em)));
          const ultima = doDia.at(-1);
          const estadoPessoa = !ultima ? 'ausente' : ultima.tipo === 'intervalo' ? 'em_intervalo' : 'em_jornada';
          return {
            pessoa_id: p.pessoa_id, nome: p.nome, equipe_id: p.equipe_id, estado: estadoPessoa,
            ultima_marcacao: ultima ? { tipo: ultima.tipo, em: ultima.marcado_em } : null
          };
        });
        const conta = nome => itens.filter(p => p.estado === nome).length;
        return responder(200, {
          ok: true, data_local: body.data_local, equipes_ids: [...sessao.equipes_ids],
          resumo: {
            em_jornada: conta('em_jornada'), em_intervalo: conta('em_intervalo'),
            ausentes: conta('ausente')
          },
          pessoas: itens, request_id: requestId()
        });
      }

      if (url.pathname === '/webhook/efrat/gestor/ajustar') {
        const sessao = sessaoGestorValida(req);
        if (!sessao) return responder(401, erro('SESSAO_EXPIRADA', 'sessao expirada'));
        const pessoa = pessoas.find(p => p.pessoa_id === body.pessoa_id && !estado.inativos.has(p.pessoa_id));
        if (!pessoa || !sessao.equipes_ids.includes(pessoa.equipe_id)) {
          return responder(403, erro('PESSOA_FORA_DO_ESCOPO', 'pessoa fora do escopo'));
        }
        const idempotencyKey = req.headers['idempotency-key'];
        if (!idempotencyKey) return responder(400, erro('IDEMPOTENCIA_AUSENTE', 'Idempotency-Key obrigatoria'));
        const hashRequisicao = hashCredencial(JSON.stringify(body));
        const anterior = estado.idempotencia.get(idempotencyKey);
        if (anterior && anterior.hash !== hashRequisicao) {
          return responder(409, erro('IDEMPOTENCIA_CONFLITANTE', 'chave reutilizada com outro corpo'));
        }
        if (anterior) return responder(anterior.status, anterior.resposta);
        if (!['incluir_marcacao', 'alterar_marcacao', 'excluir_marcacao'].includes(body.acao)
            || String(body.motivo || '').trim().length < 10) {
          return responder(422, erro('AJUSTE_INVALIDO', 'ajuste invalido'));
        }
        if (body.acao !== 'incluir_marcacao' && !estado.marcacoes.has(body.marcacao_id)) {
          return responder(404, erro('MARCACAO_NAO_ENCONTRADA', 'marcacao nao encontrada'));
        }
        const correcao = {
          correcao_id: 'corr-' + crypto.randomUUID(), estado: 'pendente_rh',
          pessoa_id: pessoa.pessoa_id, marcacao_id: body.marcacao_id || null,
          valor_anterior: body.marcacao_id ? estado.marcacoes.get(body.marcacao_id) : null,
          valor_proposto: body.marcacao || null, motivo: body.motivo,
          autor_id: sessao.gestor_id, sessao_evento: sessao.evento,
          criado_em: new Date().toISOString()
        };
        estado.correcoes.push(correcao);
        const resposta = {
          ok: true, estado: 'pendente_rh', correcao_id: correcao.correcao_id,
          criado_em: correcao.criado_em, request_id: requestId()
        };
        estado.idempotencia.set(idempotencyKey, { hash: hashRequisicao, status: 202, resposta });
        return responder(202, resposta);
      }

      if (url.pathname === '/webhook/efrat/marcacoes') {
        estado.chamadas.marcacoes++;
        estado.lotesSimultaneos++;
        estado.maxLotesSimultaneos = Math.max(estado.maxLotesSimultaneos, estado.lotesSimultaneos);
        await new Promise(r => setTimeout(r, opts.latenciaMs || 60));

        // T-D00CE0 (§1.6): /efrat/marcacoes NUNCA responde 403 por estado de
        // aparelho — sempre 200 item a item, que é o único formato em que o
        // cliente consegue soltar da fila o que já foi resolvido. O gate
        // genérico lá em cima (linha ~319) já garantiu que a credencial
        // resolve para ALGUM aparelho conhecido (ou 401 antes de chegar
        // aqui); aqui só falta olhar o ESTADO desse aparelho.
        const dispositivoDoLote = estado.dispositivos.get(body.dispositivo_id);
        const agoraMs = Date.now();
        const agoraIso = new Date(agoraMs).toISOString();
        const resultados = [];
        for (const m of (body.marcacoes || [])) {
          if (!m || !m.id_cliente || !m.pessoa_id || !m.marcado_em) {
            resultados.push({ id_cliente: m && m.id_cliente, status: 'rejeitado', motivo: 'campos obrigatorios ausentes' });
            continue;
          }
          if (estado.marcacoes.has(m.id_cliente)) {
            resultados.push({ id_cliente: m.id_cliente, status: 'duplicado', motivo: null });
            continue;
          }

          const porAparelho = resultadoPorEstadoAparelho(dispositivoDoLote, agoraMs);
          if (porAparelho) {
            const item = Object.assign({}, m, {
              requer_revisao: true,
              recebido_em: agoraIso,
              aparelho_estado_no_envio: dispositivoDoLote ? dispositivoDoLote.estado : 'desconhecido',
              aparelho_revogado_em: dispositivoDoLote ? (dispositivoDoLote.revogado_em || null) : null,
              aparelho_apelido: dispositivoDoLote ? dispositivoDoLote.apelido : null,
              aparelho_dispositivo_id: body.dispositivo_id || null,
              motivo_codigo: porAparelho.motivo_codigo
            });
            if (porAparelho.status === 'retido') {
              estado.marcacoes.set(m.id_cliente, item);
              if (dispositivoDoLote) {
                dispositivoDoLote.retidasPosRevogacao = (dispositivoDoLote.retidasPosRevogacao || 0) + 1;
              }
            }
            resultados.push({
              id_cliente: m.id_cliente, status: porAparelho.status,
              motivo_codigo: porAparelho.motivo_codigo, motivo: FRASES_MOTIVO[porAparelho.motivo_codigo]
            });
            continue;
          }

          const pessoa = pessoas.find(p => p.pessoa_id === m.pessoa_id);
          const pessoaComEstado = pessoa ? Object.assign({}, pessoa, { ativo: !estado.inativos.has(pessoa.pessoa_id) }) : null;
          const porPessoa = resultadoPorEstadoPessoa(pessoaComEstado, m.marcado_em);
          if (porPessoa) {
            const item = Object.assign({}, m, {
              requer_revisao: true, recebido_em: agoraIso, motivo_codigo: porPessoa.motivo_codigo
            });
            if (porPessoa.status === 'retido') estado.marcacoes.set(m.id_cliente, item);
            resultados.push({
              id_cliente: m.id_cliente, status: porPessoa.status,
              motivo_codigo: porPessoa.motivo_codigo, motivo: FRASES_MOTIVO[porPessoa.motivo_codigo]
            });
            continue;
          }

          // Mesma regra do workflow real: gestor, manual, veredito diferente
          // de aceito ou relogio fora de 2 min vao para a mesa do RH.
          const deriva = m.deriva_relogio_ms == null ? 0 : Number(m.deriva_relogio_ms);
          const revisar = m.veredito !== 'aceito' || m.origem === 'manual'
            || (pessoa && pessoa.papel === 'gestor') || Math.abs(deriva) > 120000;
          estado.marcacoes.set(m.id_cliente, Object.assign({}, m, {
            requer_revisao: !!revisar,
            foto_auditoria: revisar ? (m.foto_auditoria || '') : ''
          }));
          resultados.push({ id_cliente: m.id_cliente, status: 'aceito', motivo: null });
        }
        estado.lotesSimultaneos--;
        const conta = s => resultados.filter(x => x.status === s).length;
        return responder(200, {
          ok: true, servidor_hora: agoraIso,
          resumo: {
            aceitas: conta('aceito'), duplicadas: conta('duplicado'),
            retidas: conta('retido'), rejeitadas: conta('rejeitado')
          },
          resultados
        });
      }

      if (url.pathname === '/webhook/efrat/rh/sal') {
        return responder(200, { ok: true, sal: rhUsuario.sal, iteracoes: rhUsuario.iteracoes });
      }

      if (url.pathname.startsWith('/webhook/efrat/rh/')) {
        if (body.usuario !== rhUsuario.usuario || body.chave !== rhUsuario.chave) {
          return responder(401, { ok: false, erro: 'usuario ou senha invalidos' });
        }
        estado.chamadas.rh = (estado.chamadas.rh || 0) + 1;

        if (url.pathname.endsWith('/dados')) {
          const marcs = [...estado.marcacoes.values()].map(m => Object.assign({}, m, {
            pendente: !!m.requer_revisao,
            requer_revisao: !!m.requer_revisao,
            marcado_dia: String(m.marcado_em).slice(0, 10)
          }));
          // T-8188C6: telefone_compartilhado é derivado na leitura (§3.1),
          // nunca gravado — calcula sobre a lista completa de pessoas ativas
          // antes de montar a resposta.
          const pessoasBase = pessoas.map(p => ({
            pessoa_id: p.pessoa_id, matricula: p.matricula, nome: p.nome,
            equipe_id: p.equipe_id, papel: p.papel, ativo: !estado.inativos.has(p.pessoa_id),
            telefone: p.telefone || '', versao_cadastro: p.versao_cadastro,
            equipes_geridas: '', tem_biometria: !!(p.vetores && p.vetores.length), miniatura: p.miniatura || null
          }));
          const compartilhados = telefonesCompartilhados(pessoasBase);
          return responder(200, {
            ok: true, usuario: { usuario: rhUsuario.usuario, nome: rhUsuario.nome },
            periodo_dias: body.dias || 30,
            equipes: [...estado.equipes.values()].map(e => Object.assign({}, e)),
            pessoas: pessoasBase.map(p => Object.assign({}, p, {
              telefone_compartilhado: !!compartilhados[p.pessoa_id],
              telefone_compartilhado_com: compartilhados[p.pessoa_id] || []
            })),
            marcacoes: marcs,
            // O decimal de coerência NUNCA sai daqui, de propósito (correção do
            // Orquestrador sobre T-8ADD9C/js/rh.js): a faixa aceita (abaixo de
            // 0,45) é ocupada por variação legítima de adorno (capacete, boné,
            // máscara) até encostar no limiar — não há corte dentro dela que
            // sirva de sinal, então não vira nem número nem booleano, só some.
            // O valor cru continua persistido e volta nas rotas de ESCRITA
            // (auditoria/recalibração) — só a leitura de /rh/dados o esconde.
            recadastros: estado.recadastros.map(t => {
              const { coerencia, ...semCoerencia } = t;
              return semCoerencia;
            }),
            // Aba Aparelhos (T-87615C): codigo_curto NUNCA sai daqui — é prova
            // de posse física do aparelho. Se aparecesse numa leitura do RH,
            // deixaria de provar que alguém está olhando a tela de verdade e
            // viraria só enfeite; quem aprova tem que digitar o código lido lá.
            dispositivos: [...estado.dispositivos.values()].map(d => ({
              dispositivo_id: d.dispositivo_id, apelido: d.apelido, estado: d.estado,
              criado_em: d.criado_em, ultimo_uso: d.ultimo_uso
            })),
            servidor_hora: new Date().toISOString()
          });
        }
        if (url.pathname.endsWith('/equipe')) {
          const nome = body.nome != null ? String(body.nome).trim() : null;
          const nomeValido = n => n && n.length >= 2 && n.length <= 60;

          if (body.equipe_id) {
            // atualizar (§2.3) — inclui inativar, que é um `ativo: false` neste corpo.
            const equipe = estado.equipes.get(body.equipe_id);
            if (!equipe) return responder(404, { ok: false, erro: 'equipe nao encontrada' });
            if (nome != null && nome !== equipe.nome) {
              if (!nomeValido(nome)) return responder(422, erro('NOME_INVALIDO', 'nome precisa ter entre 2 e 60 caracteres', 'nome'));
              const duplicada = [...estado.equipes.values()]
                .some(e => e.equipe_id !== equipe.equipe_id && e.ativo && e.nome.toLowerCase() === nome.toLowerCase());
              if (duplicada) return responder(409, erro('EQUIPE_DUPLICADA', 'já existe uma equipe ativa com esse nome', 'nome'));
              equipe.nome = nome;
            }
            if (body.unidade != null) equipe.unidade = String(body.unidade).trim();
            if (body.ativo === false && equipe.ativo) {
              const membrosAtivos = pessoas.filter(p => p.equipe_id === equipe.equipe_id && !estado.inativos.has(p.pessoa_id)).length;
              if (membrosAtivos > 0) {
                return responder(422, Object.assign(
                  erro('EQUIPE_COM_MEMBROS', 'inative os membros antes de inativar a equipe'),
                  { membros_ativos: membrosAtivos }));
              }
              equipe.ativo = false;
              // Equipe inativa sai do escopo de todo aparelho que a tinha (§2.3).
              for (const d of estado.dispositivos.values()) {
                if (d.equipes_ids && d.equipes_ids.includes(equipe.equipe_id)) {
                  d.equipes_ids = d.equipes_ids.filter(id => id !== equipe.equipe_id);
                  d.configuracao_versao = (d.configuracao_versao || 0) + 1;
                }
              }
            } else if (body.ativo === true) {
              equipe.ativo = true;
            }
            return responder(200, { ok: true, equipe_id: equipe.equipe_id, nome: equipe.nome });
          }

          // criar
          if (!nomeValido(nome)) {
            return responder(422, erro(nome ? 'NOME_INVALIDO' : 'NOME_OBRIGATORIO',
              nome ? 'nome precisa ter entre 2 e 60 caracteres' : 'nome da equipe é obrigatório', 'nome'));
          }
          const duplicada = [...estado.equipes.values()].some(e => e.ativo && e.nome.toLowerCase() === nome.toLowerCase());
          if (duplicada) return responder(409, erro('EQUIPE_DUPLICADA', 'já existe uma equipe ativa com esse nome', 'nome'));
          const novoId = 'eq-' + crypto.randomUUID().slice(0, 8);
          estado.equipes.set(novoId, { equipe_id: novoId, nome, unidade: String(body.unidade || '').trim(), ativo: true });
          estado.equipesCriadas.push(nome);
          return responder(200, { ok: true, equipe_id: novoId, nome });
        }
        if (url.pathname.endsWith('/colaborador/inativar') || url.pathname.endsWith('/colaborador/reativar')) {
          const reativando = url.pathname.endsWith('/reativar');
          const idem = idempotente(body.idempotency_key, body, true);
          if (idem.bloqueado) return responder(idem.bloqueado.status, idem.bloqueado.resposta);
          if (idem.cache) return responder(idem.cache.status, idem.cache.resposta);

          const pessoa = pessoas.find(p => p.pessoa_id === body.pessoa_id);
          if (!pessoa) return responder(404, { ok: false, erro: 'pessoa nao encontrada' });
          const estaInativa = estado.inativos.has(pessoa.pessoa_id);
          const jaNoEstadoPedido = reativando ? !estaInativa : estaInativa;

          if (!jaNoEstadoPedido) {
            if (body.versao_cadastro !== pessoa.versao_cadastro) {
              const resp = Object.assign(erro('CADASTRO_DESATUALIZADO', 'alguém alterou esta pessoa enquanto você decidia'),
                { registro_atual: pessoaParaResposta(pessoa) });
              return responder(409, resp);
            }
            if (reativando) {
              // §3.3.5: reativar exige telefone válido no corpo — devolve sem biometria.
              const r = validarTelefoneOuDuplicado(body, pessoa.pessoa_id);
              if (!r.ok) return responder(r.status, r.corpo);
              estado.inativos.delete(pessoa.pessoa_id);
              pessoa.telefone = r.e164;
              Object.assign(pessoa, r.autorizacao || {});
              pessoa.inativado_em = null; pessoa.inativado_por = null; pessoa.motivo_inativacao = null;
            } else {
              const motivo = String(body.motivo || '').trim();
              if (motivo.length < 10 || motivo.length > 500) {
                return responder(422, erro('MOTIVO_INVALIDO', 'o motivo precisa ter entre 10 e 500 caracteres', 'motivo'));
              }
              estado.inativos.add(pessoa.pessoa_id);
              pessoa.inativado_em = new Date().toISOString();
              pessoa.inativado_por = rhUsuario.usuario;
              pessoa.motivo_inativacao = motivo;
              // Biometria descartada ao inativar (§3.3.4) — o histórico de ponto
              // fica; o vetor/miniatura, não. Reativar exige cadastro novo.
              pessoa.vetores = [];
              pessoa.miniatura = '';
            }
            pessoa.versao_cadastro++;
          }

          const resposta = { ok: true, pessoa_id: pessoa.pessoa_id, ativo: !estado.inativos.has(pessoa.pessoa_id), versao_cadastro: pessoa.versao_cadastro };
          gravarIdempotencia(body.idempotency_key, idem.hash, 200, resposta);
          return responder(200, resposta);
        }
        if (url.pathname.endsWith('/colaborador')) {
          // Campos derivados/imutáveis nunca aceitos na escrita (§3.2).
          if (body.ativo !== undefined) {
            return responder(400, erro('CAMPO_NAO_EDITAVEL', 'ativo não é editável por aqui — use inativar/reativar', 'ativo'));
          }
          const derivado = ['tem_biometria', 'sem_equipe', 'miniatura', 'telefone_compartilhado', 'telefone_compartilhado_com']
            .find(c => body[c] !== undefined);
          if (derivado) return responder(400, erro('CAMPO_DERIVADO', derivado + ' é calculado, não pode ser gravado', derivado));

          if (body.pessoa_id) {
            // edição (§3.2)
            const pessoa = pessoas.find(p => p.pessoa_id === body.pessoa_id);
            if (!pessoa) return responder(404, { ok: false, erro: 'pessoa nao encontrada' });
            if (body.versao_cadastro !== pessoa.versao_cadastro) {
              const resp = Object.assign(erro('CADASTRO_DESATUALIZADO', 'alguém alterou esta pessoa enquanto você editava'),
                { registro_atual: pessoaParaResposta(pessoa) });
              return responder(409, resp);
            }
            const novaMatricula = body.matricula != null ? String(body.matricula).trim() : pessoa.matricula;
            if (novaMatricula !== pessoa.matricula) {
              const temMarcacao = [...estado.marcacoes.values()].some(m => m.pessoa_id === pessoa.pessoa_id);
              if (temMarcacao) return responder(422, erro('MATRICULA_IMUTAVEL', 'matrícula não pode mudar depois da primeira marcação', 'matricula'));
              if (!novaMatricula) return responder(422, { ok: false, erro: 'matricula e obrigatoria' });
            }
            const nome = body.nome != null ? String(body.nome).trim() : pessoa.nome;
            if (!nome) return responder(422, { ok: false, erro: 'nome e obrigatorio' });

            let telefoneFinal = pessoa.telefone;
            let autorizacao = null;
            if (body.telefone !== undefined) {
              const r = validarTelefoneOuDuplicado(body, pessoa.pessoa_id);
              if (!r.ok) return responder(r.status, r.corpo);
              telefoneFinal = r.e164;
              autorizacao = r.autorizacao;
            }

            pessoa.nome = nome;
            pessoa.matricula = novaMatricula;
            pessoa.telefone = telefoneFinal;
            if (autorizacao) Object.assign(pessoa, autorizacao);
            if (body.equipe_id !== undefined) pessoa.equipe_id = body.equipe_id;   // inclusive null: §2.1, sem equipe é estado válido
            if (body.papel !== undefined) pessoa.papel = body.papel;
            pessoa.versao_cadastro++;
            return responder(200, { ok: true, pessoa_id: pessoa.pessoa_id, nome: pessoa.nome, versao_cadastro: pessoa.versao_cadastro });
          }

          // criação
          const nome = String(body.nome || '').trim();
          const matricula = String(body.matricula || '').trim();
          if (!nome || !matricula) return responder(422, { ok: false, erro: 'nome e matricula sao obrigatorios' });
          const r = validarTelefoneOuDuplicado(body, null);
          if (!r.ok) return responder(r.status, r.corpo);
          const novoId = 'p-' + crypto.randomUUID().slice(0, 8);
          pessoas.push({
            pessoa_id: novoId, nome, matricula, equipe_id: body.equipe_id || null, papel: body.papel || 'colaborador',
            telefone: r.e164, versao: 0, vetores: [], miniatura: '', versao_cadastro: 1,
            inativado_em: null, inativado_por: null, motivo_inativacao: null,
            telefone_autorizado_por: null, telefone_autorizado_em: null, telefone_autorizacao_motivo: null,
            ...(r.autorizacao || {})
          });
          estado.colaboradoresCriados.push(nome);
          return responder(200, { ok: true, pessoa_id: novoId, nome });
        }
        if (url.pathname.endsWith('/decidir')) {
          if (!body.id) return responder(422, { ok: false, erro: 'id obrigatorio' });
          estado.decisoes.push({ tipo: body.tipo, id: body.id, acao: body.acao });
          if (body.tipo === 'template') {
            estado.recadastros = estado.recadastros.filter(t => t.template_id !== body.id);
          } else {
            const m = estado.marcacoes.get(body.id);
            if (m) { m.veredito = 'aceito'; m.origem = 'biometria'; m.requer_revisao = false; }
          }
          return responder(200, { ok: true, alvo_tipo: body.tipo, alvo_id: body.id, acao: body.acao });
        }
        if (url.pathname.endsWith('/aparelho')) {
          // 'aprovar' e o unico caminho que ATIVA um aparelho, e resolve
          // SOMENTE pelo codigo digitado — nunca por dispositivo_id. E a prova
          // de posse fisica (docs/adr-acesso-v3.md): quem aprova tem que estar
          // vendo a tela do aparelho, nao so clicando num item de lista.
          if (body.acao === 'aprovar') {
            const codigo = String(body.codigo || '').trim().toUpperCase();
            if (!codigo) return responder(422, { ok: false, erro: 'Digite o código mostrado no aparelho.' });
            const dispositivoId = estado.codigosPendentes.get(codigo);
            const dispositivo = dispositivoId && estado.dispositivos.get(dispositivoId);
            if (!dispositivo || dispositivo.estado !== 'pendente' || codigoExpirado(dispositivo)) {
              // "inválido" e "expirado" viram UMA mensagem só de propósito
              // (docs/fase3-contrato.md §1.3): separar as duas contaria pro RH
              // se aquele código já existiu algum dia — oráculo de código
              // válido. Texto provisório: troca quando o Designer fechar o dele.
              return responder(422, { ok: false, erro: 'Código inválido. Confira com a pessoa e digite de novo.' });
            }
            estado.codigosPendentes.delete(codigo);
            dispositivo.estado = 'ativo';
            // Sem tela de escopo por aparelho ainda nesta fase (fora do
            // contrato de T-87615C): aprovar libera para todas as equipes
            // ATIVAS conhecidas, senão o aparelho fica ativo e sem escopo —
            // /efrat/carga devolveria DISPOSITIVO_SEM_ESCOPO e o deadlock só
            // mudaria de lugar. Dinâmico porque T-8188C6 torna equipe real.
            dispositivo.equipes_ids = [...estado.equipes.values()].filter(e => e.ativo).map(e => e.equipe_id);
            dispositivo.configuracao_versao = 1;
            dispositivo.aprovado_por = rhUsuario.usuario;
            dispositivo.aprovado_em = new Date().toISOString();
            return responder(200, { ok: true, dispositivo_id: dispositivo.dispositivo_id, estado: dispositivo.estado });
          }
          // Recusar e revogar nao ativam nada — não exigem prova de posse,
          // então continuam endereçáveis por dispositivo_id (linha da lista).
          if (!body.dispositivo_id) return responder(422, { ok: false, erro: 'dispositivo_id obrigatorio' });
          const dispositivo = estado.dispositivos.get(body.dispositivo_id);
          if (!dispositivo) return responder(404, { ok: false, erro: 'aparelho nao encontrado' });
          if (body.acao === 'recusar') {
            if (dispositivo.estado !== 'pendente') return responder(422, { ok: false, erro: 'aparelho nao esta pendente' });
            estado.codigosPendentes.delete(dispositivo.codigo_curto);
            dispositivo.estado = 'negado';
          } else if (body.acao === 'revogar') {
            if (dispositivo.estado !== 'ativo') return responder(422, { ok: false, erro: 'aparelho nao esta ativo' });
            dispositivo.estado = 'revogado';
            dispositivo.equipes_ids = [];
            // §1.5/§1.6: revogado_em é a âncora da janela de drenagem de 30
            // dias e do teto de 500 marcações — sem ela /efrat/marcacoes não
            // tem como decidir retido vs rejeitado por prazo.
            dispositivo.revogado_em = new Date().toISOString();
            dispositivo.revogado_por = rhUsuario.usuario;
            dispositivo.motivo_decisao = String(body.motivo || '').trim() || null;
            dispositivo.retidasPosRevogacao = 0;
          } else {
            return responder(422, { ok: false, erro: 'acao desconhecida' });
          }
          return responder(200, { ok: true, dispositivo_id: dispositivo.dispositivo_id, estado: dispositivo.estado });
        }
        return responder(404, { ok: false, erro: 'rota rh desconhecida' });
      }

      if (url.pathname === '/webhook/efrat/cadastro') {
        estado.chamadas.cadastro++;
        const origem = body.origem === 'gestor' ? 'gestor' : 'rh';
        // Coerência calculada aqui, a partir dos vetores recebidos — nunca a
        // partir do campo `coerencia` que o corpo da requisição manda (T-8ADD9C:
        // js/fila.js mandava um `0` fixo; um número que o cliente informa sobre
        // si mesmo é um número que o cliente escolhe). Mesma função pura para
        // qualquer caminho de cadastro (js/coerencia.js).
        const avaliacao = avaliarLoteFace(body.vetores, limiarAceiteCadastro);
        if (!avaliacao.ok) {
          return responder(422, {
            ok: false,
            erro: {
              codigo: avaliacao.codigo, mensagem: avaliacao.mensagem,
              maior_distancia: avaliacao.maiorDistancia
            }
          });
        }
        const id = body.pessoa_id || 'p-' + (body.matricula || Math.random().toString(36).slice(2));
        const existente = pessoas.find(p => p.pessoa_id === id);
        const versaoNova = existente ? (existente.versao || 1) + 1 : 1;
        const criadoEm = new Date().toISOString();
        // Procedência do template (docs/fase3-seguranca.md § 5.1a): origem,
        // coerência calculada e instante já dá para gravar agora. Autor (qual
        // pessoa do RH) depende de identidade do RH chegar nesta rota — hoje só
        // chega dispositivo_id (o aparelho, não quem está logado); registrado
        // como limite do contrato atual, para o T-65D806 fechar.
        if (origem === 'rh' && !existente) {
          pessoas.push({
            pessoa_id: id, nome: body.nome, matricula: body.matricula,
            equipe_id: body.equipe_id, papel: 'colaborador', versao: versaoNova,
            vetores: body.vetores, miniatura: body.miniatura || '',
            origem, coerencia: avaliacao.maiorDistancia, criado_em: criadoEm
          });
        } else if (origem !== 'rh') {
          // Caminho pendente (gestor hoje; upload/link entram aqui quando
          // existirem — T-D30529): não sobrescreve template vigente (§ 1.3a),
          // vai para a fila humana do RH com a coerência já calculada, senão
          // js/rh.js:358 mostra "—" para sempre (achado do Orquestrador).
          estado.recadastros.push({
            template_id: 't-' + id, pessoa_id: id, versao: versaoNova,
            coerencia: avaliacao.maiorDistancia, miniatura: body.miniatura || '',
            vetores: body.vetores, origem, criado_em: criadoEm
          });
        }
        return responder(200, {
          ok: true, pessoa_id: id, template_id: 't-' + id, versao: versaoNova,
          status: origem === 'rh' ? 'ativo' : 'pendente', coerencia: avaliacao.maiorDistancia
        });
      }
      return responder(404, { ok: false, erro: 'rota desconhecida' });
    }

    // estáticos
    const p = url.pathname === '/' ? '/index.html' : url.pathname;
    let arq = path.join(RAIZ, decodeURIComponent(p));
    if (!arq.startsWith(RAIZ)) { res.writeHead(404); res.end('nao encontrado'); return; }
    // Indice de diretorio: /cadastro serve cadastro/index.html, que e como a
    // Vercel resolve o link publico com cleanUrls ligado.
    if (fs.existsSync(arq) && fs.statSync(arq).isDirectory()) arq = path.join(arq, 'index.html');
    else if (!fs.existsSync(arq) && fs.existsSync(arq + '/index.html')) arq = path.join(arq, 'index.html');
    if (!fs.existsSync(arq) || fs.statSync(arq).isDirectory()) {
      res.writeHead(404); res.end('nao encontrado'); return;
    }
    const headers = Object.assign(
      { 'Content-Type': TIPOS[path.extname(arq)] || 'application/octet-stream' },
      headersPara(p)
    );
    if (p === '/js/config.js') {
      const corpo = configLocal('http://' + (req.headers.host || '127.0.0.1')) + fs.readFileSync(arq, 'utf8');
      headers['Content-Length'] = Buffer.byteLength(corpo);
      res.writeHead(200, headers);
      res.end(corpo);
      return;
    }
    res.writeHead(200, headers);
    fs.createReadStream(arq).pipe(res);
  });

  return { servidor, estado, pessoas, carga };
}

export function subir(opts = {}) {
  const { servidor, estado, pessoas } = criarServidor(opts);
  return new Promise(res => {
    servidor.listen(0, '127.0.0.1', () => {
      res({ url: 'http://127.0.0.1:' + servidor.address().port, servidor, estado, pessoas });
    });
  });
}
