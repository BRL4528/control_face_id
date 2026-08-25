// O que todo caso de uso recebe, e o que ele devolve.
//
// Caso de uso: `async (ctx, req) => resposta`. Nada de req/res do node:http
// entra aqui — quem traduz e nucleo/http.js.

/**
 * `ctx` — o que nao muda entre requisicoes.
 * @typedef {object} Contexto
 * @property {object} repo    implementacao de nucleo/repositorio.js
 * @property {object} cripto  portas de aleatoriedade e hash (abaixo)
 * @property {object} cfg     limiares, janelas e limites
 *
 * `req` — o que muda a cada requisicao. Repare em `agoraMs`/`agoraIso`: o
 * instante e propriedade DA REQUISICAO, nao um Date.now() escondido dentro da
 * regra. E o que deixa o dominio testavel sem congelar relogio.
 * @typedef {object} Requisicao
 * @property {string} caminho
 * @property {string} metodo
 * @property {object} corpo            JSON ja decodificado ({} se vazio/invalido)
 * @property {number} tamanhoCorpo     bytes do corpo cru (tetos de §4.8)
 * @property {string} credencial       o Bearer, sem o prefixo ('' se ausente)
 * @property {string|undefined} idempotencyKey  cabecalho Idempotency-Key
 * @property {string} ip
 * @property {number} agoraMs
 * @property {string} agoraIso
 * @property {object|null} dispositivo aparelho ja autenticado pelo adaptador
 * @property {object|null} rh          usuario de RH ja autenticado
 * @property {object|null} sessaoGestor
 *
 * Resposta: `{status, corpo, cabecalhos?}`. Sempre esses tres, nunca escrita
 * direta num socket.
 */

/** Portas de infraestrutura que o dominio precisa mas nao pode conter. */
export function verificarCripto(cripto) {
  for (const m of ['uuid', 'tokenAleatorio', 'inteiroAleatorio', 'sha256']) {
    if (typeof cripto?.[m] !== 'function') throw new Error('cripto sem ' + m);
  }
  return cripto;
}

/**
 * Corpo de erro do contrato (docs/fase3-contrato.md §0): sempre
 * `{ok:false, erro:{codigo, mensagem, campo?}, request_id}`.
 */
export function erroDe(cripto) {
  return (codigo, mensagem, campo) => ({
    ok: false,
    erro: Object.assign({ codigo, mensagem }, campo ? { campo } : {}),
    request_id: cripto.uuid()
  });
}

export const ok = (status, corpo, cabecalhos) => ({ status, corpo, cabecalhos });

/**
 * C1-C3 do contrato (§0): chave de idempotencia. Mesma chave + mesmo corpo
 * repete a resposta gravada; mesma chave + corpo diferente e conflito. So as
 * rotas NOVAS de escrita exigem a chave (C2) — por isso `obrigatoria`.
 *
 * LIMITE CONHECIDO, herdado do servidor falso e mantido de proposito (ver a
 * nota em nucleo/repositorio.js): ler-e-depois-gravar deixa duas requisicoes
 * simultaneas com a mesma chave executarem as duas. As escritas perigosas
 * dessas rotas estao seguradas pelas operacoes ATOMICO por baixo, nao por
 * esta chave — e isso e cartao aberto, nao suposicao.
 */
export async function idempotencia(ctx, chave, corpo, obrigatoria) {
  const erro = erroDe(ctx.cripto);
  if (!chave) {
    if (obrigatoria) {
      return { bloqueado: { status: 400, corpo: erro('IDEMPOTENCIA_AUSENTE', 'chave de idempotência obrigatória') } };
    }
    return { hash: null };
  }
  const hash = ctx.cripto.sha256(JSON.stringify(corpo));
  const anterior = await ctx.repo.lerIdempotencia(chave);
  if (anterior && anterior.hash !== hash) {
    return { bloqueado: { status: 409, corpo: erro('IDEMPOTENCIA_CONFLITANTE', 'chave reutilizada com outro corpo') } };
  }
  if (anterior) return { cache: { status: anterior.status, corpo: anterior.resposta } };
  return { hash };
}

export async function gravarIdempotencia(ctx, chave, hash, status, resposta) {
  if (chave && hash) await ctx.repo.gravarIdempotencia(chave, { hash, status, resposta });
}

/**
 * Atalho das rotas com chave obrigatoria: devolve a resposta pronta quando
 * ha bloqueio ou cache, e `null` quando e para seguir.
 */
export function respostaDeIdempotencia(idem) {
  if (idem.bloqueado) return idem.bloqueado;
  if (idem.cache) return idem.cache;
  return null;
}
