// Confere se uma data URL é imagem de verdade, não só o prefixo. Pura, sem I/O.
//
// A prova facial (folha, advertência, EPI) guarda a foto da captura como
// evidência. O prefixo 'data:image/jpeg;base64,' sozinho não prova nada: aqui o
// base64 precisa decodificar e os primeiros bytes precisam bater com o tipo
// declarado (JPEG FF D8 FF ... FF D9, PNG 89 50 4E 47 0D 0A 1A 0A, WEBP RIFF....WEBP).

const PREFIXO = /^data:image\/(jpeg|png|webp);base64,/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
// Piso só contra lixo: um JPEG 128 px quase uniforme (rosto no escuro) fica perto de
// 900 bytes, e só as tabelas do cabeçalho já passam de 300.
export const IMAGEM_MIN_BYTES = 300;
export const IMAGEM_MAX_CHARS = 300000; // mesmo teto da prova facial

const comeca = (buf, bytes, desde = 0) => bytes.every((b, i) => buf[desde + i] === b);

/** Os bytes batem com o tipo? jpeg | png | webp. */
export function assinaturaConfere(buf, tipo) {
  if (!buf || buf.length < 12) return false;
  if (tipo === 'jpeg') return comeca(buf, [0xff, 0xd8, 0xff]) && buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9;
  if (tipo === 'png') return comeca(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (tipo === 'webp') return comeca(buf, [0x52, 0x49, 0x46, 0x46]) && comeca(buf, [0x57, 0x45, 0x42, 0x50], 8);
  return false;
}

/**
 * Data URL de imagem jpeg/png/webp decodificável, com assinatura do tipo declarado,
 * entre IMAGEM_MIN_BYTES e IMAGEM_MAX_CHARS. Devolve a própria string ou null.
 */
export function imagemReal(f, { minBytes = IMAGEM_MIN_BYTES, maxChars = IMAGEM_MAX_CHARS } = {}) {
  if (typeof f !== 'string' || f.length > maxChars) return null;
  const m = PREFIXO.exec(f);
  if (!m) return null;
  const dados = f.slice(m[0].length);
  if (!dados || dados.length % 4 !== 0 || !BASE64.test(dados)) return null;
  const buf = Buffer.from(dados, 'base64');
  if (buf.length < minBytes) return null;
  return assinaturaConfere(buf, m[1]) ? f : null;
}

/**
 * Prova facial já conferida (conferirProva) + foto que é imagem de verdade. Pura.
 * Foto que não decodifica ou não tem a assinatura do tipo vira 400 PROVA_FACIAL_AUSENTE,
 * como a prova sem foto.
 */
export function comFotoReal(prova) {
  if (!prova || !prova.ok || imagemReal(prova.foto)) return prova;
  return { ok: false, status: 400, codigo: 'PROVA_FACIAL_AUSENTE', mensagem: 'confirme com o rosto pela câmera do aplicativo' };
}
