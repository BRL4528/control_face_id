// Armazenamento local. Tudo que o app precisa para operar um turno inteiro
// sem internet vive aqui.
//
// Quatro coleções:
//   cfg      sessão, carga da unidade, deriva de relógio
//   fila     marcações ainda não confirmadas pelo servidor  (o dado crítico)
//   enviadas marcações já confirmadas, para deduzir entrada/saída do dia
//   eventos  diário de bordo, para diagnóstico em campo
export const Store = (() => {
  const NOME = 'efrat-ponto';
  const VERSAO = 1;
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

    async marcarErro(id, erro) {
      const d = await abrir();
      return new Promise((res, rej) => {
        const t = d.transaction('fila', 'readwrite');
        const st = t.objectStore('fila');
        const g = st.get(id);
        g.onsuccess = () => {
          const item = g.result;
          if (item) { item._erro = erro; item._tentativas = (item._tentativas || 0) + 1; st.put(item); }
        };
        t.oncomplete = () => res();
        t.onerror = () => rej(t.error);
      });
    },

    confirmar: m => tx('enviadas', 'readwrite', s => s.put(m)),
    enviadas: () => tx('enviadas', 'readonly', s => s.getAll()),

    /**
     * Batidas do dia que o servidor já tem (carga-dia → marcacoes_hoje), por
     * exemplo feitas em outro celular. Entram como enviadas para o tipo da vez, o
     * painel do dia e o intervalo entre batidas contarem com elas. Dedup por
     * id_cliente: o que já está na fila ou nas enviadas deste aparelho fica como está.
     */
    async confirmarDoServidor(lista) {
      const novas = (lista || []).filter(m => m && m.id_cliente && m.marcado_em && m.marcado_dia);
      if (!novas.length) return 0;
      const [fila, enviadas] = await Promise.all([this.fila(), this.enviadas()]);
      const conhecidas = new Set(fila.concat(enviadas).map(m => m.id_cliente));
      let n = 0;
      for (const m of novas) {
        if (conhecidas.has(m.id_cliente)) continue;
        await this.confirmar(Object.assign({ origem_servidor: true }, m));
        conhecidas.add(m.id_cliente); n++;
      }
      return n;
    },

    /**
     * Aparelho pendente que o RH acabou de identificar: as batidas enviadas sem
     * dono viraram, no servidor, lançamentos novos no nome da pessoa (que voltam
     * em marcacoes_hoje). Tira as locais sem dono para o painel não contar duas
     * vezes. A fila não é tocada: o que não subiu ainda sobe normalmente.
     */
    async esquecerEnviadasSemDono() {
      const sem = (await this.enviadas()).filter(m => !m.pessoa_id);
      for (const m of sem) await tx('enviadas', 'readwrite', st => st.delete(m.id_cliente));
      return sem.length;
    },

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
        const t = d.transaction(['cfg', 'fila', 'enviadas', 'eventos'], 'readwrite');
        ['cfg', 'fila', 'enviadas', 'eventos'].forEach(n => t.objectStore(n).clear());
        t.oncomplete = () => res();
        t.onerror = () => rej(t.error);
      });
    }
  };
})();
