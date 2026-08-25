// Cadastro de biometria de face pelo painel do RH. docs/fase3-contrato.md
// §4.3+§4.7 (T-8ADD9C/T-65D806).

import * as dominio from '../dominio.js';
import { erroDe, idempotencia, gravarIdempotencia, respostaDeIdempotencia } from '../contexto.js';

// POST /efrat/rh/face/cadastrar — camera do PC (origem rh_camera, grava
// direto) ou upload (origem rh_upload, vai pra fila humana). A rota antiga
// /efrat/cadastro continua existindo so para o aparelho de campo (origem
// "gestor") -- nao migra aqui, T-D3DC5C nao a lista no primeiro turno.
export async function cadastrar(ctx, req) {
  const erro = erroDe(ctx.cripto);
  const b = req.corpo;
  const idem = await idempotencia(ctx, b.idempotency_key, b, true);
  const pronta = respostaDeIdempotencia(idem);
  if (pronta) return pronta;

  const pessoa = await ctx.repo.lerPessoa(b.pessoa_id);
  if (!pessoa) return { status: 404, corpo: { ok: false, erro: 'pessoa nao encontrada' } };

  // §4.7, C2: modelo_id e OBRIGATORIO nas rotas novas -- so a rota antiga
  // (/efrat/cadastro, cliente de campo nao atualizado) tolera ausencia.
  if (!b.modelo_id) return { status: 400, corpo: erro('MODELO_AUSENTE', 'modelo_id é obrigatório nesta rota') };

  // Mesma funcao pura de qualquer caminho de cadastro -- copia propria e como
  // o bug de T-8ADD9C so mudaria de lugar (nucleo/LEIA-ME.md).
  const avaliacao = dominio.avaliarLoteFace(b.vetores, ctx.cfg.limiarAceite);
  if (!avaliacao.ok) {
    return { status: 422, corpo: {
      ok: false,
      erro: { codigo: avaliacao.codigo, mensagem: avaliacao.mensagem, maior_distancia: avaliacao.maiorDistancia }
    } };
  }

  // Classifica ANTES de registrar a observacao (dominio.classificarModelo),
  // senao "conhecido" seria sempre verdadeiro por causa do proprio registro
  // que acabou de acontecer.
  const referenciaAnterior = await ctx.repo.lerReferenciaModeloApp();
  const jaConhecido = await ctx.repo.modeloJaObservado(b.modelo_id);
  const classificado = dominio.classificarModelo(b.modelo_id, referenciaAnterior, jaConhecido);
  // origemObservada 'app' preservado literal do servidor falso para as duas
  // rotas de cadastro (esta e /efrat/cadastro) -- nao e a origem do dado
  // (camera/upload/campo), e o rotulo que a observacao de modelo usa la.
  // Nao "consertar" a nomenclatura sem perguntar: nao e meu para decidir.
  await ctx.repo.registrarModeloObservado(b.modelo_id, 'app', req.agoraIso);

  const origem = b.origem === 'rh_upload' ? 'rh_upload' : 'rh_camera';
  const versaoNova = (pessoa.versao || 0) + 1;
  const camposModelo = {
    modelo_id: b.modelo_id, modelo_divergente: classificado.modelo_divergente,
    modelo_desconhecido: classificado.modelo_desconhecido
  };
  const estadoTemplate = origem === 'rh_camera' ? 'ativo' : 'pendente';

  if (estadoTemplate === 'ativo') {
    // Camera do PC: RH esta vendo a pessoa ali -- grava direto (§4.3, captura
    // ao vivo supervisionada). Sem invariante de versao: template biometrico
    // nao disputa versao_cadastro com edicao de dados (repositorio.js).
    await ctx.repo.atualizarPessoa(pessoa.pessoa_id, Object.assign({
      versao: versaoNova, vetores: b.vetores, miniatura: b.miniatura || pessoa.miniatura,
      origem, coerencia: avaliacao.maiorDistancia, criado_em: req.agoraIso
    }, camposModelo));
  } else {
    // Upload: ninguem viu a captura acontecer -- nunca sobrescreve o
    // template vigente, vai para a fila humana do RH.
    await ctx.repo.inserirRecadastro(Object.assign({
      template_id: 't-' + pessoa.pessoa_id, pessoa_id: pessoa.pessoa_id, versao: versaoNova,
      coerencia: avaliacao.maiorDistancia, miniatura: b.miniatura || '',
      vetores: b.vetores, origem, criado_em: req.agoraIso
    }, camposModelo));
  }

  const resposta = Object.assign({
    ok: true, pessoa_id: pessoa.pessoa_id, template_id: 't-' + pessoa.pessoa_id,
    versao: versaoNova, estado: estadoTemplate, coerencia: avaliacao.maiorDistancia,
    request_id: ctx.cripto.uuid()
  }, camposModelo);
  await gravarIdempotencia(ctx, b.idempotency_key, idem.hash, 200, resposta);
  return { status: 200, corpo: resposta };
}
