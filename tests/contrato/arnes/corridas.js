// AS DUAS CORRIDAS. Este arquivo é o instrumento; ele não sabe contra QUEM
// mede. Recebe um alvo (base HTTP + sondas de leitura no banco) e devolve um
// veredito estruturado. É por isso que o MESMO código mede a API de referência
// hoje e vai medir as rotas do API-4 amanhã, sem reescrever uma asserção.
//
// ---------------------------------------------------------------------------
// POR QUE CADA CORRIDA CONFERE DUAS COISAS, E NÃO UMA
// ---------------------------------------------------------------------------
// Um teste que só conta LINHAS NO BANCO aprova a implementação que tem índice
// único e código ler-depois-gravar: o índice segura o dado, mas o perdedor da
// corrida leva violação de unicidade -> 500. E 500 não é `duplicado`: o
// aparelho não tira a marcação da fila e reenvia para sempre.
//
// Um teste que só confere RESPOSTAS aprova a implementação sem índice nenhum
// que responde 'aceito' duas vezes com ar de normalidade -- e grava o ponto
// duas vezes.
//
// As duas juntas, sempre. Cada uma sozinha tem um cego que a outra enxerga.
//
// ---------------------------------------------------------------------------
// POR QUE VÁRIAS RODADAS
// ---------------------------------------------------------------------------
// Corrida é probabilística. Uma rodada só pode dar sorte nos dois sentidos:
// o ingênuo pode escapar, e aí o teste vira intermitente-verde, que é pior
// que vermelho. Rodadas repetidas com chaves diferentes transformam "aconteceu"
// em taxa observada -- e é a taxa que a calibração reporta.
const RODADAS_PADRAO = 5;
const SIMULTANEAS_PADRAO = 8;

/** Dispara N requisições e devolve as respostas na ordem em que foram criadas. */
async function emParalelo(n, fazer) {
  // Todas as promessas são criadas ANTES de qualquer await: é isso que faz o
  // Node escrever as N requisições no socket antes de processar a primeira
  // resposta, e é o que aproxima as chegadas no servidor.
  return Promise.all(Array.from({ length: n }, (_, i) => fazer(i)));
}

async function lerJson(resp) {
  const texto = await resp.text();
  try { return JSON.parse(texto); } catch { return { __naoJson: texto.slice(0, 200) }; }
}

/**
 * ALVO 1 — marcação duplicada sob concorrência real.
 * Mesmo `id_cliente`, N requisições simultâneas.
 *
 * Contrato: exatamente um `aceito`, o resto `duplicado`, e UMA linha no banco.
 */
export async function corridaMarcacao(alvo, { rodadas = RODADAS_PADRAO, simultaneas = SIMULTANEAS_PADRAO } = {}) {
  const quebras = [];

  for (let r = 0; r < rodadas; r++) {
    const idCliente = `corrida-marc-${Date.now().toString(36)}-${r}-${Math.random().toString(36).slice(2, 8)}`;
    const marcacao = {
      id_cliente: idCliente,
      pessoa_id: alvo.pessoaSemeada,
      marcado_em: new Date().toISOString()
    };

    const respostas = await emParalelo(simultaneas, async () => {
      const resp = await fetch(`${alvo.base}/webhook/efrat/marcacoes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dispositivo_id: alvo.dispositivoSemeado, marcacoes: [marcacao] })
      });
      return { status: resp.status, corpo: await lerJson(resp) };
    });

    const itens = respostas.map(x => {
      const item = x.corpo && Array.isArray(x.corpo.resultados) ? x.corpo.resultados[0] : null;
      return { http: x.status, status: item ? item.status : `http_${x.status}` };
    });

    const aceitos = itens.filter(i => i.status === 'aceito').length;
    const duplicados = itens.filter(i => i.status === 'duplicado').length;
    const outros = itens.filter(i => i.status !== 'aceito' && i.status !== 'duplicado');
    const linhas = await alvo.contarMarcacoes(idCliente);

    const falhas = [];
    if (aceitos !== 1) falhas.push(`aceitos=${aceitos} (contrato: 1)`);
    if (duplicados !== simultaneas - 1) falhas.push(`duplicados=${duplicados} (contrato: ${simultaneas - 1})`);
    if (outros.length) falhas.push(`respostas fora do contrato: ${JSON.stringify(outros.slice(0, 3))}`);
    if (linhas !== 1) falhas.push(`linhas gravadas=${linhas} (contrato: 1) <- ponto batido ${linhas}x`);

    if (falhas.length) quebras.push({ rodada: r, idCliente, falhas, aceitos, duplicados, linhas });
  }

  return {
    alvo: 'marcacao-duplicada',
    rodadas, simultaneas,
    quebrou: quebras.length > 0,
    rodadasQuebradas: quebras.length,
    quebras
  };
}

/**
 * ALVO 2 — convite consumido duas vezes em paralelo. Ameaça 1.3.
 * Mesmo token, N requisições simultâneas.
 *
 * Contrato: exatamente um 200 `recebido`, o resto 409 CONVITE_CONSUMIDO, e UM
 * template gravado. Uso único só vale sob corrida: sequencial, qualquer
 * implementação acerta.
 */
export async function corridaConvite(alvo, { rodadas = RODADAS_PADRAO, simultaneas = SIMULTANEAS_PADRAO } = {}) {
  const quebras = [];

  for (let r = 0; r < rodadas; r++) {
    const { conviteId, token } = await alvo.semearConviteAberto();

    const respostas = await emParalelo(simultaneas, async () => {
      const resp = await fetch(`${alvo.base}/webhook/efrat/face/convite/enviar`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ modelo_id: 'modelo-arnes', vetores: [], miniatura: '' })
      });
      return { status: resp.status, corpo: await lerJson(resp) };
    });

    const recebidos = respostas.filter(x => x.status === 200 && x.corpo && x.corpo.estado === 'recebido').length;
    const consumidos = respostas.filter(x =>
      x.status === 409 && x.corpo && x.corpo.erro && x.corpo.erro.codigo === 'CONVITE_CONSUMIDO').length;
    const outros = respostas
      .filter(x => !(x.status === 200 && x.corpo && x.corpo.estado === 'recebido')
                && !(x.status === 409 && x.corpo && x.corpo.erro && x.corpo.erro.codigo === 'CONVITE_CONSUMIDO'))
      .map(x => ({ http: x.status, codigo: x.corpo && x.corpo.erro && x.corpo.erro.codigo }));

    const templates = await alvo.contarRecadastros(conviteId);

    const falhas = [];
    if (recebidos !== 1) falhas.push(`recebidos=${recebidos} (contrato: 1)`);
    if (consumidos !== simultaneas - 1) falhas.push(`CONVITE_CONSUMIDO=${consumidos} (contrato: ${simultaneas - 1})`);
    if (outros.length) falhas.push(`respostas fora do contrato: ${JSON.stringify(outros.slice(0, 3))}`);
    if (templates !== 1) falhas.push(`templates gravados=${templates} (contrato: 1) <- ameaca 1.3 viva`);

    if (falhas.length) quebras.push({ rodada: r, conviteId, falhas, recebidos, consumidos, templates });
  }

  return {
    alvo: 'convite-uso-unico',
    rodadas, simultaneas,
    quebrou: quebras.length > 0,
    rodadasQuebradas: quebras.length,
    quebras
  };
}

/** Texto legível para relatório e para mensagem de falha de teste. */
export function relatar(v) {
  const cabeca = `${v.alvo}: ${v.rodadasQuebradas}/${v.rodadas} rodadas quebradas (${v.simultaneas} simultaneas)`;
  if (!v.quebrou) return cabeca + ' — contrato mantido em todas.';
  const detalhe = v.quebras.slice(0, 3)
    .map(q => `  rodada ${q.rodada}: ` + q.falhas.join(' | '))
    .join('\n');
  return cabeca + '\n' + detalhe;
}

/**
 * ALVO 3 — duas telas de RH aprovando o MESMO codigo ao mesmo tempo.
 * Prova de posse fisica de uso unico (§1.3). Esta nas 8 rotas do teste.
 *
 * A assercao decisiva NAO e contagem — o aparelho e um so em qualquer caso.
 * E COERENCIA: o escopo e o operador PERSISTIDOS tem de pertencer a quem
 * recebeu o 200. Quando duas telas ganham, uma pessoa e informada de que
 * liberou o aparelho para a equipe dela e nao liberou; e a auditoria passa a
 * ter duas respostas para "quem deixou este aparelho entrar".
 */
export async function corridaAprovacao(alvo, { rodadas = RODADAS_PADRAO, simultaneas = SIMULTANEAS_PADRAO } = {}) {
  const quebras = [];

  for (let r = 0; r < rodadas; r++) {
    const { dispositivoId, codigo } = await alvo.semearAparelhoPendente();

    // Cada tela manda o SEU escopo e o SEU usuario. E o que torna visivel
    // "quem ganhou de fato" versus "quem foi informado que ganhou".
    const respostas = await emParalelo(simultaneas, async (i) => {
      const resp = await fetch(`${alvo.base}/webhook/efrat/rh/aparelho/aprovar`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ codigo, usuario: `rh-${i}`, equipes_ids: [`eq-${i}`] })
      });
      return { usuario: `rh-${i}`, equipe: `eq-${i}`, status: resp.status, corpo: await lerJson(resp) };
    });

    const ganhadores = respostas.filter(x => x.status === 200 && x.corpo && x.corpo.ok === true);
    const recusados = respostas.filter(x =>
      x.status === 404 && x.corpo && x.corpo.erro && x.corpo.erro.codigo === 'CODIGO_NAO_ENCONTRADO').length;
    const outros = respostas
      .filter(x => !(x.status === 200 && x.corpo && x.corpo.ok === true)
                && !(x.status === 404 && x.corpo && x.corpo.erro && x.corpo.erro.codigo === 'CODIGO_NAO_ENCONTRADO'))
      .map(x => ({ http: x.status, codigo: x.corpo && x.corpo.erro && x.corpo.erro.codigo }));

    const gravado = await alvo.lerAparelho(dispositivoId);

    const falhas = [];
    if (ganhadores.length !== 1) falhas.push(`aprovacoes bem-sucedidas=${ganhadores.length} (contrato: 1) <- prova de posse de uso unico usada ${ganhadores.length}x`);
    if (recusados !== simultaneas - 1) falhas.push(`CODIGO_NAO_ENCONTRADO=${recusados} (contrato: ${simultaneas - 1})`);
    if (outros.length) falhas.push(`respostas fora do contrato: ${JSON.stringify(outros.slice(0, 3))}`);
    if (!gravado || gravado.estado !== 'ativo') falhas.push(`estado gravado=${gravado && gravado.estado} (contrato: ativo)`);

    // A coerencia. Só é conferível quando houve exatamente um ganhador; com
    // mais de um a falha já foi registrada acima, e apontar "o escopo é do
    // outro" seria contar duas vezes o mesmo defeito.
    if (ganhadores.length === 1 && gravado) {
      const g = ganhadores[0];
      if (gravado.aprovado_por !== g.usuario) {
        falhas.push(`aprovado_por gravado=${gravado.aprovado_por} mas quem recebeu 200 foi ${g.usuario} <- o servidor mentiu para o operador`);
      }
      const escopo = Array.isArray(gravado.equipes_ids) ? gravado.equipes_ids.join(',') : String(gravado.equipes_ids);
      if (escopo !== g.equipe) {
        falhas.push(`equipes_ids gravado=[${escopo}] mas quem recebeu 200 pediu [${g.equipe}] <- aparelho ficou com escopo que ninguem confirmou`);
      }
    }

    if (falhas.length) quebras.push({ rodada: r, dispositivoId, falhas, ganhadores: ganhadores.length });
  }

  return {
    alvo: 'aprovacao-uso-unico',
    rodadas, simultaneas,
    quebrou: quebras.length > 0,
    rodadasQuebradas: quebras.length,
    quebras
  };
}
