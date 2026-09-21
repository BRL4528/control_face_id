// Locais frequentes da empresa (centros de cerca reutilizáveis). Cria, edita ou
// desativa. O RH salva uma vez e reusa na alocação diária.
import { db, novoId } from '../_lib/db.js';
import { autenticarRh } from '../_lib/auth.js';
import { cors, ok, erro, corpo, exigeMetodo } from '../_lib/http.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (exigeMetodo(req, res, 'POST')) return;
  const rh = autenticarRh(req);
  if (!rh) return erro(res, 401, 'SESSAO_INVALIDA', 'faça login novamente');

  const b = corpo(req);
  const nome = String(b.nome || '').trim();
  if (b.lat == null || b.lng == null || !nome) {
    return erro(res, 400, 'CORPO_INVALIDO', 'nome, lat e lng obrigatórios');
  }
  const sql = db();

  // Sem raio informado, vale o padrão da empresa (Configurações) — 200 m se nem
  // isso estiver definido.
  let padrao = 200;
  if (!Number(b.raio_m)) {
    const cfg = await sql`SELECT dados FROM config_empresa WHERE empresa_id=${rh.empresa_id} LIMIT 1`;
    padrao = Number(cfg[0] && cfg[0].dados && cfg[0].dados.raioPadraoM) || 200;
  }
  const raio = Math.max(30, Math.min(Number(b.raio_m) || padrao, 5000));

  if (b.local_id) {
    await sql`UPDATE local SET nome=${nome}, lat=${b.lat}, lng=${b.lng}, raio_m=${raio},
              ativo=${b.ativo === false ? false : true}
              WHERE id=${b.local_id} AND empresa_id=${rh.empresa_id}`;
    return ok(res, { local_id: b.local_id, atualizado: true });
  }
  const id = novoId();
  await sql`INSERT INTO local (id, empresa_id, nome, lat, lng, raio_m)
            VALUES (${id}, ${rh.empresa_id}, ${nome}, ${b.lat}, ${b.lng}, ${raio})`;
  return ok(res, { local_id: id, criado: true });
}
