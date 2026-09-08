// Pareamento do celular. Três caminhos:
//
//   • 'anonimo' (link da empresa, sem barreira): { empresa_token, dispositivo_id,
//     credencial }. O aparelho nasce PENDENTE, sem colaborador. A pessoa bate
//     ponto normalmente; o RH identifica em Pendências e aí o aparelho vira ativo.
//   • com matrícula (padrão antigo, e "já tenho cadastro" no aparelho novo):
//     { empresa_id | empresa_token, matricula, dispositivo_id, credencial }.
//     Exige colaborador ativo COM biometria — o 1º ponto já confere 1:1.
//   • 'informar': aparelho pendente autenticado (Bearer) informa a matrícula
//     opcional — só um palpite para o RH aprovar em um clique.
import { db } from './_lib/db.js';
import { hashCredencial, autenticarDispositivo } from './_lib/auth.js';
import { cors, ok, erro, corpo, exigeMetodo } from './_lib/http.js';

async function empresaDe(sql, b) {
  if (b.empresa_id) { const r = await sql`SELECT id, nome FROM empresa WHERE id=${b.empresa_id} LIMIT 1`; return r[0] || null; }
  const t = String(b.empresa_token || '').trim().toLowerCase();
  if (!t) return null;
  const r = await sql`SELECT id, nome FROM empresa WHERE link_token=${t} LIMIT 1`;
  return r[0] || null;
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (exigeMetodo(req, res, 'POST')) return;
  const b = corpo(req);
  const sql = db();

  // ---- informar matrícula (aparelho pendente) ----
  if (b.acao === 'informar') {
    const vinc = await autenticarDispositivo(req);
    if (!vinc) return erro(res, 401, 'CREDENCIAL_INVALIDA', 'dispositivo não autenticado');
    if (vinc.bloqueado) return erro(res, 403, 'BLOQUEADO', 'este aparelho foi bloqueado pelo RH');
    const mat = String(b.matricula || '').trim().slice(0, 40) || null;
    await sql`UPDATE dispositivo SET matricula_informada=${mat} WHERE id=${vinc.dispositivo_id}`;
    return ok(res, { matricula_informada: mat });
  }

  const { dispositivo_id, credencial, apelido, ua } = b;
  if (!dispositivo_id || !credencial) return erro(res, 400, 'CORPO_INVALIDO', 'dispositivo_id e credencial são obrigatórios');
  const empresa = await empresaDe(sql, b);
  if (!empresa) return erro(res, 404, 'EMPRESA_NAO_ENCONTRADA', 'empresa não encontrada. Peça o link atual ao RH.');
  const hash = hashCredencial(credencial);

  // Aparelho já bloqueado não se re-pareia por cima.
  const disp = await sql`SELECT estado FROM dispositivo WHERE id=${dispositivo_id} LIMIT 1`;
  if (disp[0] && disp[0].estado === 'bloqueado') return erro(res, 403, 'BLOQUEADO', 'este aparelho foi bloqueado pelo RH');

  // ---- anônimo: nasce pendente ----
  if (b.modo === 'anonimo' || !b.matricula) {
    if (b.modo !== 'anonimo') return erro(res, 400, 'CORPO_INVALIDO', 'matricula obrigatória (ou modo anonimo)');
    await sql`
      INSERT INTO dispositivo (id, empresa_id, colaborador_id, credencial_hash, apelido, ua, ativo, estado, pareado_em)
      VALUES (${dispositivo_id}, ${empresa.id}, NULL, ${hash}, ${apelido || null}, ${ua || null}, true, 'pendente', now())
      ON CONFLICT (id) DO UPDATE SET credencial_hash=EXCLUDED.credencial_hash, empresa_id=EXCLUDED.empresa_id,
        ativo=true, pareado_em=now()`;
    return ok(res, { estado: 'pendente', empresa: { id: empresa.id, nome: empresa.nome } });
  }

  // ---- com matrícula: exige biometria ----
  const matricula = String(b.matricula).trim();
  const pessoas = await sql`
    SELECT c.id, c.nome, c.papel,
           EXISTS(SELECT 1 FROM template_facial t WHERE t.colaborador_id = c.id AND t.estado = 'ativo') AS tem_biometria
    FROM colaborador c
    WHERE c.empresa_id = ${empresa.id} AND c.matricula = ${matricula} AND c.ativo = true
    LIMIT 1`;
  const p = pessoas[0];
  if (!p) return erro(res, 404, 'COLABORADOR_NAO_ENCONTRADO', 'matrícula não encontrada nesta empresa');
  if (!p.tem_biometria) return erro(res, 409, 'SEM_BIOMETRIA', 'seu cadastro facial ainda não foi feito. Bata o ponto pelo link da empresa: o RH confirma.');

  // Um colaborador tem no máximo um dispositivo ativo por vez (trocou/perdeu o celular).
  await sql`UPDATE dispositivo SET ativo = false WHERE colaborador_id = ${p.id} AND ativo = true`;
  await sql`
    INSERT INTO dispositivo (id, empresa_id, colaborador_id, credencial_hash, apelido, ua, ativo, estado, pareado_em)
    VALUES (${dispositivo_id}, ${empresa.id}, ${p.id}, ${hash}, ${apelido || null}, ${ua || null}, true, 'ativo', now())
    ON CONFLICT (id) DO UPDATE SET
      colaborador_id = EXCLUDED.colaborador_id, empresa_id = EXCLUDED.empresa_id,
      credencial_hash = EXCLUDED.credencial_hash, estado='ativo', ativo = true, pareado_em = now()`;
  return ok(res, { estado: 'ativo', colaborador: { id: p.id, nome: p.nome, papel: p.papel }, empresa: { id: empresa.id, nome: empresa.nome } });
}
