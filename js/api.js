// Cliente de API v4. Backend próprio na mesma origem (/api). Duas famílias:
// dispositivo (credencial pareada no Bearer) e RH (JWT no Bearer). Nunca lança:
// queda de rede vira { ok:false, status:0, rede:true } para a tela mostrar "sem
// rede" em vez de quebrar.
import { Store } from './store.js';
import { itensParaRemover, calcularDeriva } from './regras.js';

const cfg = () => window.EFRAT_CFG;

async function req(rota, corpo, { bearer, metodo = 'POST', timeoutMs = 30000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (bearer) headers.Authorization = 'Bearer ' + bearer;
    const r = await fetch(cfg().apiBase + rota, {
      method: metodo, headers,
      body: metodo === 'GET' ? undefined : JSON.stringify(corpo || {}),
      signal: ctrl.signal
    });
    const txt = await r.text();
    let json = null;
    try { json = txt ? JSON.parse(txt) : null; } catch { /* não-JSON */ }
    return { ok: r.ok, status: r.status, json };
  } catch (e) {
    return { ok: false, status: 0, json: null, rede: true };
  } finally { clearTimeout(t); }
}

function msgErro(r, fallback) {
  return (r.json && r.json.erro && r.json.erro.mensagem) || (r.rede ? 'sem conexão' : fallback);
}

/* ------------------------------------------------- dispositivo (colaborador) */

export const Api = {
  /** Pareamento inicial do celular ao colaborador (uma vez na vida do aparelho). */
  async parear(dados) {
    const r = await req('/parear', dados);
    if (!r.ok || !r.json || !r.json.ok) return { ok: false, status: r.status, erro: msgErro(r, 'falha ao parear') };
    return { ok: true, colaborador: r.json.colaborador };
  },

  /** Carga do dia: template 1:1 do próprio colaborador + alocação/cerca de hoje. */
  async cargaDia(credencial, dia) {
    const t0 = Date.now();
    const r = await req('/carga-dia', { dia }, { bearer: credencial });
    const t1 = Date.now();
    if (!r.ok || !r.json || !r.json.ok) return { ok: false, status: r.status, rede: r.rede === true, erro: msgErro(r, 'falha na carga') };
    const c = r.json;
    return {
      ok: true,
      colaborador: c.colaborador,
      template: c.template,       // { versao, vetores } ou null
      alocacao: c.alocacao,       // { equipe_id, equipe_nome, cerca } ou null
      deriva: calcularDeriva(t0, t1, c.servidor_hora)
    };
  },

  /* Esvaziamento da fila. Envio único em voo: dedup depende de nunca haver dois
     lotes simultâneos. O banco tem PK única em id_cliente, mas o cadeado local
     evita corrida e trabalho duplicado. */
  _emVoo: null,
  sincronizar(credencial) {
    if (this._emVoo) return this._emVoo;
    if (!navigator.onLine) return Promise.resolve({ ok: false, offline: true });
    const p = this._enviarLote(credencial);
    this._emVoo = p;
    p.then(() => { this._emVoo = null; }, () => { this._emVoo = null; });
    return p;
  },

  async _enviarLote(credencial) {
    const pendentes = await Store.fila();
    if (!pendentes.length) return { ok: true, nada: true };
    const lote = pendentes.filter(m => !m._erroPermanente).slice(0, cfg().loteMax).map(m => {
      const c = Object.assign({}, m); delete c._erro; delete c._tentativas; delete c._erroPermanente; delete c._nome; return c;
    });
    if (!lote.length) return { ok: true, nada: true };

    const r = await req('/ponto', { marcacoes: lote }, { bearer: credencial });
    if (!r.ok || !r.json || !r.json.ok) {
      await Store.registrar('sync_falhou', { status: r.status });
      return { ok: false, erro: msgErro(r, 'falha ao enviar') };
    }
    const resultados = r.json.resultados || [];
    for (const id of itensParaRemover(resultados)) {
      const original = lote.find(x => x.id_cliente === id);
      if (original) await Store.confirmar(original);
      await Store.tirarDaFila(id);
    }
    for (const res of resultados) {
      if (res.status === 'rejeitado') await Store.marcarErro(res.id_cliente, res.motivo || 'rejeitado');
    }
    await Store.registrar('sync', r.json.resumo);
    return { ok: true, resumo: r.json.resumo, resultados };
  }
};

/* ----------------------------------------------------------------- RH */

async function reqRh(rota, token, corpo, metodo) {
  const r = await req(rota, corpo, { bearer: token, metodo });
  if (!r.ok || !r.json || !r.json.ok) {
    const e = (r.json && r.json.erro) || {};
    return { ok: false, status: r.status, erro: msgErro(r, 'HTTP ' + r.status), codigo: e.codigo || null, detalhes: e.detalhes || null };
  }
  return { ok: true, dados: r.json };
}

export const ApiRh = {
  sal(usuario) { return req('/rh/login?usuario=' + encodeURIComponent(usuario), null, { metodo: 'GET' }); },
  login(usuario, chave) { return reqRh('/rh/login', null, { usuario, chave }); },
  dados(token, dias) { return reqRh('/rh/dados', token, { dias: dias || 30 }); },
  colaborador(token, d) { return reqRh('/rh/colaborador', token, d); },
  equipe(token, d) { return reqRh('/rh/equipe', token, d); },
  local(token, d) { return reqRh('/rh/local', token, d); },
  alocar(token, d) { return reqRh('/rh/alocar', token, d); },
  biometria(token, d) { return reqRh('/rh/biometria', token, d); },
  decidir(token, d) { return reqRh('/rh/decidir', token, d); },
  lancarPonto(token, d) { return reqRh('/rh/lancar-ponto', token, d); },
  jornada(token, d) { return reqRh('/rh/jornada', token, d); },
  config(token, d) { return reqRh('/rh/config', token, d); },
  usuario(token, d) { return reqRh('/rh/usuario', token, d); },
  plano(token, d) { return reqRh('/rh/plano', token, d); },
  importar(token, d) { return reqRh('/rh/importar', token, d, undefined); },
  /** Planilha modelo de importação (binário). Devolve Blob ou null. */
  async modeloImportacao(token) {
    try {
      const r = await fetch(cfg().apiBase + '/rh/importar?modelo=1', { headers: { Authorization: 'Bearer ' + token } });
      return r.ok ? await r.blob() : null;
    } catch { return null; }
  }
};
