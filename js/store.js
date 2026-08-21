// Armazenamento local. Tudo que o app precisa para operar um turno inteiro
// sem internet vive aqui.
//
// Cinco coleções:
//   cfg       sessão, carga da unidade, deriva de relógio
//   fila      marcações ainda não confirmadas pelo servidor  (o dado crítico)
//   enviadas  marcações que o servidor confirmou ter — aceita, duplicada OU
//             retida (§1.6/§3.3 do contrato): "confirmada" não é sinônimo de
//             "conta como ponto", é sinônimo de "não precisa mais ser reenviada"
//   recusadas marcações que o servidor recusou de vez (rejeitado) — nunca
//             reenviadas, nunca apagadas sozinhas, visíveis pro operador.
//             Existe porque hoje um item rejeitado ficava preso na fila pra
//             sempre, retentando em silêncio: ver docs/fase3-contrato.md §1.6.
//   eventos   diário de bordo, para diagnóstico em campo
export const Store = (() => {
  const NOME = 'efrat-ponto';
  const VERSAO = 2;
  let db = null;

  function abrir() {
    if (db) return Promise.resolve(db);
    return new Promise((res, rej) => {
      const r = indexedDB.open(NOME, VERSAO);
      r.onupgradeneeded = e => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('cfg')) d.createObjectStore('cfg');
        if (!d.objectStoreNames.contains('fila')) {
          d.createObjectStore('fila', { keyPath: 'id_cliente' });
        }
        if (!d.objectStoreNames.contains('enviadas')) {
          const s = d.createObjectStore('enviadas', { keyPath: 'id_cliente' });
          s.createIndex('por_dia', 'marcado_dia');
        }
        if (!d.objectStoreNames.contains('recusadas')) {
          d.createObjectStore('recusadas', { keyPath: 'id_cliente' });
        }
        if (!d.objectStoreNames.contains('eventos')) {
          d.createObjectStore('eventos', { keyPath: 'seq', autoIncrement: true });
        }
      };
      r.onsuccess = e => { db = e.target.result; res(db); };
      r.onerror = () => rej(r.error);
    });
  }

  function tx(nome, modo, fn) {
    return abrir().then(d => new Promise((res, rej) => {
      const t = d.transaction(nome, modo);
      const req = fn(t.objectStore(nome));
      t.oncomplete = () => res(req && 'result' in req ? req.result : undefined);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    }));
  }

  return {
    // O navegador pode limpar o armazenamento sozinho sob pressão de disco.
    // Sem isso, marcação não enviada some — e some ponto de folha.
    async fixar() {
      if (!navigator.storage || !navigator.storage.persist) return false;
      try {
        if (await navigator.storage.persisted()) return true;
        return await navigator.storage.persist();
      } catch (e) { return false; }
    },

    get: k => tx('cfg', 'readonly', s => s.get(k)),
    set: (k, v) => tx('cfg', 'readwrite', s => s.put(v, k)),

    enfileirar: m => tx('fila', 'readwrite', s => s.put(m)),
    fila: () => tx('fila', 'readonly', s => s.getAll()),
    tirarDaFila: id => tx('fila', 'readwrite', s => s.delete(id)),

    confirmar: m => tx('enviadas', 'readwrite', s => s.put(m)),
    enviadas: () => tx('enviadas', 'readonly', s => s.getAll()),

    // T-D00CE0 (§1.6): rejeitado nunca mais reenviado nem apagado sozinho —
    // fica aqui, visível, até alguém olhar. Sem `marcarErro`/`_erroPermanente`
    // de antes: aquilo deixava o item preso na `fila`, retentando em
    // silêncio pra sempre, que era exatamente o bug que este contrato fecha.
    recusar: m => tx('recusadas', 'readwrite', s => s.put(m)),
    recusadas: () => tx('recusadas', 'readonly', s => s.getAll()),

    async doDia(dia) {
      const todas = await Promise.all([this.fila(), this.enviadas()]);
      return todas.flat().filter(m => m.marcado_dia === dia);
    },

    async registrar(tipo, detalhe) {
      try {
        await tx('eventos', 'readwrite', s => s.add({ em: new Date().toISOString(), tipo, detalhe }));
      } catch (e) { /* diário nunca derruba operação */ }
    },
    eventos: () => tx('eventos', 'readonly', s => s.getAll()),

    async limparTudo() {
      const d = await abrir();
      return new Promise((res, rej) => {
        const t = d.transaction(['cfg', 'fila', 'enviadas', 'recusadas', 'eventos'], 'readwrite');
        ['cfg', 'fila', 'enviadas', 'recusadas', 'eventos'].forEach(n => t.objectStore(n).clear());
        t.oncomplete = () => res();
        t.onerror = () => rej(t.error);
      });
    }
  };
})();
