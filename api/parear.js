// Pareamento inicial do celular ao colaborador. Acontece UMA vez na vida do
// aparelho: o colaborador informa a matrícula (ou lê um QR que o RH mostra) e o
// celular gera sua credencial de 256 bits. A partir daí o app abre direto na
// câmera — sem senha, sem digitar de novo.
//
// Segurança do pareamento: exigimos que o colaborador exista, esteja ativo e já
// TENHA biometria cadastrada pelo RH — assim o primeiro ponto já pode ser
// conferido 1:1. O RH controla quem entra ao cadastrar; a matrícula sozinha não
// cria ninguém. Um colaborador pode reparear (trocou de celular): a credencial
// nova substitui a antiga.
import { db, novoId } from './_lib/db.js';
import { hashCredencial } from './_lib/auth.js';
import { cors, ok, erro, corpo, exigeMetodo } from './_lib/http.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (exigeMetodo(req, res, 'POST')) return;

  const b = corpo(req);
  const { empresa_id, matricula, dispositivo_id, credencial, apelido, ua } = b;
  if (!empresa_id || !matricula || !dispositivo_id || !credencial) {
    return erro(res, 400, 'CORPO_INVALIDO', 'empresa_id, matricula, dispositivo_id e credencial são obrigatórios');
  }

  const sql = db();
  const pessoas = await sql`
    SELECT c.id, c.nome, c.papel,
           EXISTS(SELECT 1 FROM template_facial t
                  WHERE t.colaborador_id = c.id AND t.estado = 'ativo') AS tem_biometria
    FROM colaborador c
    WHERE c.empresa_id = ${empresa_id} AND c.matricula = ${matricula} AND c.ativo = true
    LIMIT 1`;
  const p = pessoas[0];
  if (!p) return erro(res, 404, 'COLABORADOR_NAO_ENCONTRADO', 'matrícula não encontrada nesta empresa');
  if (!p.tem_biometria) {
    return erro(res, 409, 'SEM_BIOMETRIA', 'seu cadastro facial ainda não foi feito pelo RH');
  }

  const hash = hashCredencial(credencial);

  // Reparear: um colaborador tem no máximo um dispositivo ativo por vez. O
  // pareamento novo desativa os anteriores (perdeu/trocou o celular).
  await sql`UPDATE dispositivo SET ativo = false WHERE colaborador_id = ${p.id} AND ativo = true`;
  await sql`
    INSERT INTO dispositivo (id, colaborador_id, credencial_hash, apelido, ua, ativo, pareado_em)
    VALUES (${dispositivo_id}, ${p.id}, ${hash}, ${apelido || null}, ${ua || null}, true, now())
    ON CONFLICT (id) DO UPDATE SET
      colaborador_id = EXCLUDED.colaborador_id,
      credencial_hash = EXCLUDED.credencial_hash,
      ativo = true, pareado_em = now()`;

  return ok(res, { colaborador: { id: p.id, nome: p.nome, papel: p.papel } });
}
