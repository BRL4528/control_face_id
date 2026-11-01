// Pareamento do celular. Três caminhos:
//
//   • 'anonimo' (link da empresa, sem barreira): { empresa_token, dispositivo_id,
//     credencial }. O aparelho nasce PENDENTE, sem colaborador. A pessoa bate
//     ponto normalmente; o RH identifica em Pendências e aí o aparelho vira ativo.
//   • com matrícula ("já tenho cadastro" no aparelho novo, ou o código da empresa
//     sem link): { empresa_id | empresa_token, matricula, dispositivo_id, credencial }.
//     Também nasce PENDENTE, com a matrícula guardada como palpite
//     (matricula_informada). Não desativa o aparelho antigo da pessoa nem baixa o
//     template dela: empresa_id é público e matrícula se adivinha. O RH confere
//     em Pendências (já pré-seleciona pela matrícula) e só aí o aparelho troca.
//   • 'informar': aparelho pendente autenticado (Bearer) informa a matrícula
//     opcional — só um palpite para o RH aprovar em um clique.
import { db } from './_lib/db.js';
import { hashCredencial, autenticarDispositivo } from './_lib/auth.js';
import { cors, ok, erro, corpo, exigeMetodo } from './_lib/http.js';
import { decidirPareamento } from './_lib/pareamento.js';

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
  const anonimo = b.modo === 'anonimo';
  if (!anonimo && !String(b.matricula || '').trim()) return erro(res, 400, 'CORPO_INVALIDO', 'matricula obrigatória (ou modo anonimo)');
  const empresa = await empresaDe(sql, b);
  if (!empresa) return erro(res, 404, 'EMPRESA_NAO_ENCONTRADA', 'empresa não encontrada. Peça o link atual ao RH.');
  const hash = hashCredencial(credencial);

  // Quem é o dono atual deste dispositivo_id? Só o próprio aparelho (mesma
  // credencial, mesma empresa) mexe na linha que já existe.
  const [existente] = await sql`
    SELECT d.empresa_id, d.credencial_hash, d.estado, d.ativo, d.colaborador_id,
           c.empresa_id AS colab_empresa_id, c.nome, c.papel
    FROM dispositivo d LEFT JOIN colaborador c ON c.id = d.colaborador_id
    WHERE d.id=${dispositivo_id} LIMIT 1`;
  const decisao = decidirPareamento(existente || null, { empresaId: empresa.id, hash });
  if (decisao === 'conflito') return erro(res, 409, 'DISPOSITIVO_JA_PAREADO', 'este aparelho já está pareado. Procure o RH.');
  if (decisao === 'bloqueado') return erro(res, 403, 'BLOQUEADO', 'este aparelho foi bloqueado pelo RH');
  if (decisao === 'ja_ativo') {
    return ok(res, { estado: 'ativo', colaborador: { id: existente.colaborador_id, nome: existente.nome, papel: existente.papel },
                     empresa: { id: empresa.id, nome: empresa.nome } });
  }

  // ---- com matrícula: a matrícula precisa existir; vira só o palpite do RH ----
  let matricula = null;
  if (!anonimo) {
    matricula = String(b.matricula).trim().slice(0, 40);
    const [p] = await sql`SELECT 1 AS ok FROM colaborador
                          WHERE empresa_id = ${empresa.id} AND matricula = ${matricula} AND ativo = true LIMIT 1`;
    if (!p) return erro(res, 404, 'COLABORADOR_NAO_ENCONTRADO', 'matrícula não encontrada nesta empresa');
  }

  // Nasce (ou volta a ser) PENDENTE, sem colaborador. O WHERE do DO UPDATE repete
  // a checagem de dono: se outro pedido mudou a linha no meio, nada é alterado.
  const gravou = await sql`
    INSERT INTO dispositivo (id, empresa_id, colaborador_id, credencial_hash, apelido, ua, ativo, estado, matricula_informada, pareado_em)
    VALUES (${dispositivo_id}, ${empresa.id}, NULL, ${hash}, ${apelido || null}, ${ua || null}, true, 'pendente', ${matricula}, now())
    ON CONFLICT (id) DO UPDATE SET
      empresa_id = EXCLUDED.empresa_id, colaborador_id = NULL, estado = 'pendente', ativo = true,
      matricula_informada = COALESCE(EXCLUDED.matricula_informada, dispositivo.matricula_informada), pareado_em = now()
    WHERE dispositivo.credencial_hash = EXCLUDED.credencial_hash
      AND (dispositivo.empresa_id IS NULL OR dispositivo.empresa_id = EXCLUDED.empresa_id)
      AND dispositivo.estado <> 'bloqueado'
    RETURNING matricula_informada`;
  if (!gravou[0]) return erro(res, 409, 'DISPOSITIVO_JA_PAREADO', 'este aparelho já está pareado. Procure o RH.');
  return ok(res, { estado: 'pendente', matricula_informada: gravou[0].matricula_informada || null,
                   empresa: { id: empresa.id, nome: empresa.nome } });
}
