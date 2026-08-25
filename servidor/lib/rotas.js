// Carrega a tabela de rotas do nucleo, se ela ja existir.
//
// Existe separado para que /api/saude e /api/roteador facam a MESMA pergunta
// pelo MESMO caminho. Saude que conta rotas de um jeito e roteador que as
// resolve de outro e como uma saude fica verde com o roteador vazio — que foi
// exatamente o defeito de hoje, uma camada acima.

export async function carregarRotas() {
  try {
    const mod = await import('../nucleo/rotas.js');
    const tabela = mod.ROTAS || (typeof mod.criarRotas === 'function' ? mod.criarRotas() : null);
    if (!Array.isArray(tabela) || !tabela.length) {
      return { roteador: null, erro: 'nucleo/rotas.js existe mas nao exporta ROTAS nem criarRotas()' };
    }
    const { criarRoteador } = await import('../nucleo/http.js');
    return { roteador: criarRoteador(tabela), erro: null };
  } catch (e) {
    return { roteador: null, erro: String(e && e.message).slice(0, 120) };
  }
}
