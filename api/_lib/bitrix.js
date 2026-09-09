// Integração Bitrix24 → Ponto (docs/INTEGRACAO_BITRIX_GERENCIAMENTO_EQUIPE.md).
//
// O n8n manda, a cada poucos minutos, um SNAPSHOT do pipeline "Gerenciamento de
// Equipe": as etapas e os cards com o contato de cada um. Aqui esse estado vira
// o estado do ponto: etapa = equipe, card aberto = colaborador ativo na equipe
// da etapa, card fechado/sumido = colaborador inativo (aparelho bloqueado).
// Quem NÃO tem vínculo com o Bitrix (criado à mão, demo) nunca é tocado.
//
// `normalizarSnapshot` é pura (validação + regras de desempate) e testável;
// `aplicarSnapshot` grava. Aplicar o mesmo snapshot duas vezes não muda nada.
import { novoId } from './db.js';
import { realocarColaboradores } from './escala.js';
import { sincronizarBloqueios } from './dispositivos.js';

const limpar = v => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());

export class SnapshotInvalido extends Error {
  constructor(codigo, mensagem) { super(mensagem); this.codigo = codigo; }
}

/**
 * Snapshot bruto → { etapas, cards, avisos }.
 *   etapas: [{ id, nome, ordem, final, sem_equipe }]  (ids únicos)
 *   cards:  [{ card, contato, nome, telefone, etapa, fechado, alterado_em }] — UM por contato
 *   avisos: inconsistências que o RH resolve no Bitrix; nunca derrubam o snapshot.
 * Regras: nome = título do card (o que o RH escreveu; o contato pode ser um
 * placeholder do WhatsApp), senão nome do contato; etapa sem flag `sem_equipe` → a
 * que se chama "A alocar" recebe a flag;
 * `:WON`/`:LOSE` são finais mesmo sem flag; card sem contato é ignorado com aviso;
 * contato em mais de um card → vale o aberto mais recente.
 */
export function normalizarSnapshot(b) {
  if (!b || !Array.isArray(b.etapas) || !Array.isArray(b.cards)) {
    throw new SnapshotInvalido('SNAPSHOT_INVALIDO', 'etapas e cards obrigatórios');
  }
  const avisos = [];
  const etapas = [];
  const vistas = new Set();
  for (const e of b.etapas) {
    const id = limpar(e && e.id), nome = limpar(e && e.nome);
    if (!id || !nome) { avisos.push({ tipo: 'etapa_invalida', etapa: id || null }); continue; }
    if (vistas.has(id)) continue;
    vistas.add(id);
    etapas.push({
      id, nome: nome.slice(0, 80), ordem: Number(e.ordem) || 0,
      final: !!e.final || /:(WON|LOSE)$/.test(id), sem_equipe: !!e.sem_equipe
    });
  }
  if (!etapas.length) throw new SnapshotInvalido('SNAPSHOT_INVALIDO', 'nenhuma etapa válida');
  if (!etapas.some(e => e.sem_equipe)) {
    const a = etapas.find(e => /^a\s+alocar\b/i.test(e.nome));
    if (a) a.sem_equipe = true;
  }
  const porEtapa = new Map(etapas.map(e => [e.id, e]));

  const porContato = new Map();
  const repetidos = new Map();
  for (const c of b.cards) {
    const card = limpar(c && c.id);
    const contato = (c && c.contato) || {};
    const contatoId = limpar(contato.id);
    if (!contatoId || contatoId === '0') {
      avisos.push({ tipo: 'card_sem_contato', card, titulo: limpar(c && c.titulo) || null });
      continue;
    }
    const etapa = porEtapa.get(limpar(c.etapa));
    if (!etapa) { avisos.push({ tipo: 'card_em_etapa_desconhecida', card, etapa: limpar(c.etapa) }); continue; }
    const nome = limpar(c.titulo) || limpar(contato.nome);
    if (!nome) { avisos.push({ tipo: 'card_sem_nome', card, contato: contatoId }); continue; }
    const item = {
      card, contato: contatoId, nome: nome.slice(0, 120), telefone: limpar(contato.telefone) || null,
      etapa: etapa.id, fechado: !!c.fechado || etapa.final, alterado_em: Date.parse(c.alterado_em) || 0
    };
    const ant = porContato.get(contatoId);
    if (!ant) { porContato.set(contatoId, item); continue; }
    if (!repetidos.has(contatoId)) repetidos.set(contatoId, [ant.card]);
    repetidos.get(contatoId).push(card);
    // aberto ganha de fechado; entre iguais, o alterado mais recentemente
    const vence = ant.fechado !== item.fechado ? (ant.fechado ? item : ant)
      : (item.alterado_em > ant.alterado_em ? item : ant);
    porContato.set(contatoId, vence);
  }
  for (const [contato, cards] of repetidos) avisos.push({ tipo: 'contato_em_mais_de_um_card', contato, cards });

  return { etapas, cards: [...porContato.values()], avisos };
}

/** Diferença entre o estado de colaboradores antes/depois (linhas com id, nome, equipe_padrao, ativo, bitrix_contact_id). Puro. */
export function resumirColaboradores(antes, depois) {
  const a = new Map(antes.map(c => [c.id, c]));
  const r = { criados: 0, atualizados: 0, movidos: 0, desativados: 0, reativados: 0 };
  for (const d of depois) {
    if (!d.bitrix_contact_id) continue;
    const x = a.get(d.id);
    if (!x || !x.bitrix_contact_id) { r.criados++; continue; }
    if (x.ativo && !d.ativo) r.desativados++;
    else if (!x.ativo && d.ativo) r.reativados++;
    if (x.equipe_padrao !== d.equipe_padrao && d.ativo) r.movidos++;
    if (x.nome !== d.nome || x.equipe_padrao !== d.equipe_padrao || x.ativo !== d.ativo) r.atualizados++;
  }
  return r;
}

/** Idem para equipes (linhas com id, nome, ativo, bitrix_stage_id). Puro. */
export function resumirEquipes(antes, depois) {
  const a = new Map(antes.map(e => [e.id, e]));
  const r = { criadas: 0, renomeadas: 0, desativadas: 0, reativadas: 0 };
  for (const d of depois) {
    if (!d.bitrix_stage_id) continue;
    const x = a.get(d.id);
    if (!x || !x.bitrix_stage_id) { r.criadas++; continue; }
    if (x.nome !== d.nome) r.renomeadas++;
    if (x.ativo && !d.ativo) r.desativadas++;
    if (!x.ativo && d.ativo) r.reativadas++;
  }
  return r;
}

/**
 * Aplica um snapshot normalizado na empresa. Ordem: equipes (adota por nome,
 * upsert por etapa, desativa as que sumiram) → colaboradores (atualiza os
 * vinculados, insere/adota os novos, desativa quem não veio aberto) → escalas
 * (cada pessoa vinculada vai para a escala da equipe atual) → aparelhos.
 * Sem cards e com gente vinculada exige `confirmarVazio` — um pipeline vazio de
 * verdade é raro; um robô quebrado mandando [] desativaria todo mundo.
 */
export async function aplicarSnapshot(sql, empresaId, snap, hoje, { confirmarVazio = false } = {}) {
  const antesEq = await sql`SELECT id, nome, ativo, bitrix_stage_id FROM equipe WHERE empresa_id=${empresaId}`;
  const antesCol = await sql`SELECT id, nome, equipe_padrao, ativo, bitrix_contact_id, matricula FROM colaborador WHERE empresa_id=${empresaId}`;
  const avisos = snap.avisos.slice();

  const abertos = snap.cards.filter(c => !c.fechado);
  if (!abertos.length && antesCol.some(c => c.bitrix_contact_id && c.ativo) && !confirmarVazio) {
    throw new SnapshotInvalido('SNAPSHOT_VAZIO', 'snapshot sem cards abertos desativaria todos os colaboradores vinculados; envie confirmar_vazio=true se for isso mesmo');
  }

  // ---- equipes
  const equipesSnap = snap.etapas.filter(e => !e.final && !e.sem_equipe);
  const stageIds = equipesSnap.map(e => e.id), nomesEq = equipesSnap.map(e => e.nome);
  if (stageIds.length) {
    // Equipe criada à mão com o mesmo nome da etapa passa a ser a equipe da etapa.
    await sql.query(
      `UPDATE equipe e SET bitrix_stage_id=t.stage, ativo=true
       FROM (SELECT DISTINCT ON (t.stage) e2.id, t.stage
             FROM unnest($2::text[], $3::text[]) AS t(stage, nome)
             JOIN equipe e2 ON e2.empresa_id=$1 AND e2.bitrix_stage_id IS NULL AND lower(e2.nome)=lower(t.nome)
             WHERE NOT EXISTS (SELECT 1 FROM equipe x WHERE x.empresa_id=$1 AND x.bitrix_stage_id=t.stage)
             ORDER BY t.stage, e2.criada_em) AS t
       WHERE e.id=t.id`,
      [empresaId, stageIds, nomesEq]);
    await sql.query(
      `INSERT INTO equipe (id, empresa_id, nome, bitrix_stage_id)
       SELECT t.id, $1, t.nome, t.stage FROM unnest($2::text[], $3::text[], $4::text[]) AS t(id, stage, nome)
       ON CONFLICT (empresa_id, bitrix_stage_id) WHERE bitrix_stage_id IS NOT NULL
       DO UPDATE SET nome=EXCLUDED.nome, ativo=true`,
      [empresaId, stageIds.map(() => novoId()), stageIds, nomesEq]);
  }
  await sql`UPDATE equipe SET ativo=false
            WHERE empresa_id=${empresaId} AND bitrix_stage_id IS NOT NULL AND ativo=true
              AND NOT (bitrix_stage_id = ANY(${stageIds}::text[]))`;
  const eqRows = await sql`SELECT id, bitrix_stage_id FROM equipe WHERE empresa_id=${empresaId} AND bitrix_stage_id IS NOT NULL`;
  const eqPorStage = new Map(eqRows.map(r => [r.bitrix_stage_id, r.id]));

  // ---- colaboradores
  const contatos = abertos.map(c => c.contato);
  const nomesC = abertos.map(c => c.nome);
  const eqs = abertos.map(c => eqPorStage.get(c.etapa) || null);
  if (abertos.length) {
    await sql.query(
      `UPDATE colaborador c SET nome=t.nome, equipe_padrao=t.equipe, ativo=true
       FROM unnest($2::text[], $3::text[], $4::text[]) AS t(contato, nome, equipe)
       WHERE c.empresa_id=$1 AND c.bitrix_contact_id=t.contato`,
      [empresaId, contatos, nomesC, eqs]);
    // Novo: matrícula = id do contato. Se essa matrícula já existir sem vínculo
    // (importado por planilha com o mesmo código), o registro é adotado.
    await sql.query(
      `INSERT INTO colaborador (id, empresa_id, nome, matricula, papel, equipe_padrao, ativo, bitrix_contact_id)
       SELECT t.id, $1, t.nome, t.contato, 'colaborador', t.equipe, true, t.contato
       FROM unnest($2::text[], $3::text[], $4::text[], $5::text[]) AS t(id, contato, nome, equipe)
       WHERE NOT EXISTS (SELECT 1 FROM colaborador c WHERE c.empresa_id=$1 AND c.bitrix_contact_id=t.contato)
       ON CONFLICT (empresa_id, matricula) DO UPDATE SET
         nome=EXCLUDED.nome, equipe_padrao=EXCLUDED.equipe_padrao, ativo=true, bitrix_contact_id=EXCLUDED.bitrix_contact_id
       WHERE colaborador.bitrix_contact_id IS NULL`,
      [empresaId, contatos.map(() => novoId()), contatos, nomesC, eqs]);
  }
  await sql`UPDATE colaborador SET ativo=false
            WHERE empresa_id=${empresaId} AND bitrix_contact_id IS NOT NULL AND ativo=true
              AND NOT (bitrix_contact_id = ANY(${contatos}::text[]))`;

  const depoisCol = await sql`SELECT id, nome, equipe_padrao, ativo, bitrix_contact_id, matricula FROM colaborador WHERE empresa_id=${empresaId}`;
  const vinculados = new Set(depoisCol.filter(c => c.bitrix_contact_id).map(c => c.bitrix_contact_id));
  for (const c of abertos) {
    if (!vinculados.has(c.contato)) avisos.push({ tipo: 'matricula_em_uso_por_outro_contato', contato: c.contato, nome: c.nome });
  }

  // ---- escalas: toda pessoa vinculada vai para a escala da equipe atual (ou sai de todas)
  const movs = depoisCol.filter(c => c.bitrix_contact_id)
    .map(c => ({ colaborador_id: c.id, equipe_id: c.ativo ? c.equipe_padrao : null }));
  const escala = await realocarColaboradores(sql, empresaId, movs, hoje);
  await sincronizarBloqueios(sql, empresaId);

  const depoisEq = await sql`SELECT id, nome, ativo, bitrix_stage_id FROM equipe WHERE empresa_id=${empresaId}`;
  return {
    equipes: resumirEquipes(antesEq, depoisEq),
    colaboradores: resumirColaboradores(antesCol, depoisCol),
    planos_ajustados: escala.planos_ajustados,
    cards_abertos: abertos.length,
    avisos
  };
}
