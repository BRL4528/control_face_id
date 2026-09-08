// Cadastro/recadastro da biometria de um colaborador pelo RH. Recebe os vetores
// (128 dims cada) das 3 capturas e a miniatura. Guarda o template como nova
// versão ativa e aposenta a anterior — o histórico não é apagado.
//
// A miniatura é opcional aqui; se vier como data URL, sobe para o Vercel Blob e
// guardamos só a URL (não estufa a linha com base64). Sem BLOB_READ_WRITE_TOKEN
// configurado, guarda a própria data URL — degrada, não quebra.
import { db, novoId } from '../_lib/db.js';
import { autenticarRh } from '../_lib/auth.js';
import { cors, ok, erro, corpo, exigeMetodo } from '../_lib/http.js';

async function guardarMiniatura(dataUrl, colaboradorId) {
  if (!dataUrl || !dataUrl.startsWith('data:')) return dataUrl || null;
  if (!process.env.BLOB_READ_WRITE_TOKEN) return dataUrl; // sem Blob: guarda inline
  try {
    const { put } = await import('@vercel/blob');
    const base64 = dataUrl.split(',')[1];
    const bin = Buffer.from(base64, 'base64');
    const r = await put(`biometria/${colaboradorId}-${Date.now()}.jpg`, bin, {
      access: 'public', contentType: 'image/jpeg'
    });
    return r.url;
  } catch { return dataUrl; }
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (exigeMetodo(req, res, 'POST')) return;
  const rh = autenticarRh(req);
  if (!rh) return erro(res, 401, 'SESSAO_INVALIDA', 'faça login novamente');

  const b = corpo(req);
  const colaboradorId = b.colaborador_id;
  const vetores = b.vetores;
  if (!colaboradorId || !Array.isArray(vetores) || vetores.length < 1) {
    return erro(res, 400, 'CORPO_INVALIDO', 'colaborador_id e vetores obrigatórios');
  }
  const sql = db();

  // Confere que o colaborador é desta empresa (isolamento de tenant).
  const donos = await sql`SELECT id FROM colaborador WHERE id=${colaboradorId} AND empresa_id=${rh.empresa_id} LIMIT 1`;
  if (!donos[0]) return erro(res, 404, 'COLABORADOR_NAO_ENCONTRADO', 'colaborador não encontrado');

  const vers = await sql`SELECT COALESCE(MAX(versao),0)+1 AS prox FROM template_facial WHERE colaborador_id=${colaboradorId}`;
  const versao = vers[0].prox;
  const miniaturaUrl = await guardarMiniatura(b.miniatura, colaboradorId);

  await sql`UPDATE template_facial SET estado='substituido' WHERE colaborador_id=${colaboradorId} AND estado='ativo'`;
  const id = novoId();
  await sql`
    INSERT INTO template_facial (id, colaborador_id, versao, vetores, miniatura_url, coerencia, estado, origem)
    VALUES (${id}, ${colaboradorId}, ${versao}, ${JSON.stringify(vetores)}, ${miniaturaUrl},
            ${b.coerencia ?? null}, 'ativo', 'rh')`;
  return ok(res, { template_id: id, versao });
}
