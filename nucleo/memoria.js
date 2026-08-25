// Implementacao em MEMORIA da interface de nucleo/repositorio.js.
//
// Ela existe por dois motivos, nesta ordem:
//
// 1. E o adaptador que o servidor falso usa, e por isso e a prova de que a
//    extracao nao mudou comportamento: os mesmos e2e, contra o mesmo `estado`.
// 2. E a implementacao de referencia contra a qual API-3 confere a de banco.
//    Onde a interface diz ATOMICO, aqui a atomicidade e de graca (o laco de
//    eventos do Node nao intercala dentro de um metodo sincrono). NAO E DE
//    GRACA NO BANCO — quem for portar tem de olhar a doc do metodo, nao esta
//    implementacao, porque aqui um SELECT+INSERT pareceria correto.
//
// O `estado` que entra e o MESMO objeto que os e2e leem e escrevem
// (ctx.estado.dispositivos.get(id).criado_em = ..., ctx.pessoas.find(...)
// .telefone = ...). Por isso as linhas sao mutadas NO LUGAR e nunca
// substituidas: trocar o objeto quebraria toda referencia que um spec ja
// segurava. Leituras devolvem copia; escritas sao chamada explicita.

import { verificarRepositorio } from './repositorio.js';
import { ESTADOS_CONVITE_VIVO } from './dominio.js';

const copia = o => (o == null ? o : Object.assign({}, o));
const copias = lista => lista.map(copia);

export function criarRepositorioMemoria({ estado, pessoas, rhUsuario }) {
  // `ativo` de pessoa mora em estado.inativos (Set), nao numa coluna — e o
  // que os specs escrevem direto (ctx.estado.inativos.add('p-ana')). Toda
  // leitura de pessoa projeta o Set na linha; toda escrita de `ativo` volta
  // para o Set. Duas verdades sobre o mesmo fato e como elas divergem.
  const comAtivo = p => (p == null ? null : Object.assign({}, p, { ativo: !estado.inativos.has(p.pessoa_id) }));
  const linhaPessoa = id => pessoas.find(p => p.pessoa_id === id) || null;

  const baldes = {
    cadastro: estado.limitesCadastro,
    identificacao: estado.limitesIdentificacao,
    volume_anonimo: estado.limitesVolumeAnonimo,
    aprovacao: estado.limitesAprovacao
  };
  const balde = nome => {
    const m = baldes[nome];
    if (!m) throw new Error('balde de limite desconhecido: ' + nome);
    return m;
  };

  const repo = {
    // ======================================================================
    // APARELHO
    // ======================================================================
    async lerDispositivo(id) { return copia(estado.dispositivos.get(id)); },

    async lerDispositivoPorPendenteId(pendenteId) {
      const id = estado.pendentesPorId.get(pendenteId);
      return id ? copia(estado.dispositivos.get(id)) : null;
    },

    async lerDispositivoPorCodigoPendente(codigo, agoraMs, expiraEmMs) {
      const id = estado.codigosPendentes.get(codigo);
      const linha = id && estado.dispositivos.get(id);
      if (!linha || linha.estado !== 'pendente') return null;
      if (!linha.criado_em || (agoraMs - Date.parse(linha.criado_em)) > expiraEmMs) return null;
      return copia(linha);
    },

    async listarDispositivos() { return copias([...estado.dispositivos.values()]); },

    async inserirDispositivoSeAusente(dispositivo) {
      const existente = estado.dispositivos.get(dispositivo.dispositivo_id);
      if (existente) return { inserido: false, dispositivo: copia(existente) };
      if (dispositivo.codigo_curto && estado.codigosPendentes.has(dispositivo.codigo_curto)) {
        return { inserido: false, dispositivo: null, colisaoCodigo: true };
      }
      const linha = Object.assign({}, dispositivo);
      // A linha e a reserva do codigo curto entram juntas: num banco isto e
      // uma transacao com indice unico parcial em codigo_curto, e o motivo e
      // que codigo reservado sem linha faz /rh/aparelho/aprovar mentir.
      estado.dispositivos.set(linha.dispositivo_id, linha);
      if (linha.codigo_curto) estado.codigosPendentes.set(linha.codigo_curto, linha.dispositivo_id);
      if (linha.pendente_id) estado.pendentesPorId.set(linha.pendente_id, linha.dispositivo_id);
      return { inserido: true, dispositivo: copia(linha) };
    },

    async atualizarDispositivo(id, campos) {
      const linha = estado.dispositivos.get(id);
      if (!linha) return null;
      Object.assign(linha, campos);
      return copia(linha);
    },

    async renovarCodigoCurto({ dispositivoId, codigoAntigo, codigoNovo, criadoEm }) {
      const linha = estado.dispositivos.get(dispositivoId);
      if (!linha) return { trocado: false, dispositivo: null };
      if (estado.codigosPendentes.has(codigoNovo)) return { trocado: false, dispositivo: copia(linha) };
      if (codigoAntigo) estado.codigosPendentes.delete(codigoAntigo);
      linha.codigo_curto = codigoNovo;
      linha.criado_em = criadoEm;
      linha.tentativas = (linha.tentativas || 1) + 1;
      estado.codigosPendentes.set(codigoNovo, dispositivoId);
      return { trocado: true, dispositivo: copia(linha) };
    },

    // ATOMICO. Em SQL: UPDATE ... WHERE codigo_curto=? AND estado='pendente'
    // AND criado_em > ? RETURNING *. As tres condicoes na MESMA clausula.
    async aprovarDispositivoPorCodigo({ codigo, criadoDepoisDe, campos }) {
      const id = estado.codigosPendentes.get(codigo);
      const linha = id && estado.dispositivos.get(id);
      if (!linha) return { trocado: false, dispositivo: null };
      const criadoEm = Date.parse(linha.criado_em);
      if (linha.estado !== 'pendente' || !linha.criado_em || !(criadoEm > criadoDepoisDe)) {
        return { trocado: false, dispositivo: copia(linha) };
      }
      estado.codigosPendentes.delete(codigo);
      Object.assign(linha, campos, { estado: 'ativo', codigo_curto: null });
      return { trocado: true, dispositivo: copia(linha) };
    },

    // ATOMICO. UPDATE ... WHERE dispositivo_id=? AND estado = ANY(?).
    async trocarEstadoDispositivo({ dispositivoId, de, para, campos }) {
      const linha = estado.dispositivos.get(dispositivoId);
      if (!linha) return { trocado: false, dispositivo: null };
      if (!de.includes(linha.estado)) return { trocado: false, dispositivo: copia(linha) };
      if (linha.codigo_curto) estado.codigosPendentes.delete(linha.codigo_curto);
      Object.assign(linha, campos, { estado: para });
      return { trocado: true, dispositivo: copia(linha) };
    },

    async incrementarRetidasPosRevogacao(id) {
      const linha = estado.dispositivos.get(id);
      if (!linha) return 0;
      linha.retidasPosRevogacao = (linha.retidasPosRevogacao || 0) + 1;
      return linha.retidasPosRevogacao;
    },

    async marcarUsoDispositivo(id, instanteIso) {
      const linha = estado.dispositivos.get(id);
      if (linha) linha.ultimo_uso = instanteIso;
    },

    async removerEquipeDoEscopoDosDispositivos(equipeId) {
      let afetados = 0;
      for (const d of estado.dispositivos.values()) {
        if (d.equipes_ids && d.equipes_ids.includes(equipeId)) {
          d.equipes_ids = d.equipes_ids.filter(id => id !== equipeId);
          d.configuracao_versao = (d.configuracao_versao || 0) + 1;
          afetados++;
        }
      }
      return afetados;
    },

    // ATOMICO: um UPDATE condicionado, nao um if sobre uma leitura.
    async consumirTokenLegado() {
      if (estado.tokenLegadoConsumido) return false;
      estado.tokenLegadoConsumido = true;
      return true;
    },

    // ======================================================================
    // PESSOA
    // ======================================================================
    async listarPessoas() { return pessoas.map(comAtivo); },
    async lerPessoa(id) { return comAtivo(linhaPessoa(id)); },

    async inserirPessoa(pessoa) {
      const linha = Object.assign({}, pessoa);
      delete linha.ativo;
      pessoas.push(linha);
      // Bookkeeping do servidor falso: o que os e2e conferem como "foi criado".
      if (estado.colaboradoresCriados) estado.colaboradoresCriados.push(linha.nome);
      return comAtivo(linha);
    },

    // ATOMICO. UPDATE ... WHERE pessoa_id=? AND versao_cadastro=? — o
    // CADASTRO_DESATUALIZADO de §3.2. Comparar a versao numa leitura anterior
    // recria a janela que o campo existe para fechar.
    async atualizarPessoaSeVersao(id, versaoEsperada, campos) {
      const linha = linhaPessoa(id);
      if (!linha) return { trocado: false, pessoa: null };
      if (linha.versao_cadastro !== versaoEsperada) return { trocado: false, pessoa: comAtivo(linha) };
      aplicarCamposDePessoa(linha, campos);
      linha.versao_cadastro++;
      return { trocado: true, pessoa: comAtivo(linha) };
    },

    async atualizarPessoa(id, campos) {
      const linha = linhaPessoa(id);
      if (!linha) return null;
      aplicarCamposDePessoa(linha, campos);
      return comAtivo(linha);
    },

    // ======================================================================
    // EQUIPE
    // ======================================================================
    async listarEquipes() { return copias([...estado.equipes.values()]); },
    async lerEquipe(id) { return copia(estado.equipes.get(id)); },

    // ATOMICO: indice unico parcial em lower(nome) onde ativo.
    async inserirEquipeSeNomeLivre(equipe) {
      const duplicada = [...estado.equipes.values()]
        .find(e => e.ativo && e.nome.toLowerCase() === equipe.nome.toLowerCase());
      if (duplicada) return { inserida: false, equipe: copia(duplicada) };
      const linha = Object.assign({}, equipe);
      estado.equipes.set(linha.equipe_id, linha);
      if (estado.equipesCriadas) estado.equipesCriadas.push(linha.nome);
      return { inserida: true, equipe: copia(linha) };
    },

    async atualizarEquipe(id, campos) {
      const linha = estado.equipes.get(id);
      if (!linha) return { renomeada: false, equipe: null };
      if (campos.nome != null && campos.nome !== linha.nome) {
        const duplicada = [...estado.equipes.values()]
          .some(e => e.equipe_id !== id && e.ativo && e.nome.toLowerCase() === String(campos.nome).toLowerCase());
        if (duplicada) return { renomeada: false, equipe: copia(linha) };
      }
      Object.assign(linha, campos);
      return { renomeada: true, equipe: copia(linha) };
    },

    // ======================================================================
    // MARCACAO
    // ======================================================================

    // ATOMICO — o indice unico em id_cliente.
    // INSERT ... ON CONFLICT (id_cliente) DO NOTHING RETURNING *.
    // `inserida:false` E a resposta 'duplicado' do contrato.
    async inserirMarcacaoSeAusente(marcacao) {
      const existente = estado.marcacoes.get(marcacao.id_cliente);
      if (existente) return { inserida: false, marcacao: copia(existente) };
      const linha = Object.assign({}, marcacao);
      estado.marcacoes.set(linha.id_cliente, linha);
      return { inserida: true, marcacao: copia(linha) };
    },

    // Sonda de leitura — so para o ramo que NAO persiste (ver a doc na
    // interface antes de usar em qualquer outro lugar).
    async marcacaoExiste(idCliente) { return estado.marcacoes.has(idCliente); },

    async lerMarcacao(idCliente) { return copia(estado.marcacoes.get(idCliente)); },
    async listarMarcacoes() { return copias([...estado.marcacoes.values()]); },

    async atualizarMarcacao(idCliente, campos) {
      const linha = estado.marcacoes.get(idCliente);
      if (!linha) return null;
      Object.assign(linha, campos);
      return copia(linha);
    },

    // ======================================================================
    // CONVITE
    // ======================================================================
    async inserirConvite(convite) {
      const linha = Object.assign({}, convite);
      estado.convites.set(linha.convite_id, linha);
      estado.tokenHashParaConvite.set(linha.token_hash, linha.convite_id);
      return copia(linha);
    },

    async lerConvite(id) { return copia(estado.convites.get(id)); },

    async lerConvitePorTokenHash(tokenHash) {
      const id = estado.tokenHashParaConvite.get(tokenHash);
      return id ? copia(estado.convites.get(id)) : null;
    },

    async listarConvites() { return copias([...estado.convites.values()]); },

    async listarConvitesVivosDaPessoa(pessoaId, agoraMs) {
      return copias([...estado.convites.values()].filter(c =>
        c.pessoa_id === pessoaId && ESTADOS_CONVITE_VIVO.includes(c.estado) && agoraMs <= Date.parse(c.expira_em)));
    },

    // ATOMICO — o compare-and-set do uso unico. A expiracao entra na
    // CLAUSULA (naoExpiradoEm), nunca numa leitura anterior.
    async trocarEstadoConvite({ conviteId, de, para, naoExpiradoEm, campos }) {
      const linha = estado.convites.get(conviteId);
      if (!linha) return { trocado: false, convite: null };
      const expirouNaClausula = naoExpiradoEm != null && !(Date.parse(linha.expira_em) > naoExpiradoEm);
      if (!de.includes(linha.estado) || expirouNaClausula) return { trocado: false, convite: copia(linha) };
      Object.assign(linha, campos || {}, { estado: para });
      return { trocado: true, convite: copia(linha) };
    },

    // ATOMICO — incrementa e bloqueia na mesma operacao.
    async contarTentativaConvite(conviteId, limite) {
      const linha = estado.convites.get(conviteId);
      if (!linha) return { tentativas: 0, bloqueado: false };
      linha.tentativas = (linha.tentativas || 0) + 1;
      if (linha.tentativas >= limite) linha.estado = 'bloqueado';
      return { tentativas: linha.tentativas, bloqueado: linha.estado === 'bloqueado' };
    },

    // ======================================================================
    // TEMPLATE PENDENTE / CORRECAO
    // ======================================================================
    async inserirRecadastro(r) { const linha = Object.assign({}, r); estado.recadastros.push(linha); return copia(linha); },
    async listarRecadastros() { return copias(estado.recadastros); },
    async removerRecadastro(templateId) {
      const antes = estado.recadastros.length;
      estado.recadastros = estado.recadastros.filter(t => t.template_id !== templateId);
      return antes - estado.recadastros.length;
    },

    async inserirCorrecao(c) { const linha = Object.assign({}, c); estado.correcoes.push(linha); return copia(linha); },

    // ======================================================================
    // SESSAO DE GESTOR
    // ======================================================================
    async criarSessaoGestor(token, sessao) { estado.sessoesGestor.set(token, Object.assign({}, sessao)); },

    async lerSessaoGestor(token, agoraMs) {
      const sessao = estado.sessoesGestor.get(token);
      if (!sessao) return null;
      if (agoraMs >= sessao.expira_absoluto || agoraMs - sessao.ultima_atividade >= 5 * 60_000) return null;
      sessao.ultima_atividade = agoraMs;   // janela de inatividade deslizante
      return copia(sessao);
    },

    // ======================================================================
    // IDEMPOTENCIA  (ver o limite conhecido documentado na interface)
    // ======================================================================
    async lerIdempotencia(chave) { return copia(estado.idempotencia.get(chave)); },
    async gravarIdempotencia(chave, registro) { estado.idempotencia.set(chave, Object.assign({}, registro)); },

    // ======================================================================
    // AUDITORIA
    // ======================================================================
    async registrarAuditoriaIdentificacao(e) { estado.auditoriaIdentificacao.push(Object.assign({}, e)); },
    async registrarAuditoriaAprovacao(e) { estado.auditoriaAprovacao.push(Object.assign({}, e)); },
    async registrarDecisaoRh(d) { estado.decisoes.push(Object.assign({}, d)); },

    // ======================================================================
    // MODELO OBSERVADO
    // ======================================================================
    async lerReferenciaModeloApp() { return estado.referenciaModeloApp; },
    async definirReferenciaModeloApp(modeloId) { estado.referenciaModeloApp = modeloId; },
    async modeloJaObservado(modeloId) { return estado.modelosObservados.has(modeloId); },

    async registrarModeloObservado(modeloId, origemObservada, agoraIso) {
      const existente = estado.modelosObservados.get(modeloId);
      if (existente) {
        existente.ultima_aparicao_em = agoraIso;
        existente.origens.add(origemObservada);
        return;
      }
      estado.modelosObservados.set(modeloId, {
        modelo_id: modeloId, primeira_aparicao_em: agoraIso, ultima_aparicao_em: agoraIso,
        origens: new Set([origemObservada])
      });
    },

    // ======================================================================
    // LIMITES
    // ======================================================================

    // ATOMICO no banco (INCR com expiracao, ou UPDATE ... RETURNING).
    // Janela fixa: vencida a janela corrente, comeca uma nova.
    async contarNaJanela(nome, chave, janelaMs, agoraMs) {
      const m = balde(nome);
      let contador = m.get(chave);
      if (!contador || agoraMs - contador.inicio >= janelaMs) contador = { inicio: agoraMs, total: 0 };
      contador.total++;
      m.set(chave, contador);
      return { total: contador.total, inicioMs: contador.inicio };
    },

    async tentativasNaJanela(nome, chave, janelaMs, agoraMs) {
      const m = balde(nome);
      const lista = (m.get(chave) || []).filter(t => agoraMs - t < janelaMs);
      m.set(chave, lista);
      return [...lista];
    },

    async registrarTentativaErrada(nome, chave, agoraMs) {
      const m = balde(nome);
      const lista = (m.get(chave) || []).filter(t => agoraMs - t < 24 * 3600_000);
      lista.push(agoraMs);
      m.set(chave, lista);
    },

    // ======================================================================
    // USUARIO DE RH
    // ======================================================================
    async lerUsuarioRh(usuario) {
      return rhUsuario && rhUsuario.usuario === usuario ? Object.assign({}, rhUsuario) : null;
    },

    // Em memoria ha UM usuario de RH (o do servidor falso, vindo por opts).
    // Reinserir o mesmo devolve inserido:false com o que ja existe -- que e o
    // que faz a semente ser reexecutavel.
    async inserirUsuarioRh(novo) {
      if (rhUsuario && rhUsuario.usuario === novo.usuario) {
        return { inserido: false, usuario: Object.assign({}, rhUsuario) };
      }
      if (rhUsuario) return { inserido: false, usuario: Object.assign({}, rhUsuario) };
      rhUsuario = Object.assign({}, novo);
      return { inserido: true, usuario: Object.assign({}, rhUsuario) };
    }
  };

  return verificarRepositorio(repo);
}

/**
 * `ativo` nao e coluna de pessoa aqui — mora no Set de inativos. Escrita de
 * `ativo` vai para o Set; o resto vai para a linha, MUTADA NO LUGAR (os e2e
 * seguram referencia para essas linhas).
 */
function aplicarCamposDePessoa(linha, campos) {
  const { ativo, ...resto } = campos;
  Object.assign(linha, resto);
  return { ativo, linha };
}

// A projecao de `ativo` precisa do Set, entao o helper acima so separa o
// campo; quem aplica e o repositorio, que tem o Set no escopo.
export function separarAtivo(campos) {
  const { ativo, ...resto } = campos;
  return { ativo, resto };
}
