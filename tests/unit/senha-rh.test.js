import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { senhaTemporaria, novaSenhaTemporaria, derivarHex } from '../../api/_lib/senha-rh.js';

test('senha temporária: 12 caracteres, sem ambíguos, e muda a cada geração', () => {
  const a = senhaTemporaria(), b = senhaTemporaria();
  assert.match(a, /^[A-HJ-NP-Za-km-z2-9]{12}$/);
  assert.notEqual(a, b);
});

test('a senha gerada confere exatamente como o login confere (PBKDF2 do navegador + bcrypt)', async () => {
  const { senha, sal, chaveHash } = await novaSenhaTemporaria();
  assert.equal(await bcrypt.compare(derivarHex(senha, sal), chaveHash), true);
  assert.equal(await bcrypt.compare(derivarHex(senha + 'x', sal), chaveHash), false);
  assert.equal(sal.length, 32);
});
