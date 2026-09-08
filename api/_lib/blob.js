// Miniaturas (rosto) no Vercel Blob. Se vier data URL, sobe e guardamos só a URL
// (não estufa a linha com base64). Sem BLOB_READ_WRITE_TOKEN, guarda a própria
// data URL — degrada, não quebra.
export async function guardarMiniatura(dataUrl, chave) {
  if (!dataUrl || !String(dataUrl).startsWith('data:')) return dataUrl || null;
  if (!process.env.BLOB_READ_WRITE_TOKEN) return dataUrl;
  try {
    const { put } = await import('@vercel/blob');
    const bin = Buffer.from(String(dataUrl).split(',')[1], 'base64');
    const r = await put(`biometria/${chave}-${Date.now()}.jpg`, bin, { access: 'public', contentType: 'image/jpeg' });
    return r.url;
  } catch { return dataUrl; }
}
