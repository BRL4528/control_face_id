// Rotas /efrat/rh/* que nao entram no gate usuario+chave (AUTH.RH cuida do
// resto). Um arquivo por area, como o LEIA-ME pede.

// POST /efrat/rh/sal — o sal e as iteracoes de PBKDF2, antes do login.
//
// docs/fase3-contrato.md nao documenta esta rota (achado do mapeamento
// T-D3DC5C, ambiguidade 3). O servidor falso tem UM usuario de RH fixo e
// devolve o sal dele sem checar `usuario` nenhum -- mas js/api.js:55 manda
// `usuario` no corpo mesmo assim, entao a API real precisa resolver por ele.
// Usuario desconhecido devolve o MESMO erro generico de credencial invalida
// que o resto do fluxo de RH usa, nunca "usuario nao encontrado" -- isso
// viraria oraculo de enumeracao, o mesmo padrao ja usado em
// CODIGO_NAO_ENCONTRADO/CONVITE_INVALIDO no resto do contrato. Extensao
// sinalizada ao Orquestrador junto do mapa, nao decisao silenciosa.
export async function obterSal(ctx, req) {
  const usuario = await ctx.repo.lerUsuarioRh(req.corpo.usuario);
  if (!usuario) return { status: 401, corpo: { ok: false, erro: 'usuario ou senha invalidos' } };
  return { status: 200, corpo: { ok: true, sal: usuario.sal, iteracoes: usuario.iteracoes } };
}
