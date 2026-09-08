// Recebe o lote de marcações da fila offline do celular e grava no livro.
// Espelha as garantias do piloto, agora com o banco como autoridade:
//
//   • Deduplicação REAL: id_cliente é PRIMARY KEY. ON CONFLICT DO NOTHING —
//     reenvio após timeout devolve 'duplicado', nunca dobra o ponto. (O n8n não
//     tinha índice único; aqui tem.)
//   • A CERCA é reconferida no servidor. O cliente informa lat/lng; nós medimos
//     contra a alocação do dia. Fora da cerca → grava e marca para revisão
//     (nunca nega: pode ser GPS ruim, e o ponto jamais é negado por técnica).
//   • Vai para revisão quando: veredito != aceito, origem manual, fora da cerca,
//     liveness reprovado, sem alocação, ou relógio > 2 min fora.
//   • A foto de auditoria só se guarda quando a marcação vai para revisão.
import { db } from './_lib/db.js';
import { autenticarDispositivo } from './_lib/auth.js';
import { dentroDaCerca } from './_lib/geo.js';
import { cors, ok, erro, corpo, exigeMetodo } from './_lib/http.js';
import { guardarMiniatura } from './_lib/blob.js';

const DERIVA_MAX_MS = 120000;

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (exigeMetodo(req, res, 'POST')) return;

  const vinc = await autenticarDispositivo(req);
  if (!vinc) return erro(res, 401, 'CREDENCIAL_INVALIDA', 'dispositivo não autenticado');
  if (vinc.bloqueado) return erro(res, 403, 'BLOQUEADO', 'este aparelho foi bloqueado pelo RH');

  const marcacoes = corpo(req).marcacoes;
  if (!Array.isArray(marcacoes) || !marcacoes.length) {
    return erro(res, 400, 'CORPO_INVALIDO', 'lista de marcações vazia');
  }

  const sql = db();
  const resultados = [];
  let aceitas = 0, duplicadas = 0, emRevisao = 0;
  await sql`UPDATE dispositivo SET visto_em=now() WHERE id=${vinc.dispositivo_id}`;

  // ---- aparelho PENDENTE (link da empresa, RH ainda não identificou) ----
  // Grava a marcação SEM colaborador, amarrada ao aparelho, sempre em revisão.
  // A 1ª marcação traz o cadastro facial (vetores + miniatura) que vira template
  // quando o RH identificar a pessoa. Nunca nega: a pessoa bateu, o RH resolve.
  if (vinc.estado === 'pendente') {
    for (const m of marcacoes.slice(0, 100)) {
      if (!m || !m.id_cliente || !m.tipo || !m.marcado_em) {
        resultados.push({ id_cliente: m && m.id_cliente, status: 'rejeitado', motivo: 'campos obrigatórios ausentes' });
        continue;
      }
      const dia = String(m.marcado_dia || m.marcado_em).slice(0, 10);
      if (m.cadastro && Array.isArray(m.cadastro.vetores) && m.cadastro.vetores.length) {
        const temCad = await sql`SELECT 1 FROM dispositivo WHERE id=${vinc.dispositivo_id} AND cadastro IS NOT NULL LIMIT 1`;
        if (!temCad[0]) {
          const url = await guardarMiniatura(m.cadastro.miniatura || m.foto_url, 'aparelho-' + vinc.dispositivo_id);
          await sql`UPDATE dispositivo SET cadastro=${JSON.stringify({ vetores: m.cadastro.vetores, miniatura_url: url })} WHERE id=${vinc.dispositivo_id}`;
        }
      }
      const foto = await guardarMiniatura(m.foto_url, 'marc-' + m.id_cliente);
      const ins = await sql`
        INSERT INTO marcacao (id_cliente, empresa_id, colaborador_id, dispositivo_id, equipe_id, tipo, origem, veredito,
          score, liveness_ok, motivo, marcado_em, marcado_dia, deriva_ms, lat, lng, precisao_m,
          dentro_cerca, distancia_cerca_m, foto_url, requer_revisao)
        VALUES (${m.id_cliente}, ${vinc.empresa_id}, NULL, ${vinc.dispositivo_id}, NULL, ${m.tipo}, 'biometria', 'revisar',
          NULL, ${m.liveness_ok ?? null}, 'aparelho_nao_identificado', ${m.marcado_em}, ${dia}, ${Number(m.deriva_ms) || 0},
          ${m.lat ?? null}, ${m.lng ?? null}, ${m.precisao_m ?? null}, NULL, NULL, ${foto}, true)
        ON CONFLICT (id_cliente) DO NOTHING RETURNING id_cliente`;
      if (!ins.length) { duplicadas++; resultados.push({ id_cliente: m.id_cliente, status: 'duplicado' }); }
      else { emRevisao++; resultados.push({ id_cliente: m.id_cliente, status: 'aceito', revisao: true, pendente_identificacao: true }); }
    }
    return ok(res, { servidor_hora: new Date().toISOString(), estado: 'pendente',
                     resumo: { aceitas, duplicadas, em_revisao: emRevisao }, resultados });
  }

  for (const m of marcacoes.slice(0, 100)) {
    if (!m || !m.id_cliente || !m.tipo || !m.marcado_em) {
      resultados.push({ id_cliente: m && m.id_cliente, status: 'rejeitado', motivo: 'campos obrigatórios ausentes' });
      continue;
    }
    // A marcação é SEMPRE do dono do dispositivo — o cliente não escolhe pessoa.
    const colaboradorId = vinc.colaborador_id;
    const dia = String(m.marcado_dia || m.marcado_em).slice(0, 10);

    // Cerca: mede contra a alocação do dia deste colaborador.
    const alocs = await sql`
      SELECT equipe_id, cerca_lat, cerca_lng, cerca_raio_m FROM alocacao
      WHERE empresa_id = ${vinc.empresa_id} AND colaborador_id = ${colaboradorId} AND dia = ${dia}
      LIMIT 1`;
    const aloc = alocs[0] || null;
    const cerca = aloc ? dentroDaCerca(aloc, m.lat, m.lng, m.precisao_m) : { dentro: null, distancia_m: null };

    const derivaFora = Math.abs(Number(m.deriva_ms) || 0) > DERIVA_MAX_MS;
    const revisar =
      m.veredito !== 'aceito' ||
      m.origem === 'manual' ||
      m.liveness_ok === false ||
      !aloc ||
      cerca.dentro === false ||
      derivaFora;

    const equipeId = (aloc && aloc.equipe_id) || m.equipe_id || null;

    const inseridas = await sql`
      INSERT INTO marcacao (
        id_cliente, empresa_id, colaborador_id, dispositivo_id, equipe_id, tipo, origem, veredito,
        score, liveness_ok, motivo, marcado_em, marcado_dia, deriva_ms,
        lat, lng, precisao_m, dentro_cerca, distancia_cerca_m, foto_url, requer_revisao
      ) VALUES (
        ${m.id_cliente}, ${vinc.empresa_id}, ${colaboradorId}, ${vinc.dispositivo_id}, ${equipeId},
        ${m.tipo}, ${m.origem || 'biometria'}, ${revisar ? 'revisar' : 'aceito'},
        ${m.score ?? null}, ${m.liveness_ok ?? null}, ${m.motivo || null},
        ${m.marcado_em}, ${dia}, ${Number(m.deriva_ms) || 0},
        ${m.lat ?? null}, ${m.lng ?? null}, ${m.precisao_m ?? null},
        ${cerca.dentro}, ${cerca.distancia_m}, ${revisar ? (m.foto_url || null) : null}, ${revisar}
      )
      ON CONFLICT (id_cliente) DO NOTHING
      RETURNING id_cliente`;

    if (!inseridas.length) {
      duplicadas++;
      resultados.push({ id_cliente: m.id_cliente, status: 'duplicado' });
    } else if (revisar) {
      emRevisao++;
      resultados.push({ id_cliente: m.id_cliente, status: 'aceito', revisao: true });
    } else {
      aceitas++;
      resultados.push({ id_cliente: m.id_cliente, status: 'aceito' });
    }
  }

  return ok(res, {
    servidor_hora: new Date().toISOString(),
    resumo: { aceitas, duplicadas, em_revisao: emRevisao },
    resultados
  });
}
