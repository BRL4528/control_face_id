// Decisão do RH sobre uma pendência (marcação em revisão ou template pendente).
// NUNCA altera a marcação original — grava uma linha em correcao. O estado atual
// de uma marcação é derivado: marcação + última correção que a referencia.
import { db, novoId } from '../_lib/db.js';
import { autenticarRh } from '../_lib/auth.js';
import { exigeAcesso, noEscopo } from '../_lib/acesso.js';
import { obrasDe } from '../../js/acessos.js';
import { cors, ok, erro, corpo, exigeMetodo } from '../_lib/http.js';
import { dentroDaCerca } from '../_lib/geo.js';
import { cercaVigente } from '../_lib/escala.js';
import { ocorrenciaVigente } from '../_lib/ocorrencia.js';
import { daEmpresa } from '../_lib/validar.js';
import { comentarNoCard, montarComentario } from '../_lib/bitrix-saida.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (exigeMetodo(req, res, 'POST')) return;
  const rh = autenticarRh(req);
  if (!rh) return erro(res, 401, 'SESSAO_INVALIDA', 'faça login novamente');

  const acesso = await exigeAcesso(res, db(), rh, 'ponto', true);
  if (!acesso) return;
  const b = corpo(req);
  // Gestor de obra decide batidas da obra dele; aparelho e cadastro facial são do RH.
  if (obrasDe(acesso) && b.tipo !== 'marcacao' && b.tipo != null) return erro(res, 403, 'SEM_PERMISSAO', 'só o RH identifica aparelhos e cadastros faciais');
  // A decisão precisa ser justificada: ela fica na auditoria e no card do Bitrix.
  b.motivo = String(b.motivo || '').trim();
  const bloqueio = b.tipo === 'dispositivo' && b.acao === 'bloquear';
  if ((b.tipo !== 'dispositivo' || bloqueio) && !b.motivo) {
    return erro(res, 400, 'DECISAO_OBRIGATORIA', 'informe a decisão (justificativa)');
  }
  if (b.tipo === 'dispositivo') return decidirDispositivo(req, res, rh, b);
  const tipo = b.tipo === 'template' ? 'template' : 'marcacao';
  const acao = b.acao === 'rejeitar' ? 'rejeitar' : 'aprovar';
  if (!b.id) return erro(res, 400, 'CORPO_INVALIDO', 'id obrigatório');
  const sql = db();
  let alvoColab = null, alvo = null;

  // Isolamento de tenant: o alvo precisa pertencer à empresa do RH. Marcação
  // tem empresa_id direto; template chega ao dono via colaborador.
  if (tipo === 'template') {
    const dono = await sql`SELECT c.id, c.nome, c.matricula, c.bitrix_card_id, t.versao, t.origem, t.criado_em
                           FROM template_facial t JOIN colaborador c ON c.id=t.colaborador_id
                           WHERE t.id=${b.id} AND c.empresa_id=${rh.empresa_id} LIMIT 1`;
    alvoColab = dono[0] || null;
    alvo = dono[0] || null;
    if (!dono[0]) return erro(res, 404, 'ALVO_NAO_ENCONTRADO', 'cadastro facial não encontrado');
  } else {
    const dono = await sql`SELECT c.id, c.nome, c.matricula, c.bitrix_card_id, m.tipo, m.origem, m.veredito, m.motivo AS motivo_revisao,
                                  m.marcado_em, m.dentro_cerca, m.distancia_cerca_m, m.liveness_ok, m.lat, m.lng, m.precisao_m,
                                  eq.nome AS equipe
                           FROM marcacao m LEFT JOIN colaborador c ON c.id=m.colaborador_id LEFT JOIN equipe eq ON eq.id=m.equipe_id AND eq.empresa_id=m.empresa_id
                           WHERE m.id_cliente=${b.id} AND m.empresa_id=${rh.empresa_id} LIMIT 1`;
    alvoColab = dono[0] && dono[0].id ? dono[0] : null;
    if (obrasDe(acesso) && !(alvoColab && await noEscopo(sql, acesso, rh.empresa_id, alvoColab.id))) return erro(res, 403, 'SEM_PERMISSAO', 'batida fora das suas obras');
    alvo = dono[0] || null;
    if (!dono[0]) return erro(res, 404, 'ALVO_NAO_ENCONTRADO', 'marcação não encontrada');
  }

  await sql`
    INSERT INTO correcao (id, empresa_id, alvo_tipo, alvo_id, acao, motivo, usuario_rh_id)
    VALUES (${novoId()}, ${rh.empresa_id}, ${tipo}, ${b.id}, ${acao}, ${b.motivo || null}, ${rh.sub})`;

  // Template: aprovar mantém ativo; rejeitar volta o anterior a ativo.
  if (tipo === 'template') {
    if (acao === 'rejeitar') {
      const alvos = await sql`SELECT colaborador_id FROM template_facial WHERE id=${b.id} LIMIT 1`;
      if (alvos[0]) {
        await sql`UPDATE template_facial SET estado='reprovado' WHERE id=${b.id}`;
        await sql`UPDATE template_facial SET estado='ativo'
                  WHERE colaborador_id=${alvos[0].colaborador_id} AND estado='substituido'
                  AND versao=(SELECT MAX(versao) FROM template_facial
                              WHERE colaborador_id=${alvos[0].colaborador_id} AND estado='substituido')`;
      }
    } else {
      await sql`UPDATE template_facial SET estado='ativo' WHERE id=${b.id}`;
    }
  }
  if (alvoColab) {
    const fuso = (await sql`SELECT fuso FROM empresa WHERE id=${rh.empresa_id} LIMIT 1`)[0];
    await comentarNoCard(alvoColab, montarComentario({
      tipo, acao, decisao: b.motivo, rh: rh.nome || rh.usuario || 'RH', alvoId: b.id, alvo, fuso: fuso && fuso.fuso
    }));
  }
  return ok(res, { decidido: true });
}

/**
 * Batida de aparelho pendente atribuída pelo RH: continua em revisão? Mesmas
 * regras de /api/ponto, menos as de identidade (o RH acabou de confirmar quem é).
 *   temCerca  há cerca no dia (escala ou local da equipe, cercaVigente)
 *   cerca     { dentro, distancia_m } medida contra ela
 *   ocorrencia  ocorrenciaVigente do dia (viagem dispensa a cerca; férias,
 *             afastamento e licença bloqueiam a batida e mandam para o RH)
 *   deriva_ms relógio do aparelho contra o servidor (fora de 2 min vai para o RH)
 * Devolve { revisar, motivo, cerca } (cerca já com a dispensa da viagem). O motivo
 * junta todas as razões, em texto (vai para o painel e para o card do Bitrix).
 */
export function revisaoDaAtribuicao({ temCerca, cerca, liveness_ok, afastado, ocorrencia, deriva_ms }) {
  const oc = ocorrencia || null;
  let c = cerca || { dentro: null, distancia_m: null };
  const externo = !!(oc && oc.semCerca) && c.dentro !== true;
  if (externo) c = { dentro: true, distancia_m: c.distancia_m };
  const motivos = [];
  if (afastado) motivos.push('colaborador afastado');
  if (oc && oc.bloqueia) motivos.push('colaborador em ' + rotuloMinusculo(oc.rotulo));
  if (!temCerca && !externo) motivos.push('sem cerca no dia');
  if (c.dentro === false) motivos.push('fora da cerca');
  if (liveness_ok === false) motivos.push('sem prova de vida');
  if (Math.abs(Number(deriva_ms) || 0) > DERIVA_MAX_MS) motivos.push('relógio do aparelho fora do horário');
  const revisar = motivos.length > 0;
  const motivo = revisar ? motivos.join(' · ') : 'identificado pelo RH' + (externo ? ' · trabalho externo (viagem)' : '');
  return { revisar, motivo, cerca: c };
}

// Mesmo limite de /api/ponto: relógio do aparelho a mais de 2 min do servidor.
const DERIVA_MAX_MS = 120000;

// 'Afastamento INSS' → 'afastamento INSS': baixa só a 1ª letra, a sigla fica.
const rotuloMinusculo = r => { const t = String(r || ''); return t.charAt(0).toLowerCase() + t.slice(1); };

/**
 * Aparelho PENDENTE (bateu ponto pelo link da empresa, sem identidade).
 *   • acao 'identificar' { id: dispositivo_id, colaborador_id } ou
 *     { id, novo: { nome, matricula, equipe_id } }: pareia o aparelho à pessoa,
 *     transforma o cadastro facial capturado no 1º ponto em template ativo e
 *     ATRIBUI todas as marcações pendentes do aparelho (valem retroativamente,
 *     reconferindo a cerca contra a alocação de cada dia).
 *   • acao 'bloquear' { id, motivo? }: aparelho vira bloqueado (403 daqui em
 *     diante) e as marcações pendentes dele saem da fila como rejeitadas.
 * Tudo vai para `correcao` (auditoria), como as demais decisões.
 */
async function decidirDispositivo(req, res, rh, b) {
  const sql = db();
  const disp = (await sql`SELECT * FROM dispositivo WHERE id=${b.id} AND empresa_id=${rh.empresa_id} LIMIT 1`)[0];
  if (!disp) return erro(res, 404, 'ALVO_NAO_ENCONTRADO', 'aparelho não encontrado');

  if (b.acao === 'bloquear') {
    await sql`UPDATE dispositivo SET estado='bloqueado', bloqueado_em=now(), motivo_bloqueio='rejeitado_rh' WHERE id=${disp.id}`;
    // marcacao é IMUTÁVEL (trigger): a rejeição é uma correção por marcação, como
    // nas demais decisões — a fila deriva "pendente" de "não tem correção".
    const pend = await sql`SELECT m.id_cliente FROM marcacao m WHERE m.dispositivo_id=${disp.id} AND m.colaborador_id IS NULL
                           AND NOT EXISTS (SELECT 1 FROM correcao co WHERE co.alvo_tipo='marcacao' AND co.alvo_id=m.id_cliente)`;
    for (const m of pend) {
      await sql`INSERT INTO correcao (id, empresa_id, alvo_tipo, alvo_id, acao, motivo, usuario_rh_id)
                VALUES (${novoId()}, ${rh.empresa_id}, 'marcacao', ${m.id_cliente}, 'rejeitar', 'aparelho bloqueado pelo RH', ${rh.sub})`;
    }
    await sql`INSERT INTO correcao (id, empresa_id, alvo_tipo, alvo_id, acao, motivo, usuario_rh_id)
              VALUES (${novoId()}, ${rh.empresa_id}, 'dispositivo', ${disp.id}, 'bloquear', ${b.motivo}, ${rh.sub})`;
    return ok(res, { bloqueado: true, marcacoes_rejeitadas: pend.length });
  }

  if (b.acao !== 'identificar') return erro(res, 400, 'CORPO_INVALIDO', "acao deve ser 'identificar' ou 'bloquear'");
  if (disp.estado !== 'pendente') return erro(res, 409, 'ESTADO_INVALIDO', 'este aparelho não está pendente');

  // 1) Quem é: colaborador existente ou novo (nome + matrícula).
  let colab = null;
  if (b.colaborador_id) {
    colab = (await sql`SELECT id, nome FROM colaborador WHERE id=${b.colaborador_id} AND empresa_id=${rh.empresa_id} AND ativo=true LIMIT 1`)[0];
    if (!colab) return erro(res, 404, 'COLABORADOR_NAO_ENCONTRADO', 'colaborador não encontrado ou inativo');
  } else if (b.novo && b.novo.nome && b.novo.matricula) {
    const nome = String(b.novo.nome).trim(), mat = String(b.novo.matricula).trim();
    const existe = (await sql`SELECT id FROM colaborador WHERE empresa_id=${rh.empresa_id} AND matricula=${mat} LIMIT 1`)[0];
    if (existe) return erro(res, 409, 'MATRICULA_EM_USO', 'já existe colaborador com esta matrícula; selecione-o na lista');
    // A equipe tem de ser desta empresa (a FK não olha empresa_id): conferida antes
    // de gravar qualquer coisa, para o aparelho continuar pendente se for recusada.
    const equipeId = b.novo.equipe_id ? String(b.novo.equipe_id) : null;
    if (equipeId && !(await daEmpresa(sql, 'equipe', equipeId, rh.empresa_id))) return erro(res, 404, 'EQUIPE_NAO_ENCONTRADA', 'equipe não encontrada');
    const id = novoId();
    await sql`INSERT INTO colaborador (id, empresa_id, nome, matricula, papel, equipe_padrao)
              VALUES (${id}, ${rh.empresa_id}, ${nome}, ${mat}, 'colaborador', ${equipeId})`;
    colab = { id, nome };
  } else {
    return erro(res, 400, 'CORPO_INVALIDO', 'informe colaborador_id ou novo {nome, matricula}');
  }

  // 2) Aparelho: vira o único ativo da pessoa.
  await sql`UPDATE dispositivo SET ativo=false WHERE colaborador_id=${colab.id} AND ativo=true AND id<>${disp.id}`;
  await sql`UPDATE dispositivo SET colaborador_id=${colab.id}, estado='ativo', ativo=true, matricula_informada=NULL WHERE id=${disp.id}`;

  // 3) Cadastro facial do 1º ponto vira template ativo (aposenta o anterior).
  let template = false;
  if (disp.cadastro && Array.isArray(disp.cadastro.vetores) && disp.cadastro.vetores.length) {
    const vers = await sql`SELECT COALESCE(MAX(versao),0)+1 AS prox FROM template_facial WHERE colaborador_id=${colab.id}`;
    await sql`UPDATE template_facial SET estado='substituido' WHERE colaborador_id=${colab.id} AND estado='ativo'`;
    await sql`INSERT INTO template_facial (id, colaborador_id, versao, vetores, miniatura_url, estado, origem)
              VALUES (${novoId()}, ${colab.id}, ${vers[0].prox}, ${JSON.stringify(disp.cadastro.vetores)}, ${disp.cadastro.miniatura_url || null}, 'ativo', 'autocadastro')`;
    template = true;
  }

  // 4) Marcações pendentes do aparelho → valem para a pessoa. marcacao é IMUTÁVEL
  //    (trigger REP-P): cada uma vira um LANÇAMENTO NOVO no nome do colaborador
  //    (mesma hora/GPS/foto, cerca reconferida como em /api/ponto: a escala do dia
  //    se houver, senão o local da equipe da pessoa, cercaVigente) e a original
  //    recebe a correção 'atribuir' que a tira da fila e aponta a nova.
  // Datas como texto: DATE vem como Date do driver e String(Date) vira 'Tue Sep 08'.
  const pend = await sql`SELECT m.id_cliente, m.tipo, m.marcado_em, to_char(m.marcado_dia,'YYYY-MM-DD') AS marcado_dia,
                                m.deriva_ms, m.lat, m.lng, m.precisao_m, m.liveness_ok, m.foto_url
                         FROM marcacao m WHERE m.dispositivo_id=${disp.id} AND m.colaborador_id IS NULL
                         AND NOT EXISTS (SELECT 1 FROM correcao co WHERE co.alvo_tipo='marcacao' AND co.alvo_id=m.id_cliente)`;
  let atribuidas = 0, emRevisao = 0;
  for (const m of pend) {
    const dia = String(m.marcado_dia).slice(0, 10);
    const aloc = await cercaVigente(sql, rh.empresa_id, colab.id, dia);
    const temCerca = !!(aloc && aloc.cerca_lat != null);
    const medida = temCerca ? dentroDaCerca(aloc, m.lat, m.lng, m.precisao_m) : { dentro: null, distancia_m: null };
    const oc = await ocorrenciaVigente(sql, rh.empresa_id, colab.id, dia);
    // O RH acabou de confirmar a identidade: só continua em revisão pelo resto
    // (cerca, prova de vida, afastamento, ocorrência que bloqueia a batida).
    const { revisar, motivo, cerca } = revisaoDaAtribuicao({ temCerca, cerca: medida, liveness_ok: m.liveness_ok,
                                                             afastado: !!(aloc && aloc.afastado), ocorrencia: oc, deriva_ms: m.deriva_ms });
    const novoIdCliente = novoId();
    await sql`
      INSERT INTO marcacao (id_cliente, empresa_id, colaborador_id, dispositivo_id, equipe_id, tipo, origem, veredito,
        score, liveness_ok, motivo, marcado_em, marcado_dia, deriva_ms, lat, lng, precisao_m,
        dentro_cerca, distancia_cerca_m, foto_url, requer_revisao)
      VALUES (${novoIdCliente}, ${rh.empresa_id}, ${colab.id}, ${disp.id}, ${(aloc && aloc.equipe_id) || null}, ${m.tipo}, 'biometria',
        ${revisar ? 'revisar' : 'aceito'}, NULL, ${m.liveness_ok}, ${motivo},
        ${m.marcado_em}, ${dia}, ${m.deriva_ms || 0}, ${m.lat}, ${m.lng}, ${m.precisao_m},
        ${cerca.dentro}, ${cerca.distancia_m}, ${revisar ? m.foto_url : null}, ${revisar})`;
    await sql`INSERT INTO correcao (id, empresa_id, alvo_tipo, alvo_id, acao, motivo, usuario_rh_id)
              VALUES (${novoId()}, ${rh.empresa_id}, 'marcacao', ${m.id_cliente}, 'atribuir', ${'colaborador:' + colab.id + ' lancamento:' + novoIdCliente}, ${rh.sub})`;
    atribuidas++; if (revisar) emRevisao++;
  }

  await sql`INSERT INTO correcao (id, empresa_id, alvo_tipo, alvo_id, acao, motivo, usuario_rh_id)
            VALUES (${novoId()}, ${rh.empresa_id}, 'dispositivo', ${disp.id}, 'identificar', ${'colaborador:' + colab.id}, ${rh.sub})`;
  return ok(res, { colaborador_id: colab.id, nome: colab.nome, template_criado: template, marcacoes_atribuidas: atribuidas, ainda_em_revisao: emRevisao });
}
