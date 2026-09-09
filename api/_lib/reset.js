// Zerar os dados de uma empresa (Configurações → Zona de perigo). Apaga todo o
// dado operacional — marcações, correções, alocações, escalas, aparelhos,
// biometria, colaboradores, equipes, locais, jornadas — e mantém a empresa, os
// usuários do RH, as configurações, o link da empresa e o token de integração.
// Serve para resetar uma conta e deixar o Bitrix repovoar do zero.
//
// Marcação tem trigger de imutabilidade (REP-P). Aqui ele é desligado SÓ dentro
// da transação do apagamento e religado na sequência; se qualquer passo falhar,
// o rollback desfaz tudo, inclusive o DISABLE. É um ato administrativo explícito
// do RH, com a palavra ZERAR digitada na tela — nunca chamado por automação.

const TABELAS = ['marcacao', 'correcao', 'alocacao', 'plano_alocacao', 'dispositivo', 'colaborador', 'equipe', 'local', 'jornada'];

/** Quantidades que seriam apagadas (prévia da tela). */
export async function contarDados(sql, empresaId) {
  const out = {};
  for (const t of TABELAS) {
    const r = await sql.query(`SELECT count(*)::int AS n FROM ${t} WHERE empresa_id=$1`, [empresaId]);
    out[t] = (r.rows ? r.rows[0] : r[0]).n;
  }
  const tf = await sql`SELECT count(*)::int AS n FROM template_facial tf JOIN colaborador c ON c.id=tf.colaborador_id WHERE c.empresa_id=${empresaId}`;
  out.template_facial = tf[0].n;
  return out;
}

/** Apaga tudo de uma empresa numa transação e devolve o que foi removido. */
export async function zerarEmpresa(sql, empresaId) {
  const antes = await contarDados(sql, empresaId);

  // URLs de miniaturas no Blob, para limpar depois (melhor esforço).
  const urls = new Set();
  for (const r of await sql`SELECT foto_url FROM marcacao WHERE empresa_id=${empresaId} AND foto_url LIKE 'https://%'`) urls.add(r.foto_url);
  for (const r of await sql`SELECT tf.miniatura_url FROM template_facial tf JOIN colaborador c ON c.id=tf.colaborador_id WHERE c.empresa_id=${empresaId} AND tf.miniatura_url LIKE 'https://%'`) urls.add(r.miniatura_url);
  for (const r of await sql`SELECT cadastro->>'miniatura_url' AS u FROM dispositivo WHERE empresa_id=${empresaId} AND cadastro->>'miniatura_url' LIKE 'https://%'`) urls.add(r.u);

  await sql.transaction(txn => [
    txn`ALTER TABLE marcacao DISABLE TRIGGER trg_marcacao_imutavel`,
    txn`DELETE FROM correcao WHERE empresa_id=${empresaId}`,
    txn`DELETE FROM marcacao WHERE empresa_id=${empresaId}`,
    txn`ALTER TABLE marcacao ENABLE TRIGGER trg_marcacao_imutavel`,
    txn`DELETE FROM alocacao WHERE empresa_id=${empresaId}`,
    txn`DELETE FROM plano_alocacao WHERE empresa_id=${empresaId}`,
    txn`DELETE FROM dispositivo WHERE empresa_id=${empresaId} OR colaborador_id IN (SELECT id FROM colaborador WHERE empresa_id=${empresaId})`,
    txn`DELETE FROM template_facial WHERE colaborador_id IN (SELECT id FROM colaborador WHERE empresa_id=${empresaId})`,
    txn`UPDATE equipe SET supervisor_id=NULL, jornada_id=NULL WHERE empresa_id=${empresaId}`,
    txn`DELETE FROM colaborador WHERE empresa_id=${empresaId}`,
    txn`DELETE FROM equipe WHERE empresa_id=${empresaId}`,
    txn`DELETE FROM local WHERE empresa_id=${empresaId}`,
    txn`DELETE FROM jornada WHERE empresa_id=${empresaId}`,
    txn`UPDATE config_empresa SET dados = dados - 'integracao_bitrix', atualizada_em=now() WHERE empresa_id=${empresaId}`
  ]);

  const [trg] = await sql`SELECT tgenabled FROM pg_trigger WHERE tgname='trg_marcacao_imutavel'`;
  const triggerOk = !!trg && trg.tgenabled === 'O';

  let miniaturasApagadas = 0;
  if (urls.size && process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const { del } = await import('@vercel/blob');
      const lista = [...urls];
      for (let i = 0; i < lista.length; i += 100) { await del(lista.slice(i, i + 100)); miniaturasApagadas += Math.min(100, lista.length - i); }
    } catch { /* melhor esforço: blob órfão não quebra o reset */ }
  }
  return { apagado: antes, miniaturas_apagadas: miniaturasApagadas, trigger_imutabilidade_ok: triggerOk };
}
