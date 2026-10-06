// Senha temporária do usuário RH: o servidor gera, deriva (PBKDF2-SHA256, mesmo
// formato do navegador no login) e guarda só o bcrypt. A senha em texto sai UMA
// vez, para quem criou ou redefiniu repassar. O usuário troca no 1º acesso.
import bcrypt from 'bcryptjs';
import { pbkdf2Sync, randomBytes } from 'node:crypto';

export const ITER = 150000;
export const derivarHex = (senha, salHex) =>
  pbkdf2Sync(senha, Buffer.from(salHex, 'hex'), ITER, 32, 'sha256').toString('hex');

// 12 caracteres de um alfabeto sem ambíguos (sem 0/O, 1/l/I).
export function senhaTemporaria() {
  const alf = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const b = randomBytes(12);
  let s = '';
  for (let i = 0; i < 12; i++) s += alf[b[i] % alf.length];
  return s;
}

/** Senha nova pronta para gravar: { senha (texto, mostrar uma vez), sal, chaveHash }. */
export async function novaSenhaTemporaria() {
  const senha = senhaTemporaria();
  const sal = randomBytes(16).toString('hex');
  const chaveHash = await bcrypt.hash(derivarHex(senha, sal), 10);
  return { senha, sal, chaveHash };
}
