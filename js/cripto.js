// Derivação da senha do RH.
//
// A senha nunca sai do aparelho. O servidor devolve um sal, o navegador
// deriva uma chave com PBKDF2-SHA256 e só a chave trafega.
//
// Limite honesto: a chave guardada no servidor É a credencial — quem ler a
// tabela entra, igual a um token. Isso é adequado para o piloto e não para
// produção com dado de terceiros. Trocar por Argon2 num serviço próprio é o
// caminho quando sair do n8n.
export async function derivar(senha, salHex, iteracoes) {
  const enc = new TextEncoder();
  const sal = new Uint8Array((salHex.match(/.{1,2}/g) || []).map(h => parseInt(h, 16)));
  const base = await crypto.subtle.importKey('raw', enc.encode(senha), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: sal, iterations: iteracoes || 150000, hash: 'SHA-256' },
    base, 256);
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
}
