// Painel do gestor (T-8FB792). A sessão nasce em js/fila.js — só o servidor
// decide quem é gestor e emite `sessao_gestor` (docs/adr-acesso-v3.md §
// Sessão facial do gestor). Este módulo só guarda o token em memória, nunca
// em IndexedDB, e o esquece ao sair ou expirar.
//
// Regras não negociáveis (docs/plano-v3.md § privacidade da tela
// compartilhada): não abre automático (quem abre é o link no comprovante,
// em js/fila.js); abre AGREGADO primeiro; nome individual só num segundo
// toque; lista de ausentes antes da de presentes; corpo pequeno em tudo que
// não seja hora/contador — os KPIs do resumo são os únicos números grandes.
//
// Ajuste do gestor é sempre PROPOSTA (`estado: pendente_rh`), nunca altera a
// marcação. Só "incluir_marcacao" está disponível aqui: o contrato de
// /efrat/gestor/equipe-hoje devolve `ultima_marcacao` sem id (nem no
// servidor-falso, nem no ADR), então alterar/excluir não são acionáveis a
// partir desta tela sem o servidor passar a expor esse id — fora do escopo
// desta rodada.
import { ApiGestor } from './api.js';
import { $, esc, mostrar, toast } from './ui.js';

const MOTIVO_MIN = 10, MOTIVO_MAX = 500;
const TTL_ABSOLUTO_MS = 10 * 60000, TTL_INATIVIDADE_MS = 5 * 60000;

export const Gestor = {
  sessao: null,        // { token, expiraEm }
  resumo: null,
  pessoas: [],
  aoSair: null,
  nomesAbertos: false,
  _timerAbsoluto: null,
  _timerInatividade: null,

  async abrir(sessao, aoSair) {
    if (!sessao || !sessao.token) { toast('Sessão de gestor indisponível', 'warn'); if (aoSair) aoSair(); return; }
    this.sessao = sessao;
    this.aoSair = aoSair;
    this.nomesAbertos = false;
    mostrar('painelGestor');
    $('btnSairGestor').onclick = () => this.sair();
    this.armarTimers();
    await this.carregar();
  },

  armarTimers() {
    clearTimeout(this._timerAbsoluto);
    const restante = this.sessao.expiraEm ? Date.parse(this.sessao.expiraEm) - Date.now() : TTL_ABSOLUTO_MS;
    this._timerAbsoluto = setTimeout(() => this.expirar(), Math.max(0, restante));
    this.reiniciarInatividade();
  },

  reiniciarInatividade() {
    clearTimeout(this._timerInatividade);
    this._timerInatividade = setTimeout(() => this.expirar(), TTL_INATIVIDADE_MS);
  },

  async carregar() {
    $('gestorConteudo').innerHTML = '<p class="nota">Carregando…</p>';
    const hoje = new Date().toISOString().slice(0, 10);
    const fuso = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const r = await ApiGestor.equipeHoje(this.sessao.token, { data_local: hoje, timezone: fuso });
    if (!r.ok) return this.tratarErro(r);
    this.resumo = r.dados.resumo;
    this.pessoas = r.dados.pessoas || [];
    this.pintar();
  },

  tratarErro(r) {
    if (r.status === 401) { this.expirar(); return; }
    toast((r.erro && r.erro.mensagem) || 'Não consegui carregar a equipe', 'bad');
    $('gestorConteudo').innerHTML = '<p class="nota">Não consegui carregar agora.</p>';
  },

  /* --------------------------------------------------- agregado/nomes */

  pintar() {
    const res = this.resumo || { em_jornada: 0, em_intervalo: 0, ausentes: 0 };
    $('gestorConteudo').innerHTML =
      '<div class="tiles">' +
        '<div class="kpi"><div class="lab">Em jornada</div><div class="val mono">' + res.em_jornada + '</div></div>' +
        '<div class="kpi"><div class="lab">Intervalo</div><div class="val mono">' + res.em_intervalo + '</div></div>' +
        '<div class="kpi"><div class="lab">Ausentes</div><div class="val mono">' + res.ausentes + '</div></div>' +
      '</div>' +
      (this.nomesAbertos ? this.htmlNomes() : '<button class="verdados" id="btnVerNomes">Ver nomes</button>');
    if (this.nomesAbertos) {
      $('gestorConteudo').querySelectorAll('.linha-item').forEach(b => {
        b.onclick = () => this.abrirAjuste(b.dataset.id);
      });
    } else {
      $('btnVerNomes').onclick = () => { this.reiniciarInatividade(); this.nomesAbertos = true; this.pintar(); };
    }
  },

  /** Ausentes antes de presentes — é o que o gestor precisa saber primeiro. */
  htmlNomes() {
    const ausentes = this.pessoas.filter(p => p.estado === 'ausente');
    const presentes = this.pessoas.filter(p => p.estado !== 'ausente');
    const linha = p => '<button class="linha-item" data-id="' + esc(p.pessoa_id) + '">' +
        '<div><div class="nm">' + esc(p.nome) + '</div>' +
        '<div class="mt">' + (p.estado === 'ausente' ? 'Ausente' :
          '<span class="pilula">' + (p.estado === 'em_intervalo' ? 'Intervalo' : 'Em jornada') + '</span>') +
        '</div></div></button>';
    return '<div class="card"><h2>Ausentes</h2>' +
        (ausentes.length ? ausentes.map(linha).join('') : '<p class="nota">Ninguém ausente.</p>') + '</div>' +
      '<div class="card"><h2>Presentes</h2>' +
        (presentes.length ? presentes.map(linha).join('') : '<p class="nota">Ninguém presente.</p>') + '</div>';
  },

  voltarNomes() { this.reiniciarInatividade(); this.pintar(); },

  /* -------------------------------------------------------- ajuste */

  abrirAjuste(pessoaId) {
    const p = this.pessoas.find(x => x.pessoa_id === pessoaId);
    if (!p) return;
    this.reiniciarInatividade();
    const sugestao = !p.ultima_marcacao || p.ultima_marcacao.tipo === 'saida' ? 'entrada' : 'saida';
    $('gestorConteudo').innerHTML =
      '<div class="card">' +
        '<h2>Ajustar ' + esc(p.nome) + '</h2>' +
        '<p class="nota">Vira pendência do RH — não altera o registro direto.</p>' +
        '<label class="lb">Tipo</label>' +
        '<select id="ajTipo">' +
          '<option value="entrada"' + (sugestao === 'entrada' ? ' selected' : '') + '>Entrada</option>' +
          '<option value="saida"' + (sugestao === 'saida' ? ' selected' : '') + '>Saída</option>' +
        '</select>' +
        '<label class="lb">Hora</label>' +
        '<input type="time" id="ajHora">' +
        '<label class="lb">Motivo</label>' +
        '<textarea id="ajMotivo" rows="3" placeholder="Mínimo 10 caracteres"></textarea>' +
        '<button class="act" id="btnEnviarAjuste">Enviar proposta ao RH</button>' +
        '<button class="act ghost" id="btnCancelarAjuste">Cancelar</button>' +
      '</div>';
    $('btnEnviarAjuste').onclick = () => this.enviarAjuste(p);
    $('btnCancelarAjuste').onclick = () => this.voltarNomes();
  },

  async enviarAjuste(pessoa) {
    this.reiniciarInatividade();
    const tipo = $('ajTipo').value;
    const horaTxt = $('ajHora').value;
    const motivo = $('ajMotivo').value.trim();
    if (!horaTxt) { toast('Informe a hora', 'warn'); return; }
    if (motivo.length < MOTIVO_MIN || motivo.length > MOTIVO_MAX) {
      toast('Motivo precisa ter entre ' + MOTIVO_MIN + ' e ' + MOTIVO_MAX + ' caracteres', 'warn');
      return;
    }
    const [h, m] = horaTxt.split(':').map(Number);
    const em = new Date();
    em.setHours(h, m, 0, 0);
    const hoje = new Date().toISOString().slice(0, 10);

    const btn = $('btnEnviarAjuste');
    btn.disabled = true; btn.textContent = 'Enviando…';
    const r = await ApiGestor.ajustar(this.sessao.token, {
      pessoa_id: pessoa.pessoa_id, data_local: hoje, acao: 'incluir_marcacao',
      marcacao: { tipo, em: em.toISOString() }, motivo
    }, crypto.randomUUID());
    if (btn.isConnected) { btn.disabled = false; btn.textContent = 'Enviar proposta ao RH'; }

    if (!r.ok) {
      if (r.status === 401) { this.expirar(); return; }
      toast((r.erro && r.erro.mensagem) || 'Não consegui enviar', 'bad');
      return;
    }
    toast('Proposta enviada ao RH — pendente de aprovação', 'ok');
    this.nomesAbertos = true;
    await this.carregar();
  },

  /* ------------------------------------------------------------ saída */

  sair() {
    clearTimeout(this._timerAbsoluto);
    clearTimeout(this._timerInatividade);
    $('gestorConteudo').innerHTML = '';
    this.sessao = null; this.resumo = null; this.pessoas = []; this.nomesAbertos = false;
    const aoSair = this.aoSair; this.aoSair = null;
    if (aoSair) aoSair();
  },

  /** TTL estourou (absoluto ou inatividade), ou o servidor devolveu 401. */
  expirar() {
    toast('Sessão do gestor expirou', 'warn');
    this.sair();
  }
};
