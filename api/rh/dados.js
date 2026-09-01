// Painel do RH numa chamada: equipes, colaboradores, marcações do período,
// alocações de hoje e pendências. Os indicadores e o espelho de ponto são
// calculados no cliente (js/regras.js), como no piloto — as mesmas funções que
// os testes de unidade cobrem.
import { db } from '../_lib/db.js';
import { autenticarRh } from '../_lib/auth.js';
import { cors, ok, erro, exigeMetodo } from '../_lib/http.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (exigeMetodo(req, res, 'POST')) return;

  const rh = autenticarRh(req);
  if (!rh) return erro(res, 401, 'SESSAO_INVALIDA', 'faça login novamente');

  const dias = Math.min(Math.max(Number((req.body || {}).dias) || 30, 1), 365);
  const empresa = rh.empresa_id;
  const hoje = new Date().toISOString().slice(0, 10);
  const sql = db();

  const [equipes, pessoas, marcacoes, alocacoesHoje, locais] = await Promise.all([
    sql`SELECT id AS equipe_id, nome, ativo FROM equipe WHERE empresa_id = ${empresa} ORDER BY nome`,
    sql`SELECT c.id AS pessoa_id, c.nome, c.matricula, c.papel, c.equipe_padrao AS equipe_id, c.ativo,
               EXISTS(SELECT 1 FROM template_facial t WHERE t.colaborador_id = c.id AND t.estado='ativo') AS tem_biometria,
               (SELECT miniatura_url FROM template_facial t WHERE t.colaborador_id=c.id AND t.estado='ativo' ORDER BY versao DESC LIMIT 1) AS miniatura
        FROM colaborador c WHERE c.empresa_id = ${empresa} ORDER BY c.nome`,
    sql`SELECT m.id_cliente, m.colaborador_id AS pessoa_id, m.equipe_id, m.tipo, m.origem, m.veredito,
               m.marcado_em, m.marcado_dia, m.deriva_ms AS deriva_relogio_ms, m.dentro_cerca,
               m.distancia_cerca_m, m.foto_url AS foto_auditoria, m.requer_revisao,
               (m.requer_revisao AND NOT EXISTS(
                  SELECT 1 FROM correcao co WHERE co.alvo_tipo='marcacao' AND co.alvo_id=m.id_cliente)) AS pendente
        FROM marcacao m
        WHERE m.empresa_id = ${empresa} AND m.marcado_dia >= (CURRENT_DATE - ${dias}::int)
        ORDER BY m.marcado_em DESC`,
    sql`SELECT a.colaborador_id, a.equipe_id, a.cerca_lat, a.cerca_lng, a.cerca_raio_m
        FROM alocacao a WHERE a.empresa_id = ${empresa} AND a.dia = ${hoje}`,
    sql`SELECT id AS local_id, nome, lat, lng, raio_m FROM local
        WHERE empresa_id = ${empresa} AND ativo = true ORDER BY nome`
  ]);

  return ok(res, {
    usuario: { nome: rh.nome, usuario: rh.usuario },
    empresa_id: empresa,   // o app do colaborador usa como "código da empresa" no pareamento
    periodo_dias: dias,
    servidor_hora: new Date().toISOString(),
    equipes, pessoas, marcacoes, locais,
    alocacoes_hoje: alocacoesHoje,
    recadastros: []  // recadastro pendente entra quando o autocadastro do gestor existir
  });
}
