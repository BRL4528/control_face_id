// Configurações da empresa: parâmetros anti-fraude, alarme de registro manual,
// jornada padrão, nome e fuso. Grava em config_empresa.dados (jsonb) + colunas de
// empresa. Só campos conhecidos entram — não é um saco de chave-valor livre.
import { db } from '../_lib/db.js';
import { autenticarRh } from '../_lib/auth.js';
import { exigeAcesso } from '../_lib/acesso.js';
import { cors, ok, erro, corpo, exigeMetodo } from '../_lib/http.js';
import { gerarLinkToken } from '../_lib/dispositivos.js';
import { hashCredencial } from '../_lib/auth.js';
import { randomBytes } from 'node:crypto';
import { contarDados, zerarEmpresa } from '../_lib/reset.js';

// Whitelist de parâmetros aceitos em config_empresa.dados, com coerção segura.
const num = (v, lo, hi, def) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(n, hi)) : def;
};
function sanear(dados) {
  const d = dados || {};
  const out = {};
  if (d.limiarAceite != null) out.limiarAceite = num(d.limiarAceite, 0.2, 0.9, 0.45);
  if (d.limiarCinza != null) out.limiarCinza = num(d.limiarCinza, 0.3, 0.95, 0.58);
  if (d.raioPadraoM != null) out.raioPadraoM = num(d.raioPadraoM, 30, 5000, 200);
  if (d.toleranciaGpsM != null) out.toleranciaGpsM = num(d.toleranciaGpsM, 0, 500, 100);
  if (d.horaEntrada != null && /^([01]\d|2[0-3]):[0-5]\d$/.test(d.horaEntrada)) out.horaEntrada = d.horaEntrada;
  // Gestor pode bater em qualquer perímetro da empresa (visita equipes). Ausente = ligado.
  if (typeof d.gestorQualquerCerca === 'boolean') out.gestorQualquerCerca = d.gestorQualquerCerca;
  if (d.alarmeManual != null) out.alarmeManual = num(d.alarmeManual, 1, 100, 20);
  if (d.jornadaPadrao != null) out.jornadaPadrao = String(d.jornadaPadrao).slice(0, 20);
  // Jornada padrão da empresa: vale para toda equipe sem jornada própria.
  if (d.jornadaPadraoId !== undefined) out.jornadaPadraoId = d.jornadaPadraoId ? String(d.jornadaPadraoId).slice(0, 40) : null;
  // Folha de ponto: razão social e CNPJ do cabeçalho, papel timbrado (imagem A4 de
  // fundo) e logo, como data URL de imagem. null apaga.
  if (d.razaoSocial !== undefined) out.razaoSocial = d.razaoSocial ? String(d.razaoSocial).trim().slice(0, 120) : null;
  if (d.cnpj !== undefined) out.cnpj = d.cnpj ? String(d.cnpj).trim().slice(0, 20) : null;
  for (const k of ['timbrado', 'logo']) {
    if (d[k] === null) out[k] = null;
    else if (typeof d[k] === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(d[k]) && d[k].length <= 700000) out[k] = d[k];
  }
  // Feriados estaduais e municipais (os nacionais o sistema já conhece): [{ dia, nome }].
  if (Array.isArray(d.feriados)) {
    out.feriados = d.feriados
      .filter(f => f && /^\d{4}-\d{2}-\d{2}$/.test(f.dia))
      .map(f => ({ dia: f.dia, nome: String(f.nome || 'Feriado').trim().slice(0, 60) || 'Feriado' }))
      .sort((a, b) => a.dia.localeCompare(b.dia)).slice(0, 200);
  }
  return out;
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (exigeMetodo(req, res, 'POST')) return;
  const rh = autenticarRh(req);
  if (!rh) return erro(res, 401, 'SESSAO_INVALIDA', 'faça login novamente');
  const b = corpo(req);
  const sql = db();
  if (!(await exigeAcesso(res, sql, rh, 'config', true))) return;

  // Novo link da empresa: o antigo para de funcionar na hora (quem já abriu e
  // pareou continua — o token só serve para entrar).
  if (b.acao === 'novo_link') {
    const token = gerarLinkToken();
    await sql`UPDATE empresa SET link_token=${token} WHERE id=${rh.empresa_id}`;
    return ok(res, { link_token: token });
  }

  // Token de integração (robô do Bitrix em /api/integracao/bitrix). Mostrado
  // UMA vez; só o sha256 fica no banco. Gerar de novo invalida o anterior.
  if (b.acao === 'novo_token_integracao') {
    const token = 'pit_' + randomBytes(24).toString('base64url');
    await sql`UPDATE empresa SET integracao_token_hash=${hashCredencial(token)} WHERE id=${rh.empresa_id}`;
    return ok(res, { token });
  }
  if (b.acao === 'revogar_token_integracao') {
    await sql`UPDATE empresa SET integracao_token_hash=NULL WHERE id=${rh.empresa_id}`;
    return ok(res, { revogado: true });
  }

  // Zona de perigo: zera os dados operacionais da empresa (mantém login, config,
  // link e token de integração). Prévia devolve as contagens; executar exige a
  // palavra ZERAR digitada. Detalhes e ordem em api/_lib/reset.js.
  if (b.acao === 'zerar_empresa') {
    if (b.previa) return ok(res, { previa: await contarDados(sql, rh.empresa_id) });
    if (String(b.confirmacao || '').trim() !== 'ZERAR') return erro(res, 400, 'CONFIRMACAO_INVALIDA', 'digite ZERAR para confirmar');
    const r = await zerarEmpresa(sql, rh.empresa_id);
    console.warn('[zerar_empresa]', rh.empresa_id, 'por', rh.usuario, JSON.stringify(r.apagado));
    return ok(res, r);
  }

  // Dados da empresa (nome, fuso).
  const nome = b.empresa_nome != null ? String(b.empresa_nome).trim() : null;
  const fuso = b.fuso != null ? String(b.fuso).trim() : null;
  if (nome) await sql`UPDATE empresa SET nome=${nome} WHERE id=${rh.empresa_id}`;
  if (fuso) await sql`UPDATE empresa SET fuso=${fuso} WHERE id=${rh.empresa_id}`;

  // Parâmetros: merge sobre o que já existe (patch parcial).
  const patch = sanear(b.dados);
  if (Object.keys(patch).length) {
    const atual = await sql`SELECT dados FROM config_empresa WHERE empresa_id=${rh.empresa_id} LIMIT 1`;
    const base = (atual[0] && atual[0].dados) || {};
    const merged = Object.assign({}, base, patch);
    await sql`
      INSERT INTO config_empresa (empresa_id, dados, atualizada_em)
      VALUES (${rh.empresa_id}, ${JSON.stringify(merged)}, now())
      ON CONFLICT (empresa_id) DO UPDATE SET dados=EXCLUDED.dados, atualizada_em=now()`;
  }
  return ok(res, { salvo: true });
}
