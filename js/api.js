import { Store } from './store.js';
import { itensParaRemover, itensRecusados, calcularDeriva } from './regras.js';

const cfg = () => window.EFRAT_CFG;

// Nunca lanca. Queda de rede vira { ok:false, status:0 } — sem isso, um
// aparelho sem sinal derruba a tela com excecao nao tratada em vez de mostrar
// "sem rede". `credencial`, quando presente, vira Authorization: Bearer — é
// como as rotas v3 do dispositivo autenticam (docs/adr-acesso-v3.md).
async function post(rota, corpo, { credencial, timeoutMs = 30000, idempotencyKey } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (credencial) headers.Authorization = 'Bearer ' + credencial;
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const r = await fetch(cfg().apiBase + rota, {
      method: 'POST', headers, body: JSON.stringify(corpo), signal: ctrl.signal
    });
    const txt = await r.text();
    let json = null;
    try { json = txt ? JSON.parse(txt) : null; } catch (e) { /* servidor devolveu não-JSON */ }
    return { ok: r.ok, status: r.status, json, texto: txt };
  } catch (e) {
    return { ok: false, status: 0, json: null, texto: String(e && e.message), rede: true };
  } finally {
    clearTimeout(t);
  }
}

// Erro de rota RH vem em duas formas: string solta (rotas antigas) ou
// { codigo, mensagem, campo? } (rotas novas de T-87615C/T-8188C6, via erro()
// em servidor-falso.js). `erro` sai sempre como texto pronto pro toast;
// `codigo` sai só quando a forma nova mandou um, pra quem precisa decidir por
// código (ex.: TELEFONE_DUPLICADO abre o fluxo de autorização em vez de só
// mostrar a mensagem). `detalhe` é o corpo inteiro do erro, pros campos extra
// que só a forma nova manda (membros_ativos, pessoa_id/nome do duplicado,
// registro_atual do CADASTRO_DESATUALIZADO).
async function postRh(rota, corpo) {
  const r = await post(rota, corpo);
  if (!r.ok || !r.json || !r.json.ok) {
    const bruto = r.json && r.json.erro;
    const objeto = bruto && typeof bruto === 'object';
    return {
      ok: false, status: r.status,
      erro: objeto ? (bruto.mensagem || 'HTTP ' + r.status) : (bruto || 'HTTP ' + r.status),
      codigo: objeto ? (bruto.codigo || null) : null,
      detalhe: r.json || null
    };
  }
  return { ok: true, dados: r.json };
}

export const ApiRh = {
  sal(usuario) { return postRh('/efrat/rh/sal', { usuario }); },
  dados(cred, dias) { return postRh('/efrat/rh/dados', Object.assign({ dias: dias || 30 }, cred)); },
  equipe(cred, dados) { return postRh('/efrat/rh/equipe', Object.assign({}, cred, dados)); },
  colaborador(cred, dados) { return postRh('/efrat/rh/colaborador', Object.assign({}, cred, dados)); },
  // §3.3 do contrato: ligar/desligar pessoa é rota própria, nunca campo do
  // corpo de /rh/colaborador (ativo ali dá 400 CAMPO_NAO_EDITAVEL).
  colaboradorInativar(cred, dados) { return postRh('/efrat/rh/colaborador/inativar', Object.assign({}, cred, dados)); },
  colaboradorReativar(cred, dados) { return postRh('/efrat/rh/colaborador/reativar', Object.assign({}, cred, dados)); },
  decidir(cred, dados) { return postRh('/efrat/rh/decidir', Object.assign({}, cred, dados)); },
  // acao: 'aprovar' | 'recusar' | 'revogar' (T-87615C, docs/fase3-rh-pessoas.md § A).
  aparelho(cred, dados) { return postRh('/efrat/rh/aparelho', Object.assign({}, cred, dados)); }
};

/**
 * Painel do gestor (docs/adr-acesso-v3.md § Sessão facial do gestor). `sessao`
 * é o `sessao_gestor` opaco emitido por /efrat/identificar — nunca um token
 * de aparelho. 401 é sempre SESSAO_EXPIRADA: quem chama trata como sinal para
 * apagar a sessão e voltar pra tela de ponto.
 */
async function postGestor(rota, sessao, corpo, idempotencyKey) {
  const r = await post(rota, corpo, { credencial: sessao, idempotencyKey });
  if (!r.ok || !r.json || !r.json.ok) {
    return { ok: false, status: r.status,
             erro: (r.json && r.json.erro) || { mensagem: r.rede ? 'sem conexão' : ('HTTP ' + r.status) } };
  }
  return { ok: true, dados: r.json };
}

export const ApiGestor = {
  equipeHoje(sessao, dados) { return postGestor('/efrat/gestor/equipe-hoje', sessao, dados); },
  ajustar(sessao, dados, idempotencyKey) { return postGestor('/efrat/gestor/ajustar', sessao, dados, idempotencyKey); }
};

export const Api = {
  /**
   * Primeiro cadastro do aparelho (ou migração de token legado, se
   * `tokenLegado` vier preenchido). Nunca exige credencial própria aqui — ela
   * ainda não existe no servidor.
   */
  registrarDispositivo(dados, tokenLegado) {
    return post('/efrat/dispositivo/registrar', dados, { credencial: tokenLegado });
  },

  /** Estado do cadastro: pendente (com código curto), ativo, negado ou revogado. */
  estadoDispositivo(dispositivoId, credencial) {
    return post('/efrat/dispositivo/estado', { dispositivo_id: dispositivoId }, { credencial });
  },

  /**
   * Carga da unidade. Sempre pede o conjunto completo — sem "desde_versao":
   * este cliente ainda não faz merge incremental de pessoas/removidos_ids, e
   * pedir incremental sem mesclar apagaria a galeria local a cada "sem
   * mudança". Além dos dados, mede a diferença entre o relógio do aparelho e
   * o do servidor — sem isso, celular com hora errada gera ponto errado e
   * ninguém percebe.
   *
   * Normaliza `pessoas[].template.{versao,vetores}` (formato v3) para
   * `pessoas[].{versao,vetores}` (formato flat) porque regras.js — que não
   * muda nesta rodada — espera `pessoa.vetores` direto.
   */
  async carga(dispositivoId, credencial) {
    const t0 = Date.now();
    const r = await post('/efrat/carga', { dispositivo_id: dispositivoId }, { credencial });
    const t1 = Date.now();
    if (!r.ok || !r.json || !r.json.ok) {
      return { ok: false, status: r.status, rede: r.rede === true,
               erro: (r.json && r.json.erro) || (r.rede ? 'sem conexao' : 'falha ao carregar') };
    }
    const c = r.json;
    const pessoas = (c.pessoas || []).map(p => ({
      pessoa_id: p.pessoa_id, nome: p.nome, equipe_id: p.equipe_id, papel: p.papel,
      versao: p.template && p.template.versao, vetores: (p.template && p.template.vetores) || [],
      miniatura: p.miniatura || ''
    }));
    const deriva = calcularDeriva(t0, t1, c.gerado_em);
    return {
      ok: true,
      carga: { versao: c.versao, gerado_em: c.gerado_em, escopo: c.escopo, pessoas },
      deriva
    };
  },

  /**
   * Fallback 1:N on-line para rosto fora da galeria offline do aparelho.
   * Nunca devolve material biométrico — só identidade e, se for gestor
   * reconhecido com margem segura, uma sessão de gestor de vida curta.
   */
  async identificar(dispositivoId, credencial, descritor, capturadoEm, timeoutMs) {
    const r = await post('/efrat/identificar',
      { dispositivo_id: dispositivoId, descritor, capturado_em: capturadoEm }, { credencial, timeoutMs });
    if (!r.ok || !r.json || !r.json.ok) {
      return { ok: false, status: r.status, rede: r.rede === true,
               erro: (r.json && r.json.erro) || (r.rede ? 'sem conexao' : 'falha ao identificar') };
    }
    return { ok: true, resultado: r.json };
  },

  async cadastrar(dispositivoId, credencial, dados) {
    const r = await post('/efrat/cadastro', Object.assign({ dispositivo_id: dispositivoId }, dados), { credencial });
    if (!r.ok || !r.json || !r.json.ok) {
      return { ok: false, erro: (r.json && r.json.erro) || ('HTTP ' + r.status) };
    }
    return { ok: true, resultado: r.json };
  },

  /**
   * Esvazia a fila local. Três garantias de projeto:
   *
   * 1. Envio único em voo. Data Table não tem índice único, então a
   *    deduplicação depende de nunca haver dois lotes simultâneos do mesmo
   *    aparelho. Este é o cadeado.
   * 2. TODO status sai da fila — aceito, duplicado, retido e rejeitado (§1.6
   *    do contrato). Retentar o que o servidor já decidiu, aceito ou não,
   *    não muda a decisão — só enche o lote seguinte de lixo.
   * 3. Aceito/duplicado/retido arquivam em `enviadas` (o servidor tem o
   *    registro, mesmo quando ainda não conta como ponto). Rejeitado nunca
   *    é ponto e nunca é reenviado: vai para `recusadas`, visível pro
   *    operador — é problema que precisa de gente, não retentativa muda.
   */
  _emVoo: null,

  // Nao e async de proposito: o cadeado precisa ser fechado no mesmo tique em
  // que a chamada entra. Se a checagem ficasse antes de um await, tres chamadas
  // seguidas passariam as tres pelo `if` antes de qualquer uma marcar o voo.
  // Quem chega no meio recebe a MESMA promessa em vez de abrir um segundo lote.
  sincronizar(dispositivoId, credencial) {
    if (this._emVoo) return this._emVoo;
    if (!navigator.onLine) return Promise.resolve({ ok: false, offline: true });
    const p = this._enviarLote(dispositivoId, credencial);
    this._emVoo = p;
    p.then(() => { this._emVoo = null; }, () => { this._emVoo = null; });
    return p;
  },

  async _enviarLote(dispositivoId, credencial) {
    const pendentes = await Store.fila();
    if (!pendentes.length) return { ok: true, nada: true };

    try {
      const lote = pendentes.slice(0, cfg().loteMax);
      if (!lote.length) return { ok: true, nada: true };

      const r = await post('/efrat/marcacoes', { dispositivo_id: dispositivoId, marcacoes: lote }, { credencial });
      if (!r.ok || !r.json || !r.json.ok) {
        await Store.registrar('sync_falhou', { status: r.status, erro: r.texto && r.texto.slice(0, 200) });
        return { ok: false, erro: (r.json && r.json.erro) || ('HTTP ' + r.status) };
      }

      const resultados = r.json.resultados || [];
      for (const id of itensParaRemover(resultados)) {
        const original = lote.find(x => x.id_cliente === id);
        if (original) await Store.confirmar(original);
        await Store.tirarDaFila(id);
      }
      for (const id of itensRecusados(resultados)) {
        const original = lote.find(x => x.id_cliente === id);
        const res = resultados.find(x => x.id_cliente === id);
        if (original) {
          await Store.recusar(Object.assign({}, original, {
            recusado_em: new Date().toISOString(),
            motivo_codigo: res.motivo_codigo || null,
            motivo: res.motivo || 'rejeitado pelo servidor'
          }));
        }
        await Store.tirarDaFila(id);
      }
      await Store.registrar('sync', r.json.resumo);
      return { ok: true, resumo: r.json.resumo, resultados };
    } catch (e) {
      await Store.registrar('sync_erro', { msg: String(e && e.message) });
      return { ok: false, erro: String(e && e.message) };
    }
  }
};
