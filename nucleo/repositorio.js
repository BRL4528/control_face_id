// (b) A INTERFACE DE REPOSITORIO — o contrato de armazenamento da API propria.
//
// Esta e a peca que API-3 (adaptador de persistencia) implementa e que API-4
// (rotas) consome. O nucleo (nucleo/dominio.js e nucleo/casos/*) NUNCA fala
// com armazenamento a nao ser por aqui: nao existe SQL, Map, fetch nem fs em
// nenhum caso de uso.
//
// Extraida de tests/e2e/servidor-falso.js, que e a implementacao de referencia
// provada pelos e2e. Onde o servidor falso fazia "olhar e depois escrever" em
// cima de um Map — o que num Map e atomico de graca e num banco NAO e — a
// interface troca por UMA operacao. Esses sao os pontos marcados com
// ATOMICO abaixo, e sao a razao de a API existir
// (.central-agentes/handoffs/2026-08-24-decisao-api-propria.md).
//
// ---------------------------------------------------------------------------
// AS DUAS OPERACOES QUE JUSTIFICAM A DECISAO
// ---------------------------------------------------------------------------
//
// 1. inserirMarcacaoSeAusente  — INDICE UNICO em marcacao.id_cliente.
//    Ponto duplicado nao e bug de UX, e problema trabalhista. Hoje a dedup
//    depende de "envio unico em voo" no cliente (README.md:356). Aqui ela
//    passa a depender do banco: uma escrita, o indice unico decide, a rota le
//    o resultado. Implementar isso como SELECT-depois-INSERT devolve o
//    problema para o cliente e derruba a razao do cartao.
//
// 2. trocarEstadoConvite       — COMPARE-AND-SET no consumo do convite.
//    Uso unico do link de cadastro de face e a ameaca 1.3 (cadastrar a
//    propria face no lugar de outro). Duas requisicoes com o mesmo token nao
//    podem ambas ver 'aberto' e ambas gravar template. O estado so muda por
//    um UPDATE condicionado ao estado ANTERIOR — quem perde a corrida recebe
//    trocado:false e responde pelo estado terminal, nunca grava.
//
// Ha mais tres compare-and-set que caem no mesmo molde e estao marcados
// ATOMICO: aprovarDispositivoPorCodigo (prova de posse de uso unico),
// trocarEstadoDispositivo, atualizarPessoaSeVersao (o CADASTRO_DESATUALIZADO
// que o contrato ja exige, docs/fase3-contrato.md §3.2) e consumirTokenLegado.
//
// ---------------------------------------------------------------------------
// REGRAS GERAIS DA INTERFACE
// ---------------------------------------------------------------------------
//
// * Todo metodo e assincrono (devolve Promise). O adaptador em memoria tambem,
//   para que o nucleo nao ganhe dependencia acidental de retorno sincrono.
// * Nenhum metodo lanca por "nao encontrado" — devolve null.
// * Metodos de leitura devolvem COPIA. Quem chama nao muta o armazenamento
//   por referencia; alterar e sempre chamada explicita.
// * Instantes viajam como ISO 8601 em texto; janelas e comparacoes de tempo
//   viajam como milissegundos (number). O nucleo nunca chama Date.now() por
//   conta propria: `agoraMs` entra pelo contexto do caso de uso.
// * Nomes em portugues, como o resto do repositorio.

/** Erro de contrato: metodo obrigatorio que a implementacao nao trouxe. */
export class RepositorioIncompleto extends Error {
  constructor(faltando) {
    super('repositorio nao implementa: ' + faltando.join(', '));
    this.name = 'RepositorioIncompleto';
    this.faltando = faltando;
  }
}

/**
 * Todo metodo que a API precisa, agrupado por assunto. `verificarRepositorio`
 * confere esta lista — implementacao incompleta falha na construcao, nao na
 * primeira requisicao que cair no metodo que falta.
 */
export const METODOS = {
  dispositivo: [
    'lerDispositivo', 'lerDispositivoPorPendenteId', 'lerDispositivoPorCodigoPendente',
    'listarDispositivos',
    'inserirDispositivoSeAusente', 'atualizarDispositivo', 'renovarCodigoCurto',
    'aprovarDispositivoPorCodigo', 'trocarEstadoDispositivo',
    'incrementarRetidasPosRevogacao', 'marcarUsoDispositivo',
    'removerEquipeDoEscopoDosDispositivos', 'consumirTokenLegado'
  ],
  pessoa: ['listarPessoas', 'lerPessoa', 'inserirPessoa', 'atualizarPessoaSeVersao', 'atualizarPessoa'],
  equipe: ['listarEquipes', 'lerEquipe', 'inserirEquipeSeNomeLivre', 'atualizarEquipe'],
  marcacao: [
    'inserirMarcacaoSeAusente', 'marcacaoExiste', 'lerMarcacao',
    'listarMarcacoes', 'atualizarMarcacao'
  ],
  convite: [
    'inserirConvite', 'lerConvite', 'lerConvitePorTokenHash', 'listarConvites',
    'listarConvitesVivosDaPessoa', 'trocarEstadoConvite', 'contarTentativaConvite'
  ],
  template: ['inserirRecadastro', 'listarRecadastros', 'removerRecadastro'],
  correcao: ['inserirCorrecao'],
  sessao: ['criarSessaoGestor', 'lerSessaoGestor'],
  idempotencia: ['lerIdempotencia', 'gravarIdempotencia'],
  auditoria: ['registrarAuditoriaIdentificacao', 'registrarAuditoriaAprovacao', 'registrarDecisaoRh'],
  modelo: ['lerReferenciaModeloApp', 'definirReferenciaModeloApp', 'registrarModeloObservado', 'modeloJaObservado'],
  limite: ['contarNaJanela', 'registrarTentativaErrada', 'tentativasNaJanela'],
  rh: ['lerUsuarioRh', 'inserirUsuarioRh']
};

export const TODOS_OS_METODOS = Object.values(METODOS).flat();

/** Falha AGORA, na construcao, e nao na requisicao que cair no buraco. */
export function verificarRepositorio(repo) {
  const faltando = TODOS_OS_METODOS.filter(m => typeof repo?.[m] !== 'function');
  if (faltando.length) throw new RepositorioIncompleto(faltando);
  return repo;
}

/**
 * Documentacao executavel do contrato. Nao herde para "ganhar" comportamento —
 * nao ha comportamento aqui. Serve para (1) ler a assinatura junto da regra e
 * (2) `verificarRepositorio` ter contra o que conferir.
 *
 * Toda subclasse tem de sobrescrever TODOS os metodos.
 */
export class Repositorio {
  #naoImplementado(nome) { throw new RepositorioIncompleto([nome]); }

  // ==========================================================================
  // APARELHO (dispositivo)
  // ==========================================================================

  /** @returns {Promise<object|null>} copia da linha, ou null. */
  async lerDispositivo(dispositivoId) { this.#naoImplementado('lerDispositivo'); }

  /**
   * §1.1 regra 2: `pendente_id` e o unico handle que /rh/aparelhos expoe para
   * pendentes. Recusar resolve por ele; aprovar NUNCA — aprovar so por codigo.
   * @returns {Promise<object|null>}
   */
  async lerDispositivoPorPendenteId(pendenteId) { this.#naoImplementado('lerDispositivoPorPendenteId'); }

  /**
   * ADICAO de 2026-08-25 (nao altera assinatura nenhuma).
   *
   * Le a linha PENDENTE que este codigo curto resolve, ja respeitando a
   * expiracao da prova de posse. Serve so para VALIDAR o escopo antes de
   * aprovar (equipes existem? mesma unidade?) e para montar a auditoria.
   *
   * Quem ATIVA continua sendo `aprovarDispositivoPorCodigo`, que refaz as
   * mesmas condicoes dentro do UPDATE. Sim, e conferir duas vezes -- e de
   * proposito: esta leitura pode ficar obsoleta entre a validacao e a
   * escrita, e a escrita e que decide. Usar SO esta leitura e depois um
   * update incondicional e o check-then-act que a interface existe para
   * tirar do caminho.
   *
   * @param {string} codigo ja normalizado (caixa alta, sem formatacao)
   * @param {number} agoraMs
   * @param {number} expiraEmMs janela de validade da prova de posse
   * @returns {Promise<object|null>} null tambem quando existe mas expirou ou
   *   nao esta mais pendente -- quem chama nao distingue, e nao deve: §1.3
   *   colapsa "nao existe", "expirou", "recusado" e "ja ativo" numa resposta
   *   so, para a rota nao virar oraculo de codigo valido.
   */
  async lerDispositivoPorCodigoPendente(codigo, agoraMs, expiraEmMs) {
    this.#naoImplementado('lerDispositivoPorCodigoPendente');
  }

  /** @returns {Promise<object[]>} todas as linhas, copiadas. */
  async listarDispositivos() { this.#naoImplementado('listarDispositivos'); }

  /**
   * ATOMICO — indice unico em `dispositivo_id` E em `codigo_curto` (parcial,
   * so onde estado='pendente'). Grava a linha e reserva o codigo curto NA
   * MESMA transacao: codigo curto reservado por uma linha e a linha nao
   * existir e o estado que faz o /rh/aparelho/aprovar mentir.
   *
   * `inserido:false` = ja existe aparelho com esse dispositivo_id. Devolve a
   * linha existente para quem chama decidir entre 202 (mesmo aparelho
   * insistindo) e 409 DISPOSITIVO_CONFLITO (credencial diferente).
   *
   * `colisaoCodigo:true` = o dispositivo_id estava livre mas o codigo curto
   * sorteado ja e de outra linha pendente. Quem chama sorteia outro; depois de
   * 3 colisoes responde 503 CODIGO_INDISPONIVEL. E o indice unico decidindo,
   * nao um SELECT antes do INSERT.
   *
   * @returns {Promise<{inserido: boolean, dispositivo: object|null, colisaoCodigo?: boolean}>}
   */
  async inserirDispositivoSeAusente(dispositivo) { this.#naoImplementado('inserirDispositivoSeAusente'); }

  /**
   * Campos SEM invariante de corrida: tentativas, ultimo_pedido_em, apelido,
   * geo. Nunca use para mudar `estado` nem `codigo_curto` — para isso existem
   * os dois metodos abaixo.
   * @returns {Promise<object|null>} a linha depois da atualizacao.
   */
  async atualizarDispositivo(dispositivoId, campos) { this.#naoImplementado('atualizarDispositivo'); }

  /**
   * ATOMICO — troca o codigo curto expirado por um novo respeitando o indice
   * unico. `trocado:false` = o codigo novo colidiu (tente outro) ou outra
   * requisicao ja renovou; em ambos os casos releia antes de responder.
   * @returns {Promise<{trocado: boolean, dispositivo: object|null}>}
   */
  async renovarCodigoCurto({ dispositivoId, codigoAntigo, codigoNovo, criadoEm }) {
    this.#naoImplementado('renovarCodigoCurto');
  }

  /**
   * ATOMICO (compare-and-set) — o unico caminho que ATIVA um aparelho.
   *
   * Resolve SOMENTE pelo codigo digitado (docs/adr-acesso-v3.md: prova de
   * posse fisica). Em SQL e uma sentenca:
   *
   *   UPDATE dispositivo SET estado='ativo', <campos>
   *    WHERE codigo_curto = :codigo
   *      AND estado = 'pendente'
   *      AND criado_em > :criadoDepoisDe
   *   RETURNING *
   *
   * `trocado` e o rowcount. Duas telas de RH digitando o mesmo codigo ao mesmo
   * tempo: uma ativa, a outra recebe trocado:false e responde
   * CODIGO_NAO_ENCONTRADO — que e a resposta certa, porque o codigo ja nao
   * vale mais. `criadoDepoisDe` (ms) e a expiracao da prova de posse: entra na
   * clausula, nao numa leitura anterior.
   *
   * @returns {Promise<{trocado: boolean, dispositivo: object|null}>}
   */
  async aprovarDispositivoPorCodigo({ codigo, criadoDepoisDe, campos }) {
    this.#naoImplementado('aprovarDispositivoPorCodigo');
  }

  /**
   * ATOMICO (compare-and-set) — recusar e revogar.
   *
   *   UPDATE dispositivo SET estado=:para, <campos>
   *    WHERE dispositivo_id=:id AND estado = ANY(:de) RETURNING *
   *
   * `de` e a lista de estados aceitos. `trocado:false` devolve a linha ATUAL,
   * para quem chama distinguir "ja estava nesse estado" (idempotente, 200) de
   * "estado incompativel" (409/422).
   *
   * @returns {Promise<{trocado: boolean, dispositivo: object|null}>}
   */
  async trocarEstadoDispositivo({ dispositivoId, de, para, campos }) {
    this.#naoImplementado('trocarEstadoDispositivo');
  }

  /**
   * ATOMICO — incremento, nunca ler-somar-gravar. E o teto de 500 marcacoes
   * retidas depois da revogacao (§1.6): contador que perde escrita e teto que
   * nao segura.
   * @returns {Promise<number>} o total DEPOIS do incremento.
   */
  async incrementarRetidasPosRevogacao(dispositivoId) { this.#naoImplementado('incrementarRetidasPosRevogacao'); }

  /** "Ultimo uso" da aba Aparelhos. Escrita best-effort, sem invariante. */
  async marcarUsoDispositivo(dispositivoId, instanteIso) { this.#naoImplementado('marcarUsoDispositivo'); }

  /**
   * §2.3: equipe inativada sai do escopo de todo aparelho que a tinha, e cada
   * aparelho afetado ganha +1 em configuracao_versao (e o que faz o aparelho
   * baixar carga nova).
   * @returns {Promise<number>} quantos aparelhos mudaram.
   */
  async removerEquipeDoEscopoDosDispositivos(equipeId) { this.#naoImplementado('removerEquipeDoEscopoDosDispositivos'); }

  /**
   * ATOMICO — o token do piloto migra UMA vez. Segunda chamada devolve false
   * e a rota responde TOKEN_LEGADO_CONSUMIDO. Ler-e-depois-gravar aqui deixa
   * dois aparelhos migrarem com a mesma credencial de piloto.
   * @returns {Promise<boolean>} true so para quem consumiu.
   */
  async consumirTokenLegado() { this.#naoImplementado('consumirTokenLegado'); }

  // ==========================================================================
  // PESSOA
  // ==========================================================================

  /** Lista completa (o calculo de telefone compartilhado e derivado da lista). */
  async listarPessoas() { this.#naoImplementado('listarPessoas'); }
  async lerPessoa(pessoaId) { this.#naoImplementado('lerPessoa'); }
  async inserirPessoa(pessoa) { this.#naoImplementado('inserirPessoa'); }

  /**
   * ATOMICO (compare-and-set) — o bloqueio otimista que o contrato ja exige
   * (docs/fase3-contrato.md §3.2, erro CADASTRO_DESATUALIZADO).
   *
   *   UPDATE pessoa SET <campos>, versao_cadastro = versao_cadastro + 1
   *    WHERE pessoa_id=:id AND versao_cadastro=:versaoEsperada RETURNING *
   *
   * `trocado:false` devolve a linha atual, que e o `registro_atual` do corpo
   * do 409. Comparar a versao numa leitura antes do UPDATE recria exatamente
   * a janela que o campo existe para fechar.
   *
   * @returns {Promise<{trocado: boolean, pessoa: object|null}>}
   */
  async atualizarPessoaSeVersao(pessoaId, versaoEsperada, campos) { this.#naoImplementado('atualizarPessoaSeVersao'); }

  /**
   * Escrita SEM invariante de versao: template biometrico (vetores, miniatura,
   * coerencia, modelo_*). Cadastro de face nao disputa `versao_cadastro` com a
   * edicao de dados — sao campos diferentes e conflito ali seria falso.
   */
  async atualizarPessoa(pessoaId, campos) { this.#naoImplementado('atualizarPessoa'); }

  // ==========================================================================
  // EQUIPE
  // ==========================================================================

  async listarEquipes() { this.#naoImplementado('listarEquipes'); }
  async lerEquipe(equipeId) { this.#naoImplementado('lerEquipe'); }

  /**
   * ATOMICO — indice unico parcial em lower(nome) onde ativo. `inserida:false`
   * = EQUIPE_DUPLICADA (409). Conferir com SELECT antes deixa duas equipes
   * ativas com o mesmo nome nascerem em paralelo.
   * @returns {Promise<{inserida: boolean, equipe: object}>}
   */
  async inserirEquipeSeNomeLivre(equipe) { this.#naoImplementado('inserirEquipeSeNomeLivre'); }

  /**
   * Renomear tambem disputa o indice unico: `renomeada:false` = colidiu.
   * @returns {Promise<{renomeada: boolean, equipe: object|null}>}
   */
  async atualizarEquipe(equipeId, campos) { this.#naoImplementado('atualizarEquipe'); }

  // ==========================================================================
  // MARCACAO  —  aqui mora o indice unico
  // ==========================================================================

  /**
   * ATOMICO — INDICE UNICO em `id_cliente`. A operacao mais importante da API.
   *
   *   INSERT INTO marcacao (...) VALUES (...)
   *   ON CONFLICT (id_cliente) DO NOTHING
   *   RETURNING *
   *
   * `inserida = rowcount === 1`. `inserida:false` e a resposta `duplicado` do
   * contrato — o cliente tira da fila e nunca mais reenvia.
   *
   * NAO implemente como SELECT + INSERT. Duas requisicoes com o mesmo
   * id_cliente (retry do cliente com a resposta perdida na volta, dois
   * aparelhos com a fila espelhada) passam pelo SELECT juntas e gravam duas
   * vezes. Ponto duplicado e problema trabalhista, e essa e a impossibilidade
   * numero 2 que tirou o n8n do caminho.
   *
   * `marcacao` ja chega COMPLETA e decidida pelo nucleo (requer_revisao,
   * motivo_codigo, campos de aparelho). O repositorio nao decide nada.
   *
   * @returns {Promise<{inserida: boolean, marcacao: object}>} `marcacao` e a
   *   linha vencedora — a recem-inserida, ou a que ja estava la.
   */
  async inserirMarcacaoSeAusente(marcacao) { this.#naoImplementado('inserirMarcacaoSeAusente'); }

  /**
   * SONDA de leitura, e SO para o ramo que NAO PERSISTE nada (marcacao
   * rejeitada por aparelho nunca liberado, por pessoa inativa, por campo
   * obrigatorio ausente). Ali uma leitura obsoleta nao causa escrita dupla:
   * o pior caso e responder `rejeitado` no lugar de `duplicado`.
   *
   * A dedup que protege o registro de ponto e `inserirMarcacaoSeAusente`,
   * nunca esta. Se voce esta prestes a escrever `if (await marcacaoExiste(..))
   * ... else await inserir(..)`, pare: e o check-then-act que esta interface
   * existe para tirar do caminho.
   */
  async marcacaoExiste(idCliente) { this.#naoImplementado('marcacaoExiste'); }

  async lerMarcacao(idCliente) { this.#naoImplementado('lerMarcacao'); }
  async listarMarcacoes() { this.#naoImplementado('listarMarcacoes'); }

  /** Decisao do RH sobre uma marcacao retida (veredito/origem/requer_revisao). */
  async atualizarMarcacao(idCliente, campos) { this.#naoImplementado('atualizarMarcacao'); }

  // ==========================================================================
  // CONVITE DE FACE  —  aqui mora o compare-and-set
  // ==========================================================================

  /** Indice unico em `token_hash`. O token claro NUNCA e gravado. */
  async inserirConvite(convite) { this.#naoImplementado('inserirConvite'); }
  async lerConvite(conviteId) { this.#naoImplementado('lerConvite'); }

  /** Resolve pelo HASH do token — o valor claro nao entra no armazenamento. */
  async lerConvitePorTokenHash(tokenHash) { this.#naoImplementado('lerConvitePorTokenHash'); }

  async listarConvites() { this.#naoImplementado('listarConvites'); }

  /**
   * "Um convite vivo por pessoa" (§4.4). Vivo = estado em (emitido, aberto) E
   * ainda nao expirado — a expiracao entra na CONSULTA, nunca num timer de
   * fundo que grava 'expirado'.
   * @param {number} agoraMs
   */
  async listarConvitesVivosDaPessoa(pessoaId, agoraMs) { this.#naoImplementado('listarConvitesVivosDaPessoa'); }

  /**
   * ATOMICO (compare-and-set) — o uso unico do convite.
   *
   *   UPDATE convite SET estado=:para, <campos>
   *    WHERE convite_id=:id
   *      AND estado = ANY(:de)
   *      AND (:naoExpiradoEm IS NULL OR expira_em > :naoExpiradoEm)
   *   RETURNING *
   *
   * `trocado = rowcount === 1`. Duas requisicoes com o MESMO token chegando
   * juntas em /face/convite/enviar: uma leva trocado:true e grava o template;
   * a outra leva trocado:false, NAO grava nada, releia a linha e responda pelo
   * estado atual (409 CONVITE_CONSUMIDO). Esta e a ameaca 1.3 — cadastrar a
   * propria face no lugar de outro — e ela so fecha aqui.
   *
   * `naoExpiradoEm` (ms) entra na clausula do UPDATE de proposito: expiracao
   * conferida numa leitura anterior e uma janela entre a leitura e a escrita.
   *
   * Usado tambem para abrir (emitido -> aberto), revogar e substituir. A
   * mesma primitiva, porque o risco e o mesmo em todos.
   *
   * @param {object} p
   * @param {string} p.conviteId
   * @param {string[]} p.de estados aceitos ANTES da troca
   * @param {string} p.para
   * @param {number|null} [p.naoExpiradoEm] ms; null desliga a clausula
   * @param {object} [p.campos] colunas extras a gravar junto
   * @returns {Promise<{trocado: boolean, convite: object|null}>} `convite` e a
   *   linha DEPOIS (se trocou) ou a linha ATUAL (se nao trocou).
   */
  async trocarEstadoConvite({ conviteId, de, para, naoExpiradoEm, campos }) {
    this.#naoImplementado('trocarEstadoConvite');
  }

  /**
   * ATOMICO — incrementa `tentativas` e, se bater `limite`, troca para
   * 'bloqueado' na mesma operacao. §4.4: recusa e RETORNO, nao consumo — conta
   * tentativa, nao gasta o link; 5 recusas seguidas bloqueiam.
   * @returns {Promise<{tentativas: number, bloqueado: boolean}>}
   */
  async contarTentativaConvite(conviteId, limite) { this.#naoImplementado('contarTentativaConvite'); }

  // ==========================================================================
  // TEMPLATE PENDENTE (recadastro)
  // ==========================================================================

  async inserirRecadastro(recadastro) { this.#naoImplementado('inserirRecadastro'); }
  async listarRecadastros() { this.#naoImplementado('listarRecadastros'); }
  async removerRecadastro(templateId) { this.#naoImplementado('removerRecadastro'); }

  // ==========================================================================
  // CORRECAO (ajuste do gestor)
  // ==========================================================================

  async inserirCorrecao(correcao) { this.#naoImplementado('inserirCorrecao'); }

  // ==========================================================================
  // SESSAO DE GESTOR
  // ==========================================================================

  /** Chave e o token de sessao (opaco, 256 bits). */
  async criarSessaoGestor(token, sessao) { this.#naoImplementado('criarSessaoGestor'); }

  /**
   * Le e, se valida, ja registra a atividade (a janela de inatividade e
   * deslizante). Devolve null para sessao inexistente OU expirada — quem
   * chama nao distingue, e nao precisa.
   * @param {number} agoraMs
   */
  async lerSessaoGestor(token, agoraMs) { this.#naoImplementado('lerSessaoGestor'); }

  // ==========================================================================
  // IDEMPOTENCIA
  // ==========================================================================

  /**
   * @returns {Promise<{hash: string, status: number, resposta: object}|null>}
   *
   * LIMITE CONHECIDO, herdado do servidor falso e mantido de proposito para a
   * extracao nao mudar comportamento: ler-e-depois-gravar deixa duas
   * requisicoes simultaneas com a MESMA chave executarem as duas. O fechamento
   * seria reservar a chave por indice unico antes de executar, e isso muda o
   * que a segunda requisicao ve. Decisao de contrato, nao de implementacao —
   * esta anotado para o Orquestrador.
   */
  async lerIdempotencia(chave) { this.#naoImplementado('lerIdempotencia'); }
  async gravarIdempotencia(chave, registro) { this.#naoImplementado('gravarIdempotencia'); }

  // ==========================================================================
  // AUDITORIA  —  so acrescenta, nunca atualiza nem apaga
  // ==========================================================================

  async registrarAuditoriaIdentificacao(evento) { this.#naoImplementado('registrarAuditoriaIdentificacao'); }

  /**
   * T-81C721 (§2.1e): TODA tentativa de aprovar aparelho, certa ou errada, com
   * ou sem 429. NUNCA guarde o codigo tentado — ele nao ajuda a investigar e
   * transformaria o log numa lista de codigos para quem ler o log.
   */
  async registrarAuditoriaAprovacao(evento) { this.#naoImplementado('registrarAuditoriaAprovacao'); }

  async registrarDecisaoRh(decisao) { this.#naoImplementado('registrarDecisaoRh'); }

  // ==========================================================================
  // MODELO BIOMETRICO OBSERVADO (§4.7)
  // ==========================================================================

  /** @returns {Promise<string|null>} o modelo_id de referencia, ou null. */
  async lerReferenciaModeloApp() { this.#naoImplementado('lerReferenciaModeloApp'); }

  /** So /efrat/carga move a referencia — nunca as rotas de cadastro. */
  async definirReferenciaModeloApp(modeloId) { this.#naoImplementado('definirReferenciaModeloApp'); }

  /** Soma uma observacao (primeira/ultima aparicao, origem). Nunca substitui. */
  async registrarModeloObservado(modeloId, origemObservada) { this.#naoImplementado('registrarModeloObservado'); }

  /** @returns {Promise<boolean>} se este modelo_id ja foi visto ALGUMA vez. */
  async modeloJaObservado(modeloId) { this.#naoImplementado('modeloJaObservado'); }

  // ==========================================================================
  // LIMITES DE VOLUME E DE TENTATIVA
  // ==========================================================================
  //
  // Estes NAO sao dados de negocio e podem nao morar no mesmo lugar que o
  // resto (contador em Redis e uma escolha legitima). Estao na interface
  // porque a API precisa deles compartilhados entre instancias: contador em
  // memoria de processo com duas instancias e um limite que vale o dobro.

  /**
   * ATOMICO — incrementa e devolve. Janela fixa: se a janela corrente venceu,
   * comeca uma nova. Ler-somar-gravar aqui e um limitador que nao limita sob
   * a unica condicao em que ele importa (volume).
   * @param {string} balde ex.: 'cadastro', 'identificacao', 'volume_anonimo'
   * @returns {Promise<{total: number, inicioMs: number}>}
   */
  async contarNaJanela(balde, chave, janelaMs, agoraMs) { this.#naoImplementado('contarNaJanela'); }

  /**
   * §1.3 LIMITE_APROVACAO: instantes de tentativa ERRADA, por usuario de RH —
   * a lista (e nao so a contagem) porque o `Retry-After` sai da mais antiga
   * ainda dentro da janela.
   */
  async registrarTentativaErrada(balde, chave, agoraMs) { this.#naoImplementado('registrarTentativaErrada'); }
  /** @returns {Promise<number[]>} instantes ainda dentro da janela, crescente. */
  async tentativasNaJanela(balde, chave, janelaMs, agoraMs) { this.#naoImplementado('tentativasNaJanela'); }

  // ==========================================================================
  // USUARIO DE RH
  // ==========================================================================

  /**
   * §RH: autentica por usuario + chave (nao por token de aparelho). Devolve
   * `{usuario, nome, sal, iteracoes, ativo}` e o material de conferencia da
   * chave. A rota /rh/sal expoe SOMENTE sal e iteracoes.
   */
  async lerUsuarioRh(usuario) { this.#naoImplementado('lerUsuarioRh'); }

  /**
   * ADICAO de 2026-08-25, a pedido de DevOps + Persistencia: a semente do
   * ambiente de teste precisa criar o usuario de RH sem a semente falar SQL
   * direto. Semente que fala SQL e um segundo lugar onde o esquema esta
   * escrito -- e o lugar que ninguem atualiza quando o esquema muda.
   *
   * `usuario` e chave: `inserido:false` devolve o registro existente, para a
   * semente poder rodar duas vezes sem quebrar (semente que so funciona em
   * banco virgem nao serve pra ambiente de teste, que e reaproveitado).
   *
   * NUNCA recebe senha em claro: o que entra e `{usuario, nome, sal,
   * iteracoes, chave}`, onde `chave` e o material ja derivado -- a mesma
   * forma que /efrat/rh/sal expoe (sal + iteracoes) e que lerUsuarioRh
   * devolve. Derivar aqui dentro poria KDF no repositorio, que e
   * armazenamento, nao criptografia.
   *
   * @returns {Promise<{inserido: boolean, usuario: object}>}
   */
  async inserirUsuarioRh(usuario) { this.#naoImplementado('inserirUsuarioRh'); }
}
