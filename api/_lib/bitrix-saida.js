// Ponto → Bitrix24 (único write-back da integração): a decisão do RH vira um
// comentário na timeline do card do colaborador no pipeline "Gerenciamento de
// Equipe". Quem fala com o Bitrix é o n8n (tem o OAuth do portal): aqui só
// avisamos o webhook do workflow "Ponto ⇒ Bitrix (decisão do RH no card)".
// Melhor esforço: a decisão já está gravada em `correcao`, então falha aqui
// (webhook ausente, n8n fora) só é logada e nunca derruba a resposta.
//
// BITRIX_DECISAO_WEBHOOK_URL = URL de produção do webhook do workflow no n8n.
const MOTIVOS = { fora_da_cerca: 'fora da cerca', sem_alocacao: 'sem alocação no dia', sem_liveness: 'sem prova de vida' };

/**
 * Texto do comentário (BBCode do Bitrix): decisão + dados do registro decidido,
 * o suficiente para a auditoria rastrear a marcação/cadastro no Ponto. Pura.
 */
export function montarComentario({ tipo, acao, decisao, rh, alvoId, alvo, fuso, agora = new Date() }) {
  const quando = (d) => {
    try { return new Intl.DateTimeFormat('pt-BR', { timeZone: fuso || 'America/Campo_Grande', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(d)); }
    catch { return new Date(d).toISOString(); }
  };
  const a = alvo || {};
  const l = [];
  l.push(`[B]Decisão do RH: ${acao === 'rejeitar' ? 'REJEITADO' : 'APROVADO'}[/B] — ${tipo === 'template' ? 'cadastro facial' : 'marcação de ponto'}`);
  l.push(`[B]Decisão:[/B] ${decisao}`);
  l.push(`[B]Decidido por:[/B] ${rh} em ${quando(agora)}`);
  if (tipo === 'template') {
    l.push(`[B]Cadastro facial:[/B] versão ${a.versao}${a.origem ? ' · origem ' + a.origem : ''}${a.criado_em ? ' · enviado em ' + quando(a.criado_em) : ''}`);
  } else {
    l.push(`[B]Registro:[/B] ${a.tipo === 'saida' ? 'Saída' : 'Entrada'} em ${a.marcado_em ? quando(a.marcado_em) : '—'}${a.origem === 'manual' ? ' (lançamento manual)' : ''}${a.equipe ? ' · equipe ' + a.equipe : ''}`);
    const rev = a.motivo_revisao && (MOTIVOS[a.motivo_revisao] || a.motivo_revisao);
    l.push(`[B]Motivo da revisão:[/B] ${rev || (a.veredito === 'revisar' ? 'rosto em dúvida' : '—')}`);
    const cerca = a.dentro_cerca === true ? 'dentro da cerca' : a.dentro_cerca === false ? 'fora da cerca' : 'sem cerca definida';
    l.push(`[B]Local:[/B] ${cerca}${a.distancia_cerca_m != null ? ' (' + a.distancia_cerca_m + ' m do centro)' : ''}${a.lat != null ? ' · GPS ' + Number(a.lat).toFixed(5) + ', ' + Number(a.lng).toFixed(5) + (a.precisao_m ? ' ±' + Math.round(a.precisao_m) + ' m' : '') : ' · sem GPS'}`);
    if (a.liveness_ok === false) l.push('[B]Prova de vida:[/B] não passou');
  }
  l.push(`[B]ID no Ponto:[/B] ${alvoId}`);
  return l.join('\n');
}

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
