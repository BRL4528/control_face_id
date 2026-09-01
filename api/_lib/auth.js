// Autenticação. Dois mundos separados, como no piloto:
//
//   • Dispositivo do colaborador — credencial de 256 bits gerada no celular no
//     pareamento. Chega como Bearer; comparamos o sha256 dela com o hash
//     guardado. Autentica /ponto, /carga-dia, /cadastro.
//   • Painel do RH — JWT emitido por /rh/login após conferir a chave PBKDF2
//     (que o cliente deriva da senha). Bearer em toda /rh/*.
//
// A face NÃO é autenticação de transporte: ela confirma identidade 1:1 dentro
// da sessão do dispositivo, no ato do ponto. Quem prova "sou este celular" é a
// credencial; quem prova "sou esta pessoa viva agora" é a face + liveness.
import jwt from 'jsonwebtoken';
import { createHash } from 'node:crypto';
import { db } from './db.js';

function bearer(req) {
  const a = String(req.headers.authorization || '');
  return a.startsWith('Bearer ') ? a.slice(7) : '';
}

export function hashCredencial(credencial) {
  return createHash('sha256').update(String(credencial)).digest('base64url');
}

/**
 * Autentica o dispositivo pela credencial no Bearer. Devolve o vínculo
 * { dispositivo, colaborador } ou null. Não distingue "não existe" de
 * "credencial errada" para o chamador — ambos são 401.
 */
export async function autenticarDispositivo(req) {
  const cred = bearer(req);
  if (!cred) return null;
  const hash = hashCredencial(cred);
  const sql = db();
  const linhas = await sql`
    SELECT d.id AS dispositivo_id, d.ativo AS disp_ativo,
           c.id AS colaborador_id, c.empresa_id, c.nome, c.matricula, c.papel, c.ativo AS colab_ativo
    FROM dispositivo d
    JOIN colaborador c ON c.id = d.colaborador_id
    WHERE d.credencial_hash = ${hash}
    LIMIT 1`;
  const r = linhas[0];
  if (!r || !r.disp_ativo || !r.colab_ativo) return null;
  return r;
}

/* ----------------------------------------------------------------- RH */

const SEGREDO = () => process.env.JWT_SECRET || 'dev-inseguro-troque-em-producao';
const TTL_RH = '12h';

export function emitirTokenRh(usuario) {
  return jwt.sign(
    { sub: usuario.id, empresa_id: usuario.empresa_id, usuario: usuario.usuario, nome: usuario.nome },
    SEGREDO(), { expiresIn: TTL_RH });
}

/** Valida o JWT do RH. Devolve o payload ou null. */
export function autenticarRh(req) {
  const t = bearer(req);
  if (!t) return null;
  try { return jwt.verify(t, SEGREDO()); }
  catch { return null; }
}
