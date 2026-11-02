// Relatório de inconsistências: junta o que precisa de atenção no período por CAUSA
// (não batida a batida), explica em linguagem simples e sugere a ação. Os padrões
// saem dos mesmos dados do painel: marcações com GPS e rosto, o relatório de horas
// (horasPorColaborador), os aparelhos pendentes e os avisos da integração Bitrix.
//
// Pura: sem DOM e sem rede. O painel chama `inconsistencias(...)` e mostra/exporta
// os grupos com `htmlRelatorio` (PDF pela janela de impressão) e `linhasCsv`.
import { horaNoFuso, fmtMinutos } from './regras.js';

export const SEVERIDADE = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };
const ORDEM_SEV = { alta: 0, media: 1, baixa: 2 };

const R_TERRA = 6371000;
function metros(lat1, lng1, lat2, lng2) {
  const rad = x => x * Math.PI / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * R_TERRA * Math.asin(Math.sqrt(a));
}
const km = m => (m / 1000).toFixed(m < 10000 ? 1 : 0).replace('.', ',') + ' km';
const dm = d => d ? d.slice(8, 10) + '/' + d.slice(5, 7) : '';
const minDoDia = (iso, fuso) => { const [h, m] = horaNoFuso(iso, fuso).split(':').map(Number); return h * 60 + m; };
const plural = (n, um, varios) => n + ' ' + (n === 1 ? um : varios);

/**
 * Grupos de inconsistências do período.
 *
 * marcacoes: as do período, com { id_cliente, pessoa_id, equipe_id, tipo, origem, marcado_em,
 *   marcado_dia, estado ('aceita'|'pendente'|'rejeitada'), lat, lng, dentro_cerca,
 *   distancia_cerca_m, score, liveness_ok }
 * linhas: saída de horasPorColaborador no mesmo período.
 * pessoas, equipes, locais: do painel. aparelhos: aparelhos_pendentes (com sugestoes).
 * avisosBitrix: config.integracao_bitrix.avisos. cfg: { limiarAceite }.
 * hoje: 'YYYY-MM-DD' no fuso da empresa. fuso: o da empresa.
 *
 * Devolve [{ chave, titulo, severidade, explicacao, acao, itens: [{ pessoa, equipe, dia, detalhe }] }],
 * da mais grave para a mais leve.
 */
export function inconsistencias({ marcacoes = [], linhas = [], pessoas = [], equipes = [], locais = [], aparelhos = [],
  avisosBitrix = [], cfg = {}, hoje, fuso } = {}) {
  const pessoa = id => pessoas.find(p => p.pessoa_id === id) || {};
  const equipe = id => equipes.find(e => e.equipe_id === id) || {};
  const nomeEq = id => equipe(id).nome || 'Sem equipe';
  const localDaEquipe = id => { const e = equipe(id); return e.local_id ? locais.find(l => l.local_id === e.local_id) : null; };
  const aceite = Number(cfg.limiarAceite) || 0.45;
  const validas = marcacoes.filter(m => m.estado !== 'rejeitada' && m.pessoa_id);
  const grupos = [];
  const grupo = (chave, titulo, severidade, explicacao, acao, itens, extra) => {
    if (itens.length) grupos.push(Object.assign({ chave, titulo, severidade, explicacao, acao, itens }, extra || {}));
  };
  const item = (m, detalhe) => ({ pessoa: pessoa(m.pessoa_id).nome || '', equipe: nomeEq(m.equipe_id), dia: m.marcado_dia, detalhe });

  /* ---- 1. Lugar fora das cercas usado com frequência: a cerca da obra está no lugar
     errado ou a turma está trabalhando noutro lugar. Agrupa por região (até 10 km da
     1ª batida do aglomerado), juntando pessoas de equipes diferentes que estão lá. */
  const fora = validas.filter(m => m.dentro_cerca === false && m.lat != null && m.lng != null);
  const usadas = new Set();
  const aglos = [];
  for (const m of fora) {
    const a = aglos.find(x => metros(x.lat, x.lng, m.lat, m.lng) <= 10000);
    if (a) a.ms.push(m); else aglos.push({ lat: m.lat, lng: m.lng, ms: [m] });
  }
  for (const a of aglos) {
    const quem = new Set(a.ms.map(m => m.pessoa_id));
    const dias = new Set(a.ms.map(m => m.marcado_dia));
    if (quem.size < 2 || dias.size < 2 || a.ms.length < 6) continue;
    // Equipe dominante: a de mais batidas no lugar.
    const cont = new Map();
    a.ms.forEach(m => cont.set(m.equipe_id, (cont.get(m.equipe_id) || 0) + 1));
    const eqId = [...cont].sort((x, y) => y[1] - x[1])[0][0];
    const loc = localDaEquipe(eqId);
    const longe = loc ? metros(loc.lat, loc.lng, a.lat, a.lng) : null;
    a.ms.forEach(m => usadas.add(m));
    const outras = [...cont.keys()].filter(id => id !== eqId).map(nomeEq);
    grupos.push({
      chave: 'cerca_errada', severidade: 'alta',
      titulo: nomeEq(eqId) + ': batidas sempre no mesmo lugar, longe da cerca',
      explicacao: plural(quem.size, 'pessoa', 'pessoas') + ' bateram ' + plural(a.ms.length, 'vez', 'vezes') + ' em ' + plural(dias.size, 'dia', 'dias') +
        ' perto de ' + a.lat.toFixed(4) + ', ' + a.lng.toFixed(4) + (longe != null ? ', a ' + km(longe) + ' do local cadastrado da equipe' : '') +
        (outras.length ? '. Junto, gente de ' + outras.join(', ') : '') + '. Ou a cerca da obra está no lugar errado, ou a turma está trabalhando em outro lugar.',
      acao: 'Confirme onde a turma está trabalhando: ajuste o local da equipe ou crie uma escala para o outro lugar. Depois decida as batidas em Pendências.',
      equipe_id: eqId, lat: a.lat, lng: a.lng,
      itens: [...quem].map(pid => {
        const dele = a.ms.filter(m => m.pessoa_id === pid);
        const ds = [...new Set(dele.map(m => m.marcado_dia))].sort();
        return { pessoa: pessoa(pid).nome || '', equipe: nomeEq(dele[0].equipe_id), dia: ds[0],
          detalhe: plural(dele.length, 'batida', 'batidas') + ' de ' + dm(ds[0]) + ' a ' + dm(ds[ds.length - 1]) + (dele.some(m => m.estado === 'pendente') ? ' · há pendentes' : '') };
      }).sort((x, y) => x.pessoa.localeCompare(y.pessoa))
    });
  }

  /* ---- 2. Fora da cerca, isolado (o que não entrou num aglomerado acima). */
  grupo('fora_cerca', 'Batida fora da cerca aguardando decisão', 'media',
    'Batidas longe do local da equipe que não seguem um padrão da equipe: pode ser viagem, serviço externo ou ponto batido de outro lugar.',
    'Confira com a pessoa ou o encarregado e aprove ou rejeite em Pendências.',
    fora.filter(m => !usadas.has(m) && m.estado === 'pendente').map(m => item(m, horaNoFuso(m.marcado_em, fuso) + ' · ' +
      (m.distancia_cerca_m != null ? km(Number(m.distancia_cerca_m)) + ' do centro' : 'fora da área'))));

  /* ---- 3. Sem GPS. */
  grupo('sem_gps', 'Batida sem localização aguardando decisão', 'media',
    'O celular não mandou o GPS: não dá para saber onde a pessoa estava.',
    'Peça para a pessoa liberar a localização do navegador. Decida a batida em Pendências.',
    validas.filter(m => m.origem !== 'manual' && m.lat == null && m.estado === 'pendente').map(m => item(m, horaNoFuso(m.marcado_em, fuso))));

  /* ---- 4. Cadastro facial fraco: muitas batidas na zona cinzenta. */
  const porPessoa = (filtro) => {
    const mp = new Map();
    for (const m of validas.filter(filtro)) { if (!mp.has(m.pessoa_id)) mp.set(m.pessoa_id, []); mp.get(m.pessoa_id).push(m); }
    return mp;
  };
  const cinza = porPessoa(m => m.origem !== 'manual' && m.score != null && Number(m.score) > aceite);
  grupo('cadastro_fraco', 'Cadastro facial fraco', 'media',
    'O rosto da pessoa fica repetidamente acima do limite de aceite: o cadastro facial provavelmente foi feito com luz ruim ou de lado.',
    'Refaça o cadastro facial da pessoa (Colaboradores, ficha da pessoa) com boa luz e de frente.',
    [...cinza].filter(([, ms]) => ms.length >= 3).map(([pid, ms]) => ({
      pessoa: pessoa(pid).nome || '', equipe: nomeEq(ms[0].equipe_id), dia: ms[0].marcado_dia,
      detalhe: plural(ms.length, 'batida', 'batidas') + ' na zona cinzenta · pior distância ' + Math.max(...ms.map(m => Number(m.score))).toFixed(2).replace('.', ',')
    })));

  /* ---- 5. Prova de vida falhando sempre com a mesma pessoa. */
  const semVida = porPessoa(m => m.origem !== 'manual' && m.liveness_ok === false);
  grupo('prova_vida', 'Prova de vida falhando', 'baixa',
    'A pessoa não passa na prova de vida (girar o rosto) com frequência.',
    'Mostre para a pessoa como girar o rosto devagar para um lado e voltar. Se continuar, avise o suporte.',
    [...semVida].filter(([, ms]) => ms.length >= 3).map(([pid, ms]) => ({
      pessoa: pessoa(pid).nome || '', equipe: nomeEq(ms[0].equipe_id), dia: ms[0].marcado_dia, detalhe: plural(ms.length, 'batida', 'batidas') + ' sem prova de vida'
    })));

  /* ---- 6. Pendência parada. */
  const pend = porPessoa(m => m.estado === 'pendente' && hoje && m.marcado_dia <= somaDias(hoje, -3));
  grupo('pendencia_antiga', 'Pendência parada há mais de 3 dias', 'alta',
    'Batidas que ainda esperam decisão do RH. Enquanto não forem decididas, a folha de ponto sai com o dia "a confirmar".',
    'Decida em Pendências.',
    [...pend].map(([pid, ms]) => {
      const ds = ms.map(m => m.marcado_dia).sort();
      return { pessoa: pessoa(pid).nome || '', equipe: nomeEq(ms[0].equipe_id), dia: ds[0], detalhe: plural(ms.length, 'batida', 'batidas') + ' · mais antiga de ' + dm(ds[0]) };
    }));

  /* ---- 7 a 9. Pelo relatório de horas: sem batida, faltas, dia incompleto. */
  const semBatida = [], faltas = [], incompletos = [], conflitos = [];
  for (const l of linhas) {
    const eqId = (pessoa(l.pessoa_id).equipe_id) || null;
    const dias = l.dias || [];
    const f = dias.filter(d => d.status === 'falta');
    if (!l.totais.dias && f.length >= 3) semBatida.push({ pessoa: l.nome, equipe: nomeEq(eqId), dia: f[0].dia, detalhe: plural(f.length, 'falta', 'faltas') + ' e nenhuma batida' });
    else if (f.length) faltas.push({ pessoa: l.nome, equipe: nomeEq(eqId), dia: f[0].dia, detalhe: plural(f.length, 'falta', 'faltas') + ': ' + f.map(d => dm(d.dia)).join(', ') });
    for (const d of dias.filter(d => d.status === 'incompleto')) incompletos.push({ pessoa: l.nome, equipe: nomeEq(d.equipe_id || eqId), dia: d.dia, detalhe: plural(d.marcacoes, 'batida', 'batidas') + ' no dia' });
    for (const d of dias.filter(d => d.conflito_ocorrencia)) conflitos.push({ pessoa: l.nome, equipe: nomeEq(d.equipe_id || eqId), dia: d.dia, detalhe: 'batida em dia de ' + (d.ocorrencia || 'ocorrência') });
  }
  grupo('sem_batida', 'Pessoa sem nenhuma batida no período', 'alta',
    'Está ativa e com jornada, mas não bateu ponto nenhuma vez. A folha dela sai cheia de falta.',
    'Confirme se a pessoa usa o app, se mudou de equipe ou se deveria estar em afastamento ou férias.',
    semBatida);
  grupo('faltas', 'Faltas', 'media', 'Dias com jornada e sem nenhuma batida nem ocorrência.',
    'Lance a ocorrência (atestado, férias, falta justificada) ou confirme a falta.', faltas);
  grupo('incompleto', 'Dia com batida faltando', 'media',
    'Entrada sem saída (ou o contrário): o dia não fecha e não entra no saldo.',
    'Confirme com a pessoa e lance a batida que faltou no Espelho de ponto.', incompletos);
  grupo('conflito_ocorrencia', 'Batida em dia de ocorrência', 'baixa',
    'A pessoa bateu ponto num dia abonado (férias, atestado...).',
    'Confira se a ocorrência está certa ou se a pessoa trabalhou de fato.', conflitos);

  /* ---- 10 a 13. Regras da CLT (por pessoa e dia, só batidas aceitas). */
  const aceitas = validas.filter(m => m.estado === 'aceita');
  const diaDe = new Map();
  for (const m of aceitas) {
    const k = m.pessoa_id + '|' + m.marcado_dia;
    if (!diaDe.has(k)) diaDe.set(k, []);
    diaDe.get(k).push(m);
  }
  const extra2h = [], dezHoras = [], intervalo = [], interjornada = [];
  for (const l of linhas) {
    for (const d of l.dias || []) {
      if (d.status === 'ok' && d.saldo > 120) extra2h.push({ pessoa: l.nome, equipe: nomeEq(d.equipe_id), dia: d.dia, detalhe: fmtMinutos(d.saldo) + ' de hora extra' });
      if (d.trabalhado > 600) dezHoras.push({ pessoa: l.nome, equipe: nomeEq(d.equipe_id), dia: d.dia, detalhe: fmtMinutos(d.trabalhado) + ' trabalhadas' });
    }
  }
  const ordenadas = [...diaDe.values()].map(ms => ms.slice().sort((a, b) => String(a.marcado_em).localeCompare(String(b.marcado_em))));
  for (const ms of ordenadas) {
    const m0 = ms[0];
    // Intervalo: da 1ª saída à entrada seguinte, em dia com mais de 6 h trabalhadas.
    const iS = ms.findIndex(m => m.tipo === 'saida');
    const linha = linhas.find(l => l.pessoa_id === m0.pessoa_id);
    const d = linha && (linha.dias || []).find(x => x.dia === m0.marcado_dia);
    if (iS > 0 && ms[iS + 1] && ms[iS + 1].tipo === 'entrada' && d && d.trabalhado > 360) {
      const gap = Math.round((Date.parse(ms[iS + 1].marcado_em) - Date.parse(ms[iS].marcado_em)) / 60000);
      if (gap < 60) intervalo.push(item(m0, 'intervalo de ' + gap + ' min (' + horaNoFuso(ms[iS].marcado_em, fuso) + ' às ' + horaNoFuso(ms[iS + 1].marcado_em, fuso) + ')'));
    }
  }
  // Interjornada: última saída de um dia até a 1ª entrada do dia seguinte.
  const porPessoaDia = new Map();
  for (const ms of ordenadas) {
    const pid = ms[0].pessoa_id;
    if (!porPessoaDia.has(pid)) porPessoaDia.set(pid, []);
    porPessoaDia.get(pid).push(ms);
  }
  for (const [, diasP] of porPessoaDia) {
    diasP.sort((a, b) => a[0].marcado_dia.localeCompare(b[0].marcado_dia));
    for (let i = 1; i < diasP.length; i++) {
      const ant = diasP[i - 1], at = diasP[i];
      if (somaDias(ant[0].marcado_dia, 1) !== at[0].marcado_dia) continue;
      const saida = [...ant].reverse().find(m => m.tipo === 'saida');
      const entrada = at.find(m => m.tipo === 'entrada');
      if (!saida || !entrada) continue;
      const h = (Date.parse(entrada.marcado_em) - Date.parse(saida.marcado_em)) / 3600000;
      if (h > 0 && h < 11) interjornada.push(item(entrada, Math.floor(h) + 'h' + String(Math.round((h % 1) * 60)).padStart(2, '0') +
        ' de descanso (saiu ' + dm(saida.marcado_dia) + ' ' + horaNoFuso(saida.marcado_em, fuso) + ', entrou ' + horaNoFuso(entrada.marcado_em, fuso) + ')'));
    }
  }
  grupo('clt_extra', 'Mais de 2 h extras no dia', 'media', 'A CLT (art. 59) limita a hora extra a 2 h por dia.',
    'Confira se houve acordo de compensação ou se a jornada precisa ser revista.', extra2h);
  grupo('clt_10h', 'Jornada acima de 10 h', 'media', 'Dia com mais de 10 h trabalhadas (8 h + 2 h extras).',
    'Confira se as batidas estão certas e se houve necessidade de serviço.', dezHoras);
  grupo('clt_intervalo', 'Intervalo menor que 1 h', 'media', 'Em jornada acima de 6 h, a CLT (art. 71) exige ao menos 1 h de intervalo.',
    'Oriente a pessoa e o encarregado. Intervalo não concedido é pago como extra.', intervalo);
  grupo('clt_interjornada', 'Descanso menor que 11 h entre jornadas', 'media', 'A CLT (art. 66) exige 11 h de descanso entre um dia e outro.',
    'Confira a escala da pessoa. As horas que faltaram de descanso são pagas como extra.', interjornada);

  /* ---- 14. Horário fora do normal (22h às 5h). */
  grupo('madrugada', 'Batida de madrugada', 'baixa', 'Batidas entre 22h e 5h, fora do horário comum das jornadas.',
    'Confira se foi serviço noturno de fato ou batida por engano.',
    validas.filter(m => { const t = minDoDia(m.marcado_em, fuso); return t >= 22 * 60 || t < 5 * 60; })
      .map(m => item(m, horaNoFuso(m.marcado_em, fuso) + (m.estado === 'pendente' ? ' · pendente' : ''))));

  /* ---- 15. Aparelho novo sem identificar. */
  grupo('aparelho', 'Aparelho novo sem identificar', 'alta',
    'Alguém bateu ponto pelo link da empresa num celular novo. As batidas só contam depois que o RH diz quem é.',
    'Em Pendências, confira a foto e identifique a pessoa (o sistema já sugere pelo rosto).',
    aparelhos.map(a => {
      const s = (a.sugestoes || [])[0], p = s ? pessoa(s.colaborador_id) : null;
      const ms = a.marcacoes || [];
      return {
        pessoa: p && p.nome ? 'Parece ser ' + p.nome : a.matricula_informada ? 'Matrícula informada ' + a.matricula_informada : 'Não identificado',
        equipe: '', dia: String(a.pareado_em || '').slice(0, 10),
        detalhe: plural(ms.length, 'batida', 'batidas') + (s ? ' · distância do rosto ' + s.distancia.toFixed(2).replace('.', ',') : '')
      };
    }));

  /* ---- 16. Cadastro no Bitrix. */
  const descAviso = a => a.tipo === 'card_sem_contato' ? 'Card ' + a.card + (a.titulo ? ' "' + a.titulo + '"' : '') + ' sem contato vinculado'
    : a.tipo === 'contato_em_mais_de_um_card' ? 'Contato ' + a.contato + ' está em ' + (a.cards || []).length + ' cards (' + (a.cards || []).join(', ') + ')'
    : String(a.mensagem || a.tipo || 'aviso');
  grupo('bitrix', 'Cadastro no Bitrix', 'baixa', 'Cards do pipeline de equipes que a integração não conseguiu usar.',
    'Corrija no Bitrix: vincule o contato ao card ou feche o card duplicado.',
    (avisosBitrix || []).map(a => ({ pessoa: a.titulo || '', equipe: '', dia: '', detalhe: descAviso(a) })));

  return grupos.sort((a, b) => ORDEM_SEV[a.severidade] - ORDEM_SEV[b.severidade] || b.itens.length - a.itens.length);
}

function somaDias(d, n) {
  const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------ exportação */

const escH = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Linhas do CSV (uma por item), com cabeçalho. */
export function linhasCsv(grupos) {
  return {
    cabecalho: ['Severidade', 'Inconsistência', 'Colaborador', 'Equipe', 'Dia', 'Detalhe', 'Ação sugerida'],
    linhas: grupos.flatMap(g => g.itens.map(i => [SEVERIDADE[g.severidade], g.titulo, i.pessoa, i.equipe, i.dia ? dm(i.dia) + '/' + i.dia.slice(0, 4) : '', i.detalhe, g.acao]))
  };
}

/**
 * Relatório para imprimir/salvar em PDF. Com `timbrado`, a imagem A4 da empresa fica
 * de fundo em toda página (posição fixa repete na impressão) e o texto respeita as
 * margens do rodapé. ctx: { empresa: { nome, razao, cnpj }, de, ate, obra, timbrado, logo, geradoEm }.
 */
export function htmlRelatorio(grupos, ctx) {
  const { empresa = {}, de, ate, obra, timbrado, logo, geradoEm } = ctx || {};
  const total = grupos.reduce((s, g) => s + g.itens.length, 0);
  const cont = sev => grupos.filter(g => g.severidade === sev).reduce((s, g) => s + g.itens.length, 0);
  const periodo = (de ? dm(de) + '/' + de.slice(0, 4) : '') + ' a ' + (ate ? dm(ate) + '/' + ate.slice(0, 4) : '');
  const css = `
@page { size: A4; margin: 0 }
* { box-sizing: border-box }
body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 8.4pt; background: #e5e7eb }
.barra { position: sticky; top: 0; z-index: 5; display: flex; gap: 12px; align-items: center; justify-content: center;
  padding: 10px; background: #0f172a; color: #fff; font-size: 14px }
.barra button { font: inherit; padding: 8px 16px; border: 0; border-radius: 8px; background: #2563eb; color: #fff; cursor: pointer }
.folha { width: 210mm; margin: 12px auto; background: #fff; padding: 14mm 13mm; box-shadow: 0 2px 10px rgba(0,0,0,.15) }
.fundo { display: none }
.cab { display: flex; align-items: center; gap: 5mm; margin-bottom: 4mm }
.cab img { height: 14mm; width: auto }
.cab .emp { flex: 1; text-align: center; font-weight: 700; font-size: 9pt; line-height: 1.5 }
.meta { display: flex; gap: 6mm; flex-wrap: wrap; font-size: 8pt; margin-bottom: 3mm }
.chips { display: flex; gap: 3mm; margin: 2mm 0 5mm }
.chip { border: 0.3mm solid #cbd5e1; border-radius: 2mm; padding: 1.5mm 3mm; font-size: 8pt }
.chip b { font-size: 11pt; display: block }
.alta b { color: #b42318 } .media b { color: #b45309 } .baixa b { color: #475569 }
.grupo { margin-bottom: 5mm; break-inside: auto }
.grupo h2 { font-size: 9.5pt; margin: 0 0 1mm; display: flex; gap: 2mm; align-items: baseline }
.sev { font-size: 7pt; font-weight: 700; padding: 0.4mm 1.6mm; border-radius: 1mm; color: #fff }
.sev.alta { background: #b42318 } .sev.media { background: #d97706 } .sev.baixa { background: #64748b }
.exp { margin: 0 0 1mm; color: #334155 }
.acao { margin: 0 0 1.5mm; color: #0f172a } .acao b { font-weight: 700 }
table { width: 100%; border-collapse: collapse; font-size: 7.6pt }
thead { display: table-header-group }
tr { break-inside: avoid }
th { background: #e2e8f0; text-align: left; padding: 1mm 1.4mm; border: 0.2mm solid #cbd5e1 }
td { padding: 0.9mm 1.4mm; border: 0.2mm solid #e2e8f0; vertical-align: top }
.vazio { padding: 8mm; text-align: center; color: #166534; font-size: 10pt }
.moldura { width: 100%; border-collapse: collapse; font-size: inherit }
.moldura > thead > tr > td, .moldura > tfoot > tr > td, .moldura > tbody > tr > td { padding: 0; border: 0 }
.moldura .topo, .moldura .pe { height: 0 }
@media print {
  body { background: #fff } .barra { display: none }
  .folha { width: auto; margin: 0; padding: 0 13mm; box-shadow: none; background: transparent }
  /* Fundo fixo repete em toda página; cabeçalho e rodapé vazios da moldura também,
     e fazem a margem de cada página (a de cima e a do rodapé do timbrado). */
  .fundo { display: block; position: fixed; z-index: -1; left: 0; top: 0; width: 210mm; height: 297mm }
  .moldura .topo { height: 14mm } .moldura .pe { height: ${timbrado ? '44mm' : '14mm'} }
}`;
  const linhaItem = i => '<tr><td>' + escH(i.pessoa) + '</td><td>' + escH(i.equipe) + '</td><td>' + escH(i.dia ? dm(i.dia) : '') + '</td><td>' + escH(i.detalhe) + '</td></tr>';
  const blocoGrupo = g => '<div class="grupo"><h2><span class="sev ' + g.severidade + '">' + SEVERIDADE[g.severidade].toUpperCase() + '</span>' +
      escH(g.titulo) + ' <span style="font-weight:400;color:#475569">(' + g.itens.length + ')</span></h2>' +
    '<p class="exp">' + escH(g.explicacao) + '</p><p class="acao"><b>O que fazer:</b> ' + escH(g.acao) + '</p>' +
    '<table><thead><tr><th style="width:30%">Colaborador</th><th style="width:24%">Equipe</th><th style="width:8%">Dia</th><th>Detalhe</th></tr></thead><tbody>' +
      g.itens.map(linhaItem).join('') + '</tbody></table></div>';
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório de inconsistências ' + escH(periodo) + '</title>' +
    '<style>' + css + '</style></head><body>' +
    '<div class="barra"><span>' + plural(total, 'inconsistência', 'inconsistências') + ' em ' + plural(grupos.length, 'grupo', 'grupos') + '</span>' +
      '<button onclick="print()">Imprimir / Salvar em PDF</button></div>' +
    (timbrado ? '<img class="fundo" src="' + timbrado + '" alt="">' : '') +
    '<div class="folha"><table class="moldura"><thead><tr><td><div class="topo"></div></td></tr></thead>' +
      '<tfoot><tr><td><div class="pe"></div></td></tr></tfoot><tbody><tr><td>' +
      '<div class="cab">' + (logo ? '<img src="' + logo + '" alt="">' : '') +
        '<div class="emp">' + escH(empresa.razao || empresa.nome || '') + (empresa.cnpj ? ' &nbsp;' + escH(empresa.cnpj) : '') +
          '<br>RELATÓRIO DE INCONSISTÊNCIAS DO PONTO</div></div>' +
      '<div class="meta"><span><b>Período:</b> ' + escH(periodo) + '</span><span><b>Obra:</b> ' + escH(obra || 'Todas') + '</span>' +
        (geradoEm ? '<span><b>Gerado em:</b> ' + escH(geradoEm) + '</span>' : '') + '</div>' +
      '<div class="chips"><div class="chip"><b>' + total + '</b>no total</div><div class="chip alta"><b>' + cont('alta') + '</b>alta</div>' +
        '<div class="chip media"><b>' + cont('media') + '</b>média</div><div class="chip baixa"><b>' + cont('baixa') + '</b>baixa</div></div>' +
      (grupos.length ? grupos.map(blocoGrupo).join('') : '<div class="vazio">Nenhuma inconsistência no período.</div>') +
    '</td></tr></tbody></table></div></body></html>';
}
