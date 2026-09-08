// Semente inicial: cria uma empresa e o primeiro usuário do RH. Rode uma vez
// depois de aplicar db/schema.sql. Uso:
//
//   DATABASE_URL=... node scripts/seed.js "Minha Empresa" rh "senha-forte"
//
// A senha do RH NUNCA é guardada. Derivamos a mesma chave PBKDF2-SHA256 que o
// navegador derivaria (150 000 iterações, 256 bits) e guardamos só o bcrypt
// dela — exatamente o que /rh/login confere. Assim o seed e o app concordam.
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
import { pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';

const [, , nomeEmpresa = 'Empresa Demo', usuario = 'rh', senha = 'trocar-123'] = process.argv;

const ITER = 150000;

// DEVE bater exatamente com js/cripto.js derivar(): PBKDF2-SHA256, 256 bits,
// saída em HEX. Se divergir (ex.: base64), o login nunca confere.
function derivarChave(senha, salHex) {
  return pbkdf2Sync(senha, Buffer.from(salHex, 'hex'), ITER, 32, 'sha256').toString('hex');
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('Defina DATABASE_URL'); process.exit(1); }
  const sql = neon(url);

  const empresaId = randomUUID();
  await sql`INSERT INTO empresa (id, nome) VALUES (${empresaId}, ${nomeEmpresa})`;

  const sal = randomBytes(16).toString('hex');
  const chave = derivarChave(senha, sal);
  const chaveHash = await bcrypt.hash(chave, 10);
  await sql`
    INSERT INTO usuario_rh (id, empresa_id, usuario, nome, sal, iteracoes, chave_hash)
    VALUES (${randomUUID()}, ${empresaId}, ${usuario}, ${'RH'}, ${sal}, ${ITER}, ${chaveHash})`;

  // Uma equipe e um colaborador de exemplo, para testar o fluxo de ponta a ponta.
  const equipeId = randomUUID();
  await sql`INSERT INTO equipe (id, empresa_id, nome) VALUES (${equipeId}, ${empresaId}, ${'Equipe Piloto'})`;
  await sql`INSERT INTO colaborador (id, empresa_id, nome, matricula, papel, equipe_padrao)
            VALUES (${randomUUID()}, ${empresaId}, ${'Colaborador Exemplo'}, ${'0001'}, 'colaborador', ${equipeId})`;

  console.log('✓ Semente criada');
  console.log('  empresa_id:', empresaId);
  console.log('  RH login  :', usuario, '/ senha:', senha);
  console.log('  Guarde o empresa_id — o app o usa no pareamento do celular.');
}

main().catch(e => {
  if (e && e.code === '23505' && /usuario_rh/.test(String(e.message))) {
    console.error(`✗ Já existe um usuário do RH chamado "${usuario}" em outra empresa. O usuário é único no sistema: escolha outro (3º argumento).`);
  } else console.error(e);
  process.exit(1);
});
