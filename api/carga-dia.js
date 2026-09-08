// Carga do dia para o celular do colaborador. Diferente do piloto: não baixa a
// equipe inteira (não há galeria 1:N). Baixa só o que ESTE colaborador precisa
// para bater o próprio ponto offline:
//
//   • o template facial ativo dele (vetores) — para o match 1:1 no aparelho;
//   • a alocação de hoje: equipe e cerca (centro + raio) — para checar o GPS.
//
// servidor_hora vai junto para o cliente medir a deriva do relógio. Se não há
// alocação para hoje, o app ainda deixa bater ponto, mas a marcação vai sem
// cerca e cai em revisão do RH — o ponto nunca é negado por falta de alocação.
import { db } from './_lib/db.js';
import { autenticarDispositivo } from './_lib/auth.js';
import { cors, ok, erro, corpo, exigeMetodo } from './_lib/http.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (exigeMetodo(req, res, 'POST')) return;

  const vinc = await autenticarDispositivo(req);
  if (!vinc) return erro(res, 401, 'CREDENCIAL_INVALIDA', 'dispositivo não autenticado');
  // Bloqueado (saiu da empresa / RH rejeitou): 403 explícito — o app trava a tela
  // e para de sincronizar, em vez de ficar tentando para sempre.
  if (vinc.bloqueado) return erro(res, 403, 'BLOQUEADO', 'este aparelho foi bloqueado pelo RH');

  const dia = String(corpo(req).dia || new Date().toISOString().slice(0, 10));
  const sql = db();
  await sql`UPDATE dispositivo SET visto_em=now() WHERE id=${vinc.dispositivo_id}`;

  // Pendente: ainda sem colaborador. O app segue batendo (as marcações ficam
  // para o RH identificar); não há template nem alocação para mandar.
  if (vinc.estado === 'pendente') {
    return ok(res, { estado: 'pendente', colaborador: null, template: null, alocacao: null,
                     matricula_informada: vinc.matricula_informada || null, servidor_hora: new Date().toISOString() });
  }

  const templates = await sql`
    SELECT versao, vetores FROM template_facial
    WHERE colaborador_id = ${vinc.colaborador_id} AND estado = 'ativo'
    ORDER BY versao DESC LIMIT 1`;

  const alocs = await sql`
    SELECT a.equipe_id, e.nome AS equipe_nome, a.cerca_lat, a.cerca_lng, a.cerca_raio_m
    FROM alocacao a JOIN equipe e ON e.id = a.equipe_id
    WHERE a.empresa_id = ${vinc.empresa_id}
      AND a.colaborador_id = ${vinc.colaborador_id} AND a.dia = ${dia}
    LIMIT 1`;

  const t = templates[0];
  const a = alocs[0] || null;
  return ok(res, {
    estado: 'ativo',
    colaborador: { id: vinc.colaborador_id, nome: vinc.nome, papel: vinc.papel },
    template: t ? { versao: t.versao, vetores: t.vetores } : null,
    alocacao: a ? {
      equipe_id: a.equipe_id, equipe_nome: a.equipe_nome,
      cerca: { lat: a.cerca_lat, lng: a.cerca_lng, raio_m: a.cerca_raio_m }
    } : null,
    servidor_hora: new Date().toISOString()
  });
}
