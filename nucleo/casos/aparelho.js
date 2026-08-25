// Rotas de aparelho autenticadas por RH + o par registrar/estado do proprio
// aparelho. docs/fase3-contrato.md §1.1-§1.6, docs/adr-acesso-v3.md.
//
// Rascunho original de API-1 (Arquiteto), revisado e adotado por API-4
// (T-D3DC5C) depois de conferencia linha a linha contra o mapa das 25 rotas
// e contra o servidor falso. Um defeito real corrigido na revisao: o ramo de
// migracao do token legado em `registrar` nao conferia o resultado do
// `inserirDispositivoSeAusente` (colisao de dispositivo_id gravaria silencio
// em cima do token ja consumido -- ver o comentario no proprio ramo).
//
// Decisao registrada sobre a divergencia que o Arquiteto sinalizou: em
// `consultarEstado`, a renovacao do codigo curto expirado so libera a reserva
// velha quando a nova entra (mais segura que o original, que liberava antes
// de sortear -- ramo so alcancavel com 3 colisoes seguidas em 31^6, portanto
// sem cobertura de teste possivel). Mantida a versao segura.
//
// `recusar`/`revogar` (abaixo) estao prontas e revisadas mas FORA da tabela
// de rotas por enquanto -- nao entraram na coluna do primeiro turno de
// amanha (registrar, estado, rh/sal, rh/aparelhos, rh/aparelho/aprovar,
// rh/face/cadastrar, carga, marcacoes). Ligar depois do teste.

import * as dominio from '../dominio.js';
import { erroDe, idempotencia, gravarIdempotencia, respostaDeIdempotencia } from '../contexto.js';

const TENTATIVAS_DE_CODIGO = 3;

function novoCodigo(cripto) {
  let codigo = '';
  for (let i = 0; i < dominio.TAMANHO_CODIGO; i++) {
    codigo += dominio.ALFABETO_CODIGO[cripto.inteiroAleatorio(dominio.ALFABETO_CODIGO.length)];
  }
  return codigo;
}

// ===========================================================================
// POST /efrat/dispositivo/registrar  — alcancavel SEM credencial previa
// ===========================================================================
export async function registrar(ctx, req) {
  const erro = erroDe(ctx.cripto);
  const { total, inicioMs } = await ctx.repo.contarNaJanela(
    'cadastro', req.ip, ctx.cfg.cadastroJanelaMs, req.agoraMs);
  if (total > ctx.cfg.cadastroLimite) {
    const espera = Math.max(1, Math.ceil((ctx.cfg.cadastroJanelaMs - (req.agoraMs - inicioMs)) / 1000));
    return { status: 429, corpo: erro('LIMITE_CADASTRO', 'limite de cadastro excedido'),
      cabecalhos: { 'Retry-After': String(espera) } };
  }

  const b = req.corpo;
  if (!b.dispositivo_id || !b.credencial_publica || !b.apelido || !b.ua) {
    return { status: 400, corpo: erro('CORPO_INVALIDO', 'campos obrigatorios ausentes') };
  }

  // Migracao do piloto: o aparelho traz o token legado no Bearer e sobe ja
  // ativo. O token migra UMA vez — e `consumirTokenLegado` e atomico porque
  // ler-e-depois-gravar aqui deixa dois aparelhos migrarem com a mesma
  // credencial de piloto.
  if (req.credencial) {
    if (req.credencial !== ctx.cfg.tokenLegado) {
      return { status: 401, corpo: erro('TOKEN_LEGADO_INVALIDO', 'token legado invalido') };
    }
    if (!await ctx.repo.consumirTokenLegado()) {
      return { status: 409, corpo: erro('TOKEN_LEGADO_CONSUMIDO', 'token legado ja migrado') };
    }
    // O token so migra UMA vez no sistema inteiro (consumirTokenLegado ja
    // garantiu isso acima), entao nao existe CORRIDA entre duas migracoes —
    // mas dispositivo_id colidir com uma linha de outro fluxo (ex.: o mesmo
    // id ja tinha virado 'pendente' por um /registrar comum antes deste
    // legado chegar) ainda e possivel e nao pode virar 200 silencioso: o
    // token ja foi gasto e a linha gravada nao seria a migrada.
    const inserido = await ctx.repo.inserirDispositivoSeAusente({
      dispositivo_id: b.dispositivo_id, credencial_hash: b.credencial_publica,
      estado: 'ativo', codigo_curto: null, apelido: b.apelido, ua: b.ua,
      geo: b.geo || null, tentativas: 1, local_id: 'local-piloto',
      equipes_ids: ['eq-1'], configuracao_versao: 1,
      aprovado_por: 'migracao-v3', aprovado_em: req.agoraIso,
      criado_em: req.agoraIso, ultimo_uso: null
    });
    if (!inserido.inserido) {
      return { status: 409, corpo: erro('DISPOSITIVO_CONFLITO', 'dispositivo ja cadastrado') };
    }
    return { status: 200, corpo: {
      ok: true, estado: 'ativo', migrado: true,
      dispositivo_id: b.dispositivo_id, request_id: ctx.cripto.uuid()
    } };
  }

  const existente = await ctx.repo.lerDispositivo(b.dispositivo_id);
  if (existente) return respostaDePedidoRepetido(ctx, req, existente, b);

  // §1.1: a linha e a reserva do codigo curto nascem juntas. Colisao de
  // codigo e o INDICE UNICO recusando — sorteia outro, tres vezes.
  for (let tentativa = 0; tentativa < TENTATIVAS_DE_CODIGO; tentativa++) {
    const codigo = novoCodigo(ctx.cripto);
    const r = await ctx.repo.inserirDispositivoSeAusente({
      dispositivo_id: b.dispositivo_id, credencial_hash: b.credencial_publica,
      estado: 'pendente', codigo_curto: codigo, apelido: b.apelido, ua: b.ua,
      geo: b.geo || null, tentativas: 1, local_id: null, equipes_ids: [],
      configuracao_versao: 0, aprovado_por: null, aprovado_em: null,
      criado_em: req.agoraIso, ultimo_uso: null,
      // §1.1 regra 2: pendente_id e o unico handle que /rh/aparelhos expoe
      // para pendentes — recusar resolve por ele, aprovar nunca.
      pendente_id: 'pend-' + ctx.cripto.uuid().slice(0, 8),
      ip_hash: ctx.cripto.sha256(ctx.cfg.salIp + req.ip),
      primeiro_pedido_em: req.agoraIso, ultimo_pedido_em: req.agoraIso
    });
    if (r.inserido) {
      return { status: 202, corpo: {
        ok: true, estado: 'pendente', dispositivo_id: b.dispositivo_id,
        codigo_curto: codigo, consultar_apos_s: ctx.cfg.consultarAposS(10),
        request_id: ctx.cripto.uuid()
      } };
    }
    // Alguem registrou este mesmo dispositivo_id no meio: nao e colisao de
    // codigo, e pedido repetido.
    if (!r.colisaoCodigo) return respostaDePedidoRepetido(ctx, req, r.dispositivo, b);
  }
  return { status: 503, corpo: erro('CODIGO_INDISPONIVEL', 'nao foi possivel gerar codigo') };
}

async function respostaDePedidoRepetido(ctx, req, existente, b) {
  const erro = erroDe(ctx.cripto);
  if (existente.credencial_hash !== b.credencial_publica) {
    return { status: 409, corpo: erro('DISPOSITIVO_CONFLITO', 'dispositivo ja cadastrado') };
  }
  // §1.1 regra 4/§1.2: novo pedido do mesmo aparelho ainda pendente conta como
  // tentativa e atualiza o "visto por ultimo" — o RH ve que ele continua
  // insistindo.
  if (existente.estado === 'pendente') {
    await ctx.repo.atualizarDispositivo(existente.dispositivo_id, {
      tentativas: (existente.tentativas || 1) + 1, ultimo_pedido_em: req.agoraIso
    });
  }
  return { status: 202, corpo: {
    ok: true, estado: existente.estado, dispositivo_id: b.dispositivo_id,
    codigo_curto: existente.codigo_curto, consultar_apos_s: ctx.cfg.consultarAposS(10),
    request_id: ctx.cripto.uuid()
  } };
}

// ===========================================================================
// POST /efrat/dispositivo/estado
// ===========================================================================
export async function consultarEstado(ctx, req) {
  const d = req.dispositivo;   // o adaptador ja autenticou
  if (d.estado === 'pendente') {
    let codigo = d.codigo_curto;
    // T-87615C: codigo pendente nao e prova de posse valida para sempre —
    // passada a janela, o aparelho recebe um novo na proxima consulta e o
    // antigo para de resolver no /rh/aparelho/aprovar.
    if (dominio.codigoExpirado(d, req.agoraMs, ctx.cfg.expiraPendenteMs)) {
      for (let tentativa = 0; tentativa < TENTATIVAS_DE_CODIGO; tentativa++) {
        const candidato = novoCodigo(ctx.cripto);
        const r = await ctx.repo.renovarCodigoCurto({
          dispositivoId: d.dispositivo_id, codigoAntigo: d.codigo_curto,
          codigoNovo: candidato, criadoEm: req.agoraIso
        });
        if (r.trocado) { codigo = candidato; break; }
      }
    }
    return { status: 200, corpo: {
      ok: true, estado: 'pendente', codigo_curto: codigo,
      consultar_apos_s: ctx.cfg.consultarAposS(15), request_id: ctx.cripto.uuid()
    } };
  }
  if (d.estado !== 'ativo') {
    return { status: 200, corpo: { ok: true, estado: d.estado, request_id: ctx.cripto.uuid() } };
  }
  return { status: 200, corpo: {
    ok: true, estado: 'ativo',
    dispositivo: {
      dispositivo_id: d.dispositivo_id, apelido: d.apelido,
      equipes_ids: d.equipes_ids, configuracao_versao: d.configuracao_versao
    },
    request_id: ctx.cripto.uuid()
  } };
}

// ===========================================================================
// AUDITORIA DE APROVACAO (T-81C721, §2.1e)
// ===========================================================================
// TODA tentativa de aprovar, certa ou errada, com ou sem 429 — nunca so o
// limite estourando, senao o padrao paciente (poucas tentativas por dia, nunca
// batendo o teto) nao deixa rastro nenhum. NUNCA guarda o codigo tentado: ele
// nao serve para investigar, so transformaria o log numa lista de codigos para
// quem ler o log.
function auditar(ctx, req, resultado, pendenteId) {
  return ctx.repo.registrarAuditoriaAprovacao({
    usuario_rh: req.rh.usuario, instante: req.agoraIso,
    pendente_id: pendenteId || null, resultado, request_id: ctx.cripto.uuid()
  });
}

// ===========================================================================
// POST /efrat/rh/aparelho/aprovar  — o UNICO caminho que ativa um aparelho
// ===========================================================================
export async function aprovar(ctx, req) {
  const erro = erroDe(ctx.cripto);
  const b = req.corpo;
  const idem = await idempotencia(ctx, b.idempotency_key, b, true);
  const pronta = respostaDeIdempotencia(idem);
  if (pronta) return pronta;

  // §1.3 LIMITE_APROVACAO: contagem por USUARIO de RH, nao por aparelho — e
  // sobre alguem tentando adivinhar codigo.
  const janela = dominio.JANELA_LIMITE_APROVACAO_MS;
  const tentativas = await ctx.repo.tentativasNaJanela('aprovacao', req.rh.usuario, janela, req.agoraMs);
  if (tentativas.length >= dominio.LIMITE_APROVACAO_TENTATIVAS) {
    await auditar(ctx, req, 'limitado');
    return { status: 429,
      corpo: erro('LIMITE_APROVACAO', 'muitas tentativas de código errado — espere e tente de novo'),
      cabecalhos: { 'Retry-After': String(dominio.segundosAteLiberar(tentativas, janela, req.agoraMs)) } };
  }

  // Checagem ESTATICA da string, ANTES de qualquer busca: letra que o alfabeto
  // nunca usa e sempre erro de digitacao, e responder isso nao conta nada
  // sobre se aquele codigo chegou a existir (achado do QA: nao pode virar
  // oraculo).
  const normalizado = dominio.normalizarCodigoCurto(b.codigo);
  if (!normalizado.ok) {
    await auditar(ctx, req, 'letra_invalida');
    return { status: 422, corpo: erro('CODIGO_COM_LETRA_INVALIDA',
      'Esse código tem uma letra que a gente nunca usa (O, I, L, 0, 1). Confira na tela do aparelho.', 'codigo') };
  }
  const codigo = normalizado.codigo;

  // "nao existe", "expirou", "ja foi recusado" e "ja esta ativo" colapsam numa
  // mensagem so (§1.3): distinguir contaria para o RH se aquele codigo
  // especifico chegou a existir — oraculo de codigo valido, mesmo com forca
  // bruta inviavel (insider com acesso de RH).
  const naoEncontrado = () =>
    erro('CODIGO_NAO_ENCONTRADO', 'Código inválido ou expirado. Confira no aparelho e digite de novo.');
  if (!codigo) {
    await ctx.repo.registrarTentativaErrada('aprovacao', req.rh.usuario, req.agoraMs);
    await auditar(ctx, req, 'codigo_nao_encontrado');
    return { status: 404, corpo: naoEncontrado() };
  }

  // Le so para VALIDAR o escopo. Quem ATIVA e o compare-and-set la embaixo:
  // ler-e-depois-escrever aqui deixaria duas telas de RH digitando o mesmo
  // codigo ativarem o aparelho duas vezes, com escopos diferentes.
  const dispositivo = await ctx.repo.lerDispositivoPorCodigoPendente(codigo, req.agoraMs, ctx.cfg.expiraPendenteMs);
  if (!dispositivo) {
    await ctx.repo.registrarTentativaErrada('aprovacao', req.rh.usuario, req.agoraMs);
    await auditar(ctx, req, 'codigo_nao_encontrado');
    return { status: 404, corpo: naoEncontrado() };
  }
  // CODIGO_AMBIGUO (409, §1.3) nao tem caminho aqui: o codigo curto e indice
  // unico entre as linhas pendentes, entao duas pendentes com o mesmo codigo
  // sao estruturalmente impossiveis.
  //
  // ESSA INVARIANTE NAO E DESTE ARQUIVO -- e do indice unico PARCIAL em
  // codigo_curto WHERE estado='pendente' que a migration do Persistencia
  // (API-3) precisa criar. Ate a migration existir e ficar confirmada, este
  // comentario e uma suposicao, nao um fato: sem o indice, dois pendentes
  // podem nascer com o mesmo codigo e aprovar() pode ativar o aparelho
  // ERRADO sem erro nenhum (achado do QA, Revisor QA/Security, 2026-08-25 --
  // mesma suposicao repetida em tests/e2e/servidor-falso.js no comentario do
  // CODIGO_AMBIGUO antigo, que ja nomeava "banco real" como a condicao que
  // quebra ela).

  const equipesIds = Array.isArray(b.equipes_ids) ? b.equipes_ids : [];
  if (equipesIds.length === 0) {
    await auditar(ctx, req, 'escopo_vazio', dispositivo.pendente_id);
    return { status: 422, corpo: erro('ESCOPO_VAZIO', 'Selecione ao menos uma equipe antes de liberar o aparelho.', 'equipes_ids') };
  }
  const selecionadas = [];
  for (const id of equipesIds) selecionadas.push(await ctx.repo.lerEquipe(id));
  if (selecionadas.some(e => !e || !e.ativo)) {
    await auditar(ctx, req, 'equipe_invalida', dispositivo.pendente_id);
    return { status: 422, corpo: erro('EQUIPE_INVALIDA', 'uma das equipes selecionadas não existe ou está inativa', 'equipes_ids') };
  }
  const unidades = new Set(selecionadas.map(e => dominio.normalizarUnidade(e.unidade)));
  if (unidades.size > 1) {
    await auditar(ctx, req, 'equipes_de_unidades_diferentes', dispositivo.pendente_id);
    return { status: 422, corpo: erro('EQUIPES_DE_UNIDADES_DIFERENTES', 'as equipes escolhidas são de unidades diferentes', 'equipes_ids') };
  }
  // Unidade e DERIVADA das equipes, nunca enviada pelo cliente (§2.4/§8-A).
  const unidade = selecionadas[0].unidade;

  const troca = await ctx.repo.aprovarDispositivoPorCodigo({
    codigo, criadoDepoisDe: req.agoraMs - ctx.cfg.expiraPendenteMs,
    campos: {
      equipes_ids: equipesIds, unidade, configuracao_versao: 1,
      aprovado_por: req.rh.usuario, aprovado_em: req.agoraIso
    }
  });
  if (!troca.trocado) {
    // Perdeu a corrida: o codigo ja nao vale mais, e essa e a resposta certa.
    await ctx.repo.registrarTentativaErrada('aprovacao', req.rh.usuario, req.agoraMs);
    await auditar(ctx, req, 'codigo_nao_encontrado');
    return { status: 404, corpo: naoEncontrado() };
  }
  await auditar(ctx, req, 'aprovado', dispositivo.pendente_id);

  const resposta = {
    ok: true, dispositivo_id: troca.dispositivo.dispositivo_id, apelido: troca.dispositivo.apelido,
    unidade, equipes_ids: equipesIds, request_id: ctx.cripto.uuid()
  };
  await gravarIdempotencia(ctx, b.idempotency_key, idem.hash, 200, resposta);
  return { status: 200, corpo: resposta };
}

// ===========================================================================
// POST /efrat/rh/aparelho/recusar  — resolve por pendente_id, nunca por codigo
// ===========================================================================
export async function recusar(ctx, req) {
  const erro = erroDe(ctx.cripto);
  const b = req.corpo;
  const idem = await idempotencia(ctx, b.idempotency_key, b, true);
  const pronta = respostaDeIdempotencia(idem);
  if (pronta) return pronta;

  const dispositivo = await ctx.repo.lerDispositivoPorPendenteId(b.pendente_id);
  if (!dispositivo) {
    return { status: 404, corpo: erro('PENDENTE_NAO_ENCONTRADO', 'linha pendente não encontrada', 'pendente_id') };
  }
  if (dispositivo.estado === 'ativo') {
    return { status: 409, corpo: erro('APARELHO_JA_ATIVO', 'este aparelho já foi aprovado') };
  }
  // Idempotente por pendente_id: recusar duas vezes devolve o mesmo 200, mesmo
  // sem idempotency_key novo — a segunda troca simplesmente nao acontece.
  const troca = await ctx.repo.trocarEstadoDispositivo({
    dispositivoId: dispositivo.dispositivo_id, de: ['pendente'], para: 'negado',
    campos: {
      recusado_por: req.rh.usuario, recusado_em: req.agoraIso,
      motivo_decisao: String(b.motivo || '').trim() || null
    }
  });
  const linha = troca.dispositivo || dispositivo;
  const resposta = { ok: true, dispositivo_id: linha.dispositivo_id, estado: linha.estado, request_id: ctx.cripto.uuid() };
  await gravarIdempotencia(ctx, b.idempotency_key, idem.hash, 200, resposta);
  return { status: 200, corpo: resposta };
}

// ===========================================================================
// POST /efrat/rh/aparelho/revogar
// ===========================================================================
export async function revogar(ctx, req) {
  const erro = erroDe(ctx.cripto);
  const b = req.corpo;
  const idem = await idempotencia(ctx, b.idempotency_key, b, true);
  const pronta = respostaDeIdempotencia(idem);
  if (pronta) return pronta;

  const dispositivo = await ctx.repo.lerDispositivo(b.dispositivo_id);
  if (!dispositivo) {
    return { status: 404, corpo: erro('APARELHO_NAO_ENCONTRADO', 'aparelho não encontrado', 'dispositivo_id') };
  }
  if (dispositivo.estado !== 'ativo' && dispositivo.estado !== 'revogado') {
    return { status: 422, corpo: erro('APARELHO_NAO_ATIVO', 'aparelho não está ativo', 'dispositivo_id') };
  }
  const troca = await ctx.repo.trocarEstadoDispositivo({
    dispositivoId: dispositivo.dispositivo_id, de: ['ativo'], para: 'revogado',
    campos: {
      equipes_ids: [],
      // §1.5/§1.6: revogado_em e a ancora da janela de drenagem de 30 dias e do
      // teto de 500 marcacoes — sem ela /efrat/marcacoes nao tem como decidir
      // retido contra rejeitado por prazo.
      revogado_em: req.agoraIso, revogado_por: req.rh.usuario,
      motivo_decisao: String(b.motivo || '').trim() || null,
      retidasPosRevogacao: 0
    }
  });
  const linha = troca.dispositivo || dispositivo;
  const resposta = { ok: true, dispositivo_id: linha.dispositivo_id, estado: linha.estado, request_id: ctx.cripto.uuid() };
  await gravarIdempotencia(ctx, b.idempotency_key, idem.hash, 200, resposta);
  return { status: 200, corpo: resposta };
}

// ===========================================================================
// POST /efrat/rh/aparelhos  — a aba Aparelhos (§1.2)
// ===========================================================================
export async function listar(ctx, req) {
  const lista = await ctx.repo.listarDispositivos();
  const agora = req.agoraMs;

  const pendentesDaMesmaRede = ipHash => lista.filter(d =>
    d.estado === 'pendente' && d.ip_hash === ipHash &&
    (agora - Date.parse(d.primeiro_pedido_em || 0)) < 3600_000
  ).length;

  const pendentes = lista.filter(d => d.estado === 'pendente')
    .sort((a, b) => String(a.criado_em || '').localeCompare(String(b.criado_em || '')))
    .map(d => ({
      pendente_id: d.pendente_id, apelido_declarado: d.apelido, ua_resumida: dominio.resumirUa(d.ua),
      geo_declarada: d.geo || null, primeiro_pedido_em: d.primeiro_pedido_em,
      ultimo_pedido_em: d.ultimo_pedido_em, tentativas: d.tentativas || 1,
      pedidos_da_mesma_rede_1h: pendentesDaMesmaRede(d.ip_hash)
    }));

  const ativos = lista.filter(d => d.estado === 'ativo')
    .sort((a, b) => String(b.ultimo_uso || '').localeCompare(String(a.ultimo_uso || '')))
    .map(d => ({
      dispositivo_id: d.dispositivo_id, apelido: d.apelido, unidade: d.unidade || null,
      equipes_ids: d.equipes_ids, configuracao_versao: d.configuracao_versao,
      ultimo_uso_em: d.ultimo_uso, aprovado_por: d.aprovado_por, aprovado_em: d.aprovado_em
    }));

  // §1.2: encerrados cobre 30 dias — nao e historico eterno.
  const encerrados = lista.filter(d =>
    (d.estado === 'negado' && d.recusado_em && (agora - Date.parse(d.recusado_em)) < dominio.JANELA_DRENAGEM_MS) ||
    (d.estado === 'revogado' && d.revogado_em && (agora - Date.parse(d.revogado_em)) < dominio.JANELA_DRENAGEM_MS)
  ).map(d => ({
    dispositivo_id: d.dispositivo_id, apelido: d.apelido, estado: d.estado,
    em: d.estado === 'negado' ? d.recusado_em : d.revogado_em,
    por: d.estado === 'negado' ? d.recusado_por : d.revogado_por
  }));

  return { status: 200, corpo: { ok: true, pendentes, ativos, encerrados, request_id: ctx.cripto.uuid() } };
}
