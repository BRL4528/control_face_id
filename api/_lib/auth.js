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
import { createHash, createHmac } from 'node:crypto';
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
 * { dispositivo_id, estado, empresa_id, colaborador_id|null, nome, papel, bloqueado }
 * ou null (credencial desconhecida / aparelho substituído / empresa do aparelho
 * diferente da do colaborador: todos 401).
 *
 * Estados: 'pendente' (bateu ponto pelo link da empresa, RH ainda não
 * identificou — sem colaborador), 'ativo' (pareado a um colaborador) e
 * 'bloqueado' (RH rejeitou, ou colaborador saiu da empresa). Bloqueado NÃO é
 * null: o chamador responde 403 BLOQUEADO para o app parar de insistir.
 */
export async function autenticarDispositivo(req) {
  const cred = bearer(req);
  if (!cred) return null;
  const hash = hashCredencial(cred);
  const sql = db();
  const linhas = await sql`
    SELECT d.id AS dispositivo_id, d.ativo AS disp_ativo, d.estado, d.matricula_informada,
           COALESCE(d.empresa_id, c.empresa_id) AS empresa_id,
           c.id AS colaborador_id, c.nome, c.matricula, c.papel, c.ativo AS colab_ativo
    FROM dispositivo d
    LEFT JOIN colaborador c ON c.id = d.colaborador_id
    WHERE d.credencial_hash = ${hash}
      -- Aparelho de uma empresa amarrado a colaborador de outra não autentica
      -- (sobra de re-pareamento cruzado): o COALESCE acima não pode escolher.
      AND (d.empresa_id IS NULL OR c.id IS NULL OR d.empresa_id = c.empresa_id)
    LIMIT 1`;
  const r = linhas[0];
  if (!r || !r.disp_ativo) return null;
  const bloqueado = r.estado === 'bloqueado' || (r.colaborador_id && !r.colab_ativo);
  return Object.assign(r, { bloqueado, estado: bloqueado ? 'bloqueado' : (r.colaborador_id ? 'ativo' : 'pendente') });
}

/* ----------------------------------------------------------------- RH */

const SEGREDO = () => process.env.JWT_SECRET || 'dev-inseguro-troque-em-producao';
const TTL_RH = '12h';

/**
 * Carimbo da senha que vai no JWT (`cs`): 8 caracteres de um HMAC do chave_hash
 * atual. Trocar ou redefinir a senha muda o chave_hash, o carimbo deixa de bater
 * e toda sessão aberta antes cai (401) na próxima requisição, sem coluna nova no
 * banco. HMAC com o segredo do JWT: o carimbo, que é legível no token, não dá
 * nenhuma pista do hash da senha.
 */
export function carimboSenha(chaveHash) {
  if (!chaveHash) return null;
  return createHmac('sha256', SEGREDO()).update('senha:' + String(chaveHash)).digest('base64url').slice(0, 8);
}

/** O token foi emitido para a senha que o usuário tem hoje? Token sem carimbo não vale. */
export const carimboConfere = (rh, chaveHash) => !!(rh && rh.cs && chaveHash && rh.cs === carimboSenha(chaveHash));

/** `usuario` precisa trazer chave_hash (o carimbo sai dele). */
export function emitirTokenRh(usuario) {
  return jwt.sign(
    { sub: usuario.id, empresa_id: usuario.empresa_id, usuario: usuario.usuario, nome: usuario.nome, cs: carimboSenha(usuario.chave_hash) },
    SEGREDO(), { expiresIn: TTL_RH });
}

/**
 * Valida o JWT do RH (assinatura e validade). Devolve o payload ou null. O
 * carimbo da senha, o usuário ativo e a senha temporária são conferidos contra o
 * banco em acessoDe (api/_lib/acesso.js), que toda rota do RH chama.
 */
export function autenticarRh(req) {
  const t = bearer(req);
  if (!t) return null;
  try { return jwt.verify(t, SEGREDO()); }
  catch { return null; }
}
