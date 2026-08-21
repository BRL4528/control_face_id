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

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');


export function extrairCspDeHeaders() {
  const conteudo = fs.readFileSync(path.join(RAIZ, '_headers'), 'utf8');
  const match = conteudo.match(/Content-Security-Policy:\s*(.+)/);
  return match ? match[1].trim() : '';
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
    maxLotesSimultaneos: 0
  };

  for (const marcacao of (opts.marcacoes || [])) semearMarcacao(estado, marcacao);
  for (const pendencia of (opts.pendencias || [])) semearPendencia(estado, pendencia);

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
  ]).map(p => Object.assign({ versao: 1, vetores: [vetorDe(p.pessoa_id)], miniatura: '' }, p));

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
  const novoCodigoUnico = () => {
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      const codigo = codigoAleatorio();
      if (!estado.codigosPendentes.has(codigo)) return codigo;
    }
    return null;
  };
  const dispositivoAutenticado = (req, dispositivoId) => {
    const dispositivo = estado.dispositivos.get(dispositivoId);
    const credencial = bearer(req);
    if (!dispositivo || !credencial || dispositivo.credencial_hash !== hashCredencial(credencial)) return null;
    return dispositivo;
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
            aprovado_por: 'migracao-v3', aprovado_em: new Date().toISOString()
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
          configuracao_versao: 0, aprovado_por: null, aprovado_em: null
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
        const resultados = [];
        for (const m of (body.marcacoes || [])) {
          if (!m || !m.id_cliente || !m.pessoa_id || !m.marcado_em) {
            resultados.push({ id_cliente: m && m.id_cliente, status: 'rejeitado', motivo: 'campos obrigatorios ausentes' });
          } else if (estado.marcacoes.has(m.id_cliente)) {
            resultados.push({ id_cliente: m.id_cliente, status: 'duplicado', motivo: null });
          } else if (estado.inativos.has(m.pessoa_id) || !pessoas.some(p => p.pessoa_id === m.pessoa_id)) {
            resultados.push({ id_cliente: m.id_cliente, status: 'rejeitado', motivo: 'colaborador inativo ou inexistente' });
          } else {
            // Mesma regra do workflow real: gestor, manual, veredito diferente
            // de aceito ou relogio fora de 2 min vao para a mesa do RH.
            const p = pessoas.find(x => x.pessoa_id === m.pessoa_id);
            const deriva = m.deriva_relogio_ms == null ? 0 : Number(m.deriva_relogio_ms);
            const revisar = m.veredito !== 'aceito' || m.origem === 'manual'
              || (p && p.papel === 'gestor') || Math.abs(deriva) > 120000;
            estado.marcacoes.set(m.id_cliente, Object.assign({}, m, {
              requer_revisao: !!revisar,
              foto_auditoria: revisar ? (m.foto_auditoria || '') : ''
            }));
            resultados.push({ id_cliente: m.id_cliente, status: 'aceito', motivo: null });
          }
        }
        estado.lotesSimultaneos--;
        const conta = s => resultados.filter(x => x.status === s).length;
        return responder(200, {
          ok: true, servidor_hora: new Date().toISOString(),
          resumo: { aceitas: conta('aceito'), duplicadas: conta('duplicado'), rejeitadas: conta('rejeitado') },
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
          return responder(200, {
            ok: true, usuario: { usuario: rhUsuario.usuario, nome: rhUsuario.nome },
            periodo_dias: body.dias || 30,
            equipes: [
              { equipe_id: 'eq-1', nome: 'Equipe Um', unidade: 'Unidade A', lat: 0, lng: 0, raio_m: 500, ativo: true },
              { equipe_id: 'eq-2', nome: 'Equipe Dois', unidade: 'Unidade A', lat: 0, lng: 0, raio_m: 500, ativo: true }
            ],
            pessoas: pessoas.map(p => ({
              pessoa_id: p.pessoa_id, matricula: p.matricula, nome: p.nome,
              equipe_id: p.equipe_id, papel: p.papel, ativo: !estado.inativos.has(p.pessoa_id),
              equipes_geridas: '', tem_biometria: true, miniatura: null
            })),
            marcacoes: marcs, recadastros: estado.recadastros,
            servidor_hora: new Date().toISOString()
          });
        }
        if (url.pathname.endsWith('/equipe')) {
          if (!String(body.nome || '').trim()) return responder(422, { ok: false, erro: 'nome da equipe e obrigatorio' });
          estado.equipesCriadas.push(body.nome);
          return responder(200, { ok: true, equipe_id: 'eq-nova', nome: body.nome });
        }
        if (url.pathname.endsWith('/colaborador')) {
          if (!String(body.nome || '').trim() || !String(body.matricula || '').trim()) {
            return responder(422, { ok: false, erro: 'nome e matricula sao obrigatorios' });
          }
          estado.colaboradoresCriados.push(body.nome);
          return responder(200, { ok: true, pessoa_id: body.pessoa_id || 'ps-novo', nome: body.nome });
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
    let p = url.pathname === '/' ? '/index.html' : url.pathname;
    const arq = path.join(RAIZ, decodeURIComponent(p));
    if (!arq.startsWith(RAIZ) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) {
      res.writeHead(404); res.end('nao encontrado'); return;
    }
    const csp = extrairCspDeHeaders();
    const headers = { 'Content-Type': TIPOS[path.extname(arq)] || 'application/octet-stream' };
    if (csp) headers['Content-Security-Policy'] = csp;
    headers['Permissions-Policy'] = 'camera=(self)';
    headers['X-Content-Type-Options'] = 'nosniff';
    headers['Referrer-Policy'] = 'same-origin';
    headers['X-Frame-Options'] = 'DENY';
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
