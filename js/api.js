import { Store } from './store.js';
import { itensParaRemover, calcularDeriva } from './regras.js';

const cfg = () => window.EFRAT_CFG;

async function post(rota, corpo, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(cfg().apiBase + rota, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
      signal: ctrl.signal
    });
    const txt = await r.text();
    let json = null;
    try { json = txt ? JSON.parse(txt) : null; } catch (e) { /* servidor devolveu não-JSON */ }
    return { ok: r.ok, status: r.status, json, texto: txt };
  } finally {
    clearTimeout(t);
  }
}

export const Api = {
  /**
   * Login do gestor. Além da carga, mede a diferença entre o relógio do
   * aparelho e o do servidor — sem isso, celular com hora errada gera ponto
   * errado e ninguém percebe.
   */
  async carga(token) {
    const t0 = Date.now();
    const r = await post('/efrat/carga', { token });
    const t1 = Date.now();
    if (!r.ok || !r.json || !r.json.ok) {
      return { ok: false, status: r.status, erro: (r.json && r.json.erro) || 'falha ao carregar' };
    }
    const deriva = calcularDeriva(t0, t1, r.json.servidor_hora);
    return { ok: true, carga: r.json, deriva };
  },

  async cadastrar(token, dados) {
    const r = await post('/efrat/cadastro', Object.assign({ token }, dados));
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
   * 2. Só sai da fila o que o servidor confirmou (aceito ou duplicado).
   * 3. Rejeitado fica retido e visível — é problema que precisa de gente.
   */
  _emVoo: false,

  async sincronizar(token) {
    if (this._emVoo) return { ok: true, pulado: true };
    if (!navigator.onLine) return { ok: false, offline: true };

    const pendentes = await Store.fila();
    if (!pendentes.length) return { ok: true, nada: true };

    this._emVoo = true;
    try {
      const lote = pendentes
        .filter(m => !m._erroPermanente)
        .slice(0, cfg().loteMax)
        .map(m => {
          const copia = Object.assign({}, m);
          delete copia._erro; delete copia._tentativas; delete copia._erroPermanente;
          return copia;
        });
      if (!lote.length) return { ok: true, nada: true };

      const r = await post('/efrat/marcacoes', { token, marcacoes: lote });
      if (!r.ok || !r.json || !r.json.ok) {
        await Store.registrar('sync_falhou', { status: r.status, erro: r.texto && r.texto.slice(0, 200) });
        return { ok: false, erro: (r.json && r.json.erro) || ('HTTP ' + r.status) };
      }

      const resultados = r.json.resultados || [];
      const remover = itensParaRemover(resultados);
      for (const id of remover) {
        const original = lote.find(x => x.id_cliente === id);
        if (original) await Store.confirmar(original);
        await Store.tirarDaFila(id);
      }
      for (const res of resultados) {
        if (res.status === 'rejeitado') {
          await Store.marcarErro(res.id_cliente, res.motivo || 'rejeitado pelo servidor');
        }
      }
      await Store.registrar('sync', r.json.resumo);
      return { ok: true, resumo: r.json.resumo, resultados };
    } catch (e) {
      await Store.registrar('sync_erro', { msg: String(e && e.message) });
      return { ok: false, erro: String(e && e.message) };
    } finally {
      this._emVoo = false;
    }
  }
};
