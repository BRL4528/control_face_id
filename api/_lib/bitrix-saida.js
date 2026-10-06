// Ponto → Bitrix24 (único write-back da integração): a decisão do RH vira um
// comentário na timeline do card do colaborador no pipeline "Gerenciamento de
// Equipe". Quem fala com o Bitrix é o n8n (tem o OAuth do portal): aqui só
// avisamos o webhook do workflow "Ponto ⇒ Bitrix (decisão do RH no card)".
// Melhor esforço: a decisão já está gravada em `correcao`, então falha aqui
// (webhook ausente, n8n fora) só é logada e nunca derruba a resposta.
//
// BITRIX_DECISAO_WEBHOOK_URL = URL de produção do webhook do workflow no n8n.
export async function comentarNoCard(colab, texto) {
  const url = process.env.BITRIX_DECISAO_WEBHOOK_URL;
  if (!url || !colab || !colab.bitrix_card_id) return false;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ card_id: colab.bitrix_card_id, texto }),
      signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) { console.error('n8n decisao->bitrix falhou', r.status); return false; }
    return true;
  } catch (e) {
    console.error('n8n decisao->bitrix falhou', e && e.message);
    return false;
  }
}
