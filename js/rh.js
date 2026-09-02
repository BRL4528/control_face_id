// Painel do RH. Tudo que é administração vive aqui e em lugar nenhum mais.
import { ApiRh } from './api.js';
import { Alocacao } from './alocacao.js';
import { MapaOp } from './mapa.js';
import { PlanoEditor } from './plano.js';
import { Face } from './face.js';
import { derivar } from './cripto.js';
import {
  indicadores, espelho, euclidiana,
  presencaPorEquipe, serieDiaria, pendenciasPorMotivo,
  exceptionsDoDia, TIPOS_EXCECAO,
  jornadaDaEquipe, horasEntradaPorEquipe, csvDe,
  alertasDePlanejamento
} from './regras.js';
import { $, esc, mostrar, toast, hora, data } from './ui.js';

// Rótulo da aba na trilha do topo (breadcrumb) e no título de página.
const TITULOS = {
  painel: 'Central operacional', alocacao: 'Alocações', planos: 'Planos recorrentes', mapa: 'Mapa',
  pendencias: 'Pendências', registros: 'Espelho de ponto', jornadas: 'Jornadas',
  pessoas: 'Colaboradores', equipes: 'Equipes',
  relatorios: 'Relatórios', auditoria: 'Auditoria', config: 'Configurações'
};
const ABAS = ['painel', 'alocacao', 'planos', 'mapa', 'pendencias', 'pessoas', 'equipes',
  'registros', 'jornadas', 'relatorios', 'auditoria', 'config', 'stub'];

export const Rh = {
  token: null,       // JWT emitido por /rh/login
  dados: null,
  aba: 'painel',
  stub: null,        // rótulo da tela "entra depois" quando aba === 'stub'
  pendSel: null,     // exceção selecionada no master-detail de pendências
  pendTab: 'abertas',
  buscaPessoas: '',
  aoSair: null,
  capturas: [],
  alvoCadastro: null,
  dias: 30,          // período ativo do painel (7 / 30 / 90)
  _charts: [],       // instâncias Chart.js vivas, destruídas ao repintar
  _Chart: null,      // biblioteca carregada sob demanda

  usuarioLogin: null,   // guardado para o fluxo de troca de senha temporária
  precisaTrocarSenha: false,

  async entrar(usuario, senha) {
    const s = await ApiRh.sal(usuario);
    if (!s.ok || !s.json) return { ok: false, erro: 'servidor indisponível' };
    const chave = await derivar(senha, s.json.sal, s.json.iteracoes);
    const login = await ApiRh.login(usuario, chave);
    if (!login.ok) return { ok: false, erro: login.erro || 'usuário ou senha inválidos' };
    this.token = login.dados.token;
    this.usuarioLogin = usuario;
    this.precisaTrocarSenha = !!login.dados.trocar_senha;
    const d = await ApiRh.dados(this.token, this.dias);
    if (!d.ok) return { ok: false, erro: d.erro || 'falha ao carregar' };
    this.dados = d.dados;
    this.aplicarConfig();
    return { ok: true };
  },

  /** Mescla a config da empresa (banco) sobre os defaults de EFRAT_CFG. */
  aplicarConfig() {
    const c = (this.dados && this.dados.config) || {};
    window.EFRAT_CFG = Object.assign(window.EFRAT_CFG || {}, c);
  },

  async recarregar() {
    const d = await ApiRh.dados(this.token, this.dias);
    if (d.ok) { this.dados = d.dados; this.aplicarConfig(); }
    this.pintar();
  },

  abrir(aoSair) {
    this.aoSair = aoSair;
    mostrar('rh');
    // Senha temporária: obriga a troca antes de liberar o painel.
    if (this.precisaTrocarSenha) { this.telaTrocarSenha(); return; }
    const nome = this.dados.usuario.nome || 'RH';
    $('rhNome').textContent = nome;
    $('rhIniciais').textContent = this.iniciais(nome);
    $('rhEmpresa').textContent = this.dados.usuario.usuario ? ('@' + this.dados.usuario.usuario) : 'Painel do RH';
    $('rhPeriodo').textContent = 'últimos ' + this.dados.periodo_dias + ' dias';
    // Navegação da sidebar. Itens com data-stub abrem a tela "entra depois".
    document.querySelectorAll('#rh .nav-item').forEach(b => {
      b.onclick = () => {
        this.stub = b.dataset.stub || null;
        this.aba = b.dataset.stub ? 'stub' : b.dataset.aba;
        this.pintar();
      };
    });
    const tog = $('rhToggle');
    if (tog) tog.querySelectorAll('button').forEach(b => {
      b.onclick = async () => {
        const d = Number(b.dataset.dias);
        if (d === this.dias) return;
        this.dias = d;
        tog.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
        await this.recarregar();   // o período é parâmetro da API: recarrega
      };
    });
    const atu = $('btnAtualizarRh');
    if (atu) atu.onclick = () => this.recarregar();
    $('btnSairRh').onclick = () => { this.destruirGraficos(); this.token = null; this.dados = null; this.aoSair(); };
    this.pintar();
  },

  iniciais(nome) {
    return String(nome || '').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() || 'RH';
  },

  /** Chart.js vaza canvas se repintado sem destruir a instância anterior. */
  destruirGraficos() {
    for (const c of this._charts) { try { c.destroy(); } catch (e) { /* já morto */ } }
    this._charts = [];
  },

  pintar() {
    this.destruirGraficos();   // troca de aba mata os gráficos da anterior
    $('rhPeriodo').textContent = 'últimos ' + (this.dados.periodo_dias || this.dias) + ' dias';

    // marca o item ativo na sidebar
    const abaAtiva = this.aba === 'stub' ? null : this.aba;
    document.querySelectorAll('#rh .nav-item').forEach(b => {
      const on = b.dataset.stub ? (this.aba === 'stub' && b.dataset.stub === this.stub)
                                 : (b.dataset.aba === abaAtiva);
      b.classList.toggle('on', on);
    });

    // badge da sidebar = exceções do dia + alertas de planejamento
    const nExc = this.exceptions().length + this.alertas().length;
    const badge = $('navBadgePend');
    if (badge) { badge.textContent = nExc; badge.classList.toggle('hide', nExc === 0); }

    // trilha do topo
    $('rhCrumb').textContent = this.aba === 'stub' ? this.stub : (TITULOS[this.aba] || '');

    ABAS.forEach(a => { const el = $('rh-' + a); if (el) el.classList.toggle('hide', a !== this.aba); });
    if (this.aba === 'painel') this.pintarPainel();
    if (this.aba === 'alocacao') this.pintarAlocacao();
    if (this.aba === 'mapa') this.pintarMapaOp();
    if (this.aba === 'pendencias') this.pintarPendencias();
    if (this.aba === 'pessoas') this.pintarPessoas();
    if (this.aba === 'equipes') this.pintarEquipes();
    if (this.aba === 'registros') this.pintarRegistros();
    if (this.aba === 'jornadas') this.pintarJornadas();
    if (this.aba === 'relatorios') this.pintarRelatorios();
    if (this.aba === 'auditoria') this.pintarAuditoria();
    if (this.aba === 'config') this.pintarConfig();
    if (this.aba === 'planos') this.pintarPlanos();
    if (this.aba === 'stub') this.pintarStub();
  },

  /** A fila de exceções de hoje, calculada da regra pura. Cache por pintura. */
  exceptions() {
    const d = this.dados || {};
    const cfg = window.EFRAT_CFG || {};
    return exceptionsDoDia(
      d.marcacoes, d.pessoas, d.alocacoes_hoje, this.hojeServidor(),
      d.servidor_hora, cfg.horaEntrada || '08:00',
      horasEntradaPorEquipe(d.equipes, d.jornadas));   // hora-limite por jornada da equipe
  },

  /** Alertas de planejamento (gestão da escala), pura. */
  alertas() {
    const d = this.dados || {};
    return alertasDePlanejamento(d.planos, d.alocacoes, d.pessoas, d.equipes, this.hojeServidor(), 14, 3);
  },

  jornadaDe(equipeId) {
    // Jornada real da equipe (jornada associada) — senão o default da empresa.
    const cfg = window.EFRAT_CFG || {};
    return jornadaDaEquipe(equipeId, this.dados.equipes, this.dados.jornadas, cfg.jornadaPadrao);
  },

  nomeDe(id) {
    const p = (this.dados.pessoas || []).find(x => x.pessoa_id === id);
    return p ? p.nome : id;
  },
  nomeEquipe(id) {
    const e = (this.dados.equipes || []).find(x => x.equipe_id === id);
    return e ? e.nome : '—';
  },

  /* ----------------------------------------------------- alocação (cards) */

  alocDia: null,   // dia selecionado nas tabs (YYYY-MM-DD); default hoje

  diasRelativos(base, n) {   // soma n dias a 'YYYY-MM-DD'
    const d = new Date(base + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  },

  /** Alocações do dia agrupadas por equipe (uma cerca representa o grupo). */
  alocacoesDoDia(dia) {
    const linhas = (this.dados.alocacoes || []).filter(a => String(a.dia).slice(0, 10) === dia);
    const porEquipe = {};
    for (const a of linhas) {
      const g = porEquipe[a.equipe_id] || (porEquipe[a.equipe_id] = {
        equipe_id: a.equipe_id, cerca_lat: a.cerca_lat, cerca_lng: a.cerca_lng,
        cerca_raio_m: a.cerca_raio_m, colaboradores: [], temPlano: false, temManual: false
      });
      g.colaboradores.push(a.colaborador_id);
      if (a.origem === 'manual') g.temManual = true; else g.temPlano = true;
    }
    return Object.values(porEquipe);
  },

  pintarAlocacao() {
    const hoje = this.hojeServidor();
    if (!this.alocDia) this.alocDia = hoje;
    const dia = this.alocDia;
    const grupos = this.alocacoesDoDia(dia);
    const totalPessoas = grupos.reduce((s, g) => s + g.colaboradores.length, 0);
    const supervisorDe = eqId => {
      const eq = (this.dados.equipes || []).find(e => e.equipe_id === eqId);
      const sup = eq && eq.supervisor_id ? this.pessoaDe(eq.supervisor_id) : null;
      return sup ? sup.nome : '—';
    };
    const enderecoDe = g => {
      // Se a cerca coincide com um local salvo, mostra o nome.
      const l = (this.dados.locais || []).find(x =>
        Math.abs(x.lat - g.cerca_lat) < 1e-4 && Math.abs(x.lng - g.cerca_lng) < 1e-4);
      return l ? l.nome : (Number(g.cerca_lat).toFixed(4) + ', ' + Number(g.cerca_lng).toFixed(4));
    };

    const tab = (chave, rot) => {
      const alvo = chave === 'hoje' ? hoje : chave === 'amanha' ? this.diasRelativos(hoje, 1) : dia;
      const on = chave === 'semana' ? false : dia === alvo;
      return '<button class="' + (on ? 'on' : '') + '" data-diatab="' + chave + '">' + rot + '</button>';
    };

    const card = g => {
      const nome = this.nomeEquipe(g.equipe_id);
      const total = (this.dados.pessoas || []).filter(p => p.ativo && p.equipe_id === g.equipe_id).length;
      // De onde veio a alocação deste dia: só do plano, só manual, ou misto.
      const origemPill = g.temManual && g.temPlano
        ? '<span class="pill warn" style="padding:0 7px">plano + ajuste</span>'
        : g.temManual ? '<span class="pill mut" style="padding:0 7px">ajuste manual</span>'
        : '<span class="pill ok" style="padding:0 7px">do plano</span>';
      return '<div class="v2card aloc-card">' +
        '<div class="aloc-card-head"><span class="team-nome">' + esc(nome) + '</span>' +
          origemPill +
          '<span class="team-cnt">' + g.colaboradores.length + ' colaboradores</span></div>' +
        '<div class="aloc-card-map">' + this.svgMiniMapa('bom') +
          '<span class="cerca-tag">Cerca ' + g.cerca_raio_m + ' m</span></div>' +
        '<div class="aloc-card-grid">' +
          '<div><div class="k">Local</div><div class="v">' + esc(enderecoDe(g)) + '</div></div>' +
          '<div><div class="k">Jornada</div><div class="v">' + esc(this.jornadaDe(g.equipe_id)) + '</div></div>' +
          '<div><div class="k">Supervisor</div><div class="v">' + esc(supervisorDe(g.equipe_id)) + '</div></div>' +
          '<div><div class="k">Cobertura</div><div class="v">' + g.colaboradores.length + ' de ' + total + ' alocados</div></div>' +
        '</div>' +
        '<div class="aloc-card-acoes">' +
          '<button class="v2btn ghost mini" data-editar="' + esc(g.equipe_id) + '">Editar</button>' +
          '<button class="v2btn ghost mini" data-duplicar="' + esc(g.equipe_id) + '">Duplicar p/ amanhã</button>' +
          '<button class="v2btn danger mini" data-remover="' + esc(g.equipe_id) + '" style="margin-left:auto">Remover</button>' +
        '</div></div>';
    };

    $('rh-alocacao').innerHTML =
      '<div class="pg-head"><div><h1 class="tit">Planejamento de equipes</h1>' +
        '<p class="sub">Defina onde cada equipe trabalha, em que jornada e com qual cerca. É a referência que a operação compara durante o dia.</p></div>' +
        '<div class="acoes"><button class="v2btn" id="btnNovaAloc">+ Nova alocação</button></div></div>' +
      '<div class="aloc-barra">' +
        '<div class="segtabs" style="width:auto">' + tab('hoje', 'Hoje') + tab('amanha', 'Amanhã') + '</div>' +
        '<div class="aloc-dianav"><button id="diaPrev">‹</button><span class="mono">' + this.dataLonga(dia) + '</span><button id="diaNext">›</button></div>' +
        '<span class="aloc-resumo">' + grupos.length + ' equipe(s) · ' + totalPessoas + ' colaborador(es)</span>' +
      '</div>' +
      '<div class="aloc-grid">' +
        grupos.map(card).join('') +
        '<button class="aloc-novo" id="btnNovaAloc2"><span style="font-size:22px">+</span>' +
          '<span style="font-weight:500">Alocar uma equipe neste dia</span>' +
          '<span style="font-size:12.5px;color:#94a3b8">Escolha local, jornada e cerca</span></button>' +
      '</div>' +
      '<div id="alocModal" class="modal-back hide"><div class="modal"><div class="modal-head">' +
        '<h2 id="alocModalTit">Nova alocação</h2>' +
        '<button class="modal-x" id="alocModalX">✕</button></div>' +
        '<div id="alocEditor" class="modal-body"></div></div></div>';

    $('diaPrev').onclick = () => { this.alocDia = this.diasRelativos(dia, -1); this.pintarAlocacao(); };
    $('diaNext').onclick = () => { this.alocDia = this.diasRelativos(dia, 1); this.pintarAlocacao(); };
    $('rh-alocacao').querySelectorAll('[data-diatab]').forEach(b => {
      b.onclick = () => {
        this.alocDia = b.dataset.diatab === 'amanha' ? this.diasRelativos(hoje, 1) : hoje;
        this.pintarAlocacao();
      };
    });
    const abrirEditor = (opts) => this.abrirEditorAlocacao(opts);
    $('btnNovaAloc').onclick = () => abrirEditor({ dia });
    $('btnNovaAloc2').onclick = () => abrirEditor({ dia });
    $('rh-alocacao').querySelectorAll('[data-editar]').forEach(b => {
      b.onclick = () => {
        const g = grupos.find(x => x.equipe_id === b.dataset.editar);
        abrirEditor({ dia, equipeId: g.equipe_id, centro: { lat: g.cerca_lat, lng: g.cerca_lng },
          raio: g.cerca_raio_m, pessoas: g.colaboradores });
      };
    });
    $('rh-alocacao').querySelectorAll('[data-duplicar]').forEach(b => {
      b.onclick = async () => {
        const g = grupos.find(x => x.equipe_id === b.dataset.duplicar);
        const amanha = this.diasRelativos(dia, 1);
        const r = await ApiRh.alocar(this.token, {
          dia: amanha, equipe_id: g.equipe_id,
          cerca: { lat: g.cerca_lat, lng: g.cerca_lng, raio_m: g.cerca_raio_m },
          colaboradores: g.colaboradores
        });
        if (!r.ok) { toast(r.erro || 'Falha ao duplicar', 'bad'); return; }
        toast('Alocação de ' + this.nomeEquipe(g.equipe_id) + ' duplicada para ' + this.dataLonga(amanha), 'ok');
        await this.recarregar();
      };
    });
    $('rh-alocacao').querySelectorAll('[data-remover]').forEach(b => {
      b.onclick = async () => {
        if (!confirm('Remover a alocação de ' + this.nomeEquipe(b.dataset.remover) + ' em ' + this.dataLonga(dia) + '?')) return;
        const r = await ApiRh.alocar(this.token, { acao: 'remover', dia, equipe_id: b.dataset.remover });
        if (!r.ok) { toast(r.erro || 'Falha ao remover', 'bad'); return; }
        toast('Alocação removida', 'ok');
        await this.recarregar();
      };
    });
    $('alocModalX').onclick = () => $('alocModal').classList.add('hide');
    $('alocModal').onclick = (e) => { if (e.target.id === 'alocModal') $('alocModal').classList.add('hide'); };
  },

  abrirEditorAlocacao(opts) {
    $('alocModalTit').textContent = opts.equipeId ? ('Editar — ' + this.nomeEquipe(opts.equipeId)) : 'Nova alocação';
    $('alocModal').classList.remove('hide');
    Alocacao.abrir(this, Object.assign({
      alvo: 'alocEditor',
      aoSalvar: () => { $('alocModal').classList.add('hide'); this.recarregar(); }
    }, opts));
  },

  dataLonga(iso) {
    return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
  },

  /* ------------------------------------------------- planos recorrentes */

  pintarPlanos() {
    const planos = this.dados.planos || [];
    const hoje = this.hojeServidor();
    const limiteVenc = new Date(Date.parse(hoje + 'T00:00:00Z') + 3 * 86400000).toISOString().slice(0, 10);
    const ROT = { 1: 'Seg', 2: 'Ter', 3: 'Qua', 4: 'Qui', 5: 'Sex', 6: 'Sáb', 7: 'Dom' };

    const enderecoDe = pl => {
      const l = (this.dados.locais || []).find(x =>
        Math.abs(x.lat - pl.cerca_lat) < 1e-4 && Math.abs(x.lng - pl.cerca_lng) < 1e-4);
      return l ? l.nome : (Number(pl.cerca_lat).toFixed(4) + ', ' + Number(pl.cerca_lng).toFixed(4));
    };

    const card = pl => {
      const nColab = (pl.colaboradores || []).filter(id => this.pessoaDe(id)).length;
      const dias = (pl.dias_semana || []).slice().sort((a, b) => a - b).map(n => ROT[n]).join(' ');
      const vencendo = pl.vigencia_fim && pl.vigencia_fim >= hoje && pl.vigencia_fim <= limiteVenc;
      const vig = 'De ' + this.dataLonga(pl.vigencia_inicio) + (pl.vigencia_fim ? ' até ' + this.dataLonga(pl.vigencia_fim) : ' (sem prazo)');
      return '<div class="v2card aloc-card">' +
        '<div class="aloc-card-head"><span class="team-nome">' + esc(this.nomeEquipe(pl.equipe_id)) + '</span>' +
          (vencendo ? '<span class="pill warn"><span class="dot"></span>vencendo</span>' : '<span class="pill ok"><span class="dot"></span>ativo</span>') +
          '<span class="team-cnt">' + nColab + ' colaboradores</span></div>' +
        '<div class="aloc-card-map">' + this.svgMiniMapa('bom') +
          '<span class="cerca-tag">Cerca ' + pl.cerca_raio_m + ' m</span></div>' +
        '<div class="aloc-card-grid">' +
          '<div><div class="k">Local</div><div class="v">' + esc(enderecoDe(pl)) + '</div></div>' +
          '<div><div class="k">Dias</div><div class="v">' + esc(dias || '—') + '</div></div>' +
          '<div style="grid-column:1/-1"><div class="k">Vigência</div><div class="v">' + esc(vig) + '</div></div>' +
        '</div>' +
        '<div class="aloc-card-acoes">' +
          '<button class="v2btn ghost mini" data-pled="' + esc(pl.plano_id) + '">Editar</button>' +
          '<button class="v2btn danger mini" data-plrm="' + esc(pl.plano_id) + '" style="margin-left:auto">Remover</button>' +
        '</div></div>';
    };

    $('rh-planos').innerHTML =
      '<div class="pg-head"><div><h1 class="tit">Planos recorrentes</h1>' +
        '<p class="sub">Defina uma vez e o sistema aplica sozinho todo dia útil. Ajustes pontuais na aba Alocações não são sobrescritos.</p></div>' +
        '<div class="acoes"><button class="v2btn" id="btnNovoPlano">+ Novo plano</button></div></div>' +
      '<div class="aloc-grid">' +
        planos.map(card).join('') +
        '<button class="aloc-novo" id="btnNovoPlano2"><span style="font-size:22px">+</span>' +
          '<span style="font-weight:500">Criar um plano recorrente</span>' +
          '<span style="font-size:12.5px;color:#94a3b8">Equipe, local, dias e vigência</span></button>' +
      '</div>' +
      '<div id="planoModal" class="modal-back hide"><div class="modal"><div class="modal-head">' +
        '<h2 id="planoModalTit">Novo plano</h2><button class="modal-x" id="planoModalX">✕</button></div>' +
        '<div id="planoEditor" class="modal-body"></div></div></div>';

    $('btnNovoPlano').onclick = () => this.abrirEditorPlano(null);
    $('btnNovoPlano2').onclick = () => this.abrirEditorPlano(null);
    $('rh-planos').querySelectorAll('[data-pled]').forEach(b => {
      b.onclick = () => this.abrirEditorPlano(planos.find(p => p.plano_id === b.dataset.pled));
    });
    $('rh-planos').querySelectorAll('[data-plrm]').forEach(b => {
      b.onclick = async () => {
        if (!confirm('Remover este plano? As alocações futuras geradas por ele saem; ajustes manuais permanecem.')) return;
        const r = await ApiRh.plano(this.token, { acao: 'remover', plano_id: b.dataset.plrm });
        if (!r.ok) { toast(r.erro || 'Falha', 'bad'); return; }
        toast('Plano removido', 'ok');
        await this.recarregar();
      };
    });
    $('planoModalX').onclick = () => $('planoModal').classList.add('hide');
    $('planoModal').onclick = (e) => { if (e.target.id === 'planoModal') $('planoModal').classList.add('hide'); };
  },

  abrirEditorPlano(pl) {
    $('planoModalTit').textContent = pl ? ('Editar plano — ' + this.nomeEquipe(pl.equipe_id)) : 'Novo plano recorrente';
    $('planoModal').classList.remove('hide');
    PlanoEditor.abrir(this, Object.assign({
      alvo: 'planoEditor',
      aoSalvar: (cancelado) => { $('planoModal').classList.add('hide'); if (!cancelado) this.recarregar(); }
    }, pl || {}));
  },

  /* --------------------------------------------------------- painel */

  // "Hoje" segundo o relógio do servidor, não o do PC do RH — é ele que carimba
  // marcado_dia. Sem isso, um PC com data errada mostraria a equipe toda ausente.
  hojeServidor() {
    const iso = this.dados.servidor_hora || new Date().toISOString();
    return String(iso).slice(0, 10);
  },

  pintarStub() {
    $('rh-stub').innerHTML =
      '<div class="stub"><div class="cx">' +
        '<div class="ic">🧭</div>' +
        '<h2>' + esc(this.stub || 'Em breve') + '</h2>' +
        '<p>Esta tela entra numa próxima rodada. Nesta versão o foco é Central operacional, ' +
        'Alocações, Colaboradores e Pendências.</p>' +
        '<button class="v2btn" id="stubVoltar" style="margin-top:16px">Voltar à central</button>' +
      '</div></div>';
    $('stubVoltar').onclick = () => { this.aba = 'painel'; this.stub = null; this.pintar(); };
  },

  pintarPainel() {
    const d = this.dados;
    const hoje = this.hojeServidor();
    const cfg = window.EFRAT_CFG || {};

    const ind = indicadores(d.marcacoes, d.pessoas, d.equipes);
    const cards = presencaPorEquipe(d.pessoas, d.marcacoes, d.equipes, hoje);
    const serie = serieDiaria(d.marcacoes, d.periodo_dias || this.dias, hoje);
    const motivos = pendenciasPorMotivo(d.marcacoes, d.recadastros, d.pessoas);
    const exc = this.exceptions();
    const alerts = this.alertas();
    const cercaPorEquipe = this.cercaPorEquipe();

    const esp = cards.reduce((s, c) => s + c.esperados, 0);
    const pre = cards.reduce((s, c) => s + c.presentes, 0);
    const presencaHoje = esp ? Math.round((pre / esp) * 100) : null;

    const kpi = (lab, val, hint, bad) =>
      '<div class="kpi"><div class="lab">' + esc(lab) + '</div>' +
      '<div class="val' + (bad ? ' bad' : '') + '">' + val + '</div>' +
      '<div class="hint">' + esc(hint) + '</div></div>';

    const barTone = { bom: '#16a34a', atencao: '#d97706', serio: '#e07a3f', critico: '#dc2626' };
    const teamCard = c => {
      const cerca = cercaPorEquipe[c.equipe_id];
      const pct = c.presenca == null ? 0 : Math.round(c.presenca * 100);
      const chips = [];
      const ausentes = c.ausentes.length;
      if (ausentes) chips.push({ label: ausentes + (ausentes > 1 ? ' ausentes' : ' ausente'), tone: '#dc2626' });
      else chips.push({ label: 'sem ocorrências', tone: '#16a34a' });
      return '<div class="team">' +
        '<div class="team-map">' + this.svgMiniMapa(c.status) +
          (cerca ? '<span class="cerca-tag">cerca ' + cerca.cerca_raio_m + ' m</span>' : '') +
        '</div>' +
        '<div class="team-body">' +
          '<div class="team-top"><span class="team-nome">' + esc(c.nome) + '</span>' +
            '<span class="pill ' + (pct >= 90 ? 'ok' : 'warn') + '"><span class="dot"></span>' +
              (pct >= 90 ? 'Ativa' : 'Atenção') + '</span>' +
            '<span class="team-cnt">' + c.esperados + ' colaboradores</span></div>' +
          '<div class="team-meta">🕑 ' + esc(this.jornadaDe(c.equipe_id)) + '</div>' +
          '<div class="team-pres">' +
            '<div style="display:flex;align-items:baseline;gap:8px">' +
              '<span class="num">' + c.presentes + ' / ' + c.esperados + '</span>' +
              '<span style="font-size:12.5px;color:#64748b">presentes</span>' +
              '<span style="margin-left:auto;font-size:12.5px;font-weight:500;color:' +
                (pct >= 90 ? '#12805c' : '#b45309') + '">' + pct + '%</span></div>' +
            '<div class="bar"><i style="width:' + pct + '%;background:' + (barTone[c.status] || '#16a34a') + '"></i></div>' +
            '<div class="chips">' + chips.map(ch =>
              '<span class="chip"><span class="dot" style="background:' + ch.tone + '"></span>' + esc(ch.label) + '</span>').join('') +
            '</div>' +
          '</div>' +
        '</div></div>';
    };

    const sevPill = s => s === 'critico'
      ? '<span class="sev bad">CRÍTICO</span>' : '<span class="sev warn">ATENÇÃO</span>';
    const atenHtml = exc.slice(0, 4).map(x => {
      const p = this.pessoaDe(x.pessoa_id);
      return '<div class="aten"><div class="aten-top">' + sevPill(x.severidade) +
        '<span class="aten-tit">' + esc(x.rotulo) + '</span>' +
        '<span class="aten-hora">' + esc(x.hora) + '</span></div>' +
        '<div class="aten-sub">' + esc(p ? p.nome : x.pessoa_id) + ' · ' + esc(this.nomeEquipe(x.equipe_id)) + '</div>' +
        '<button class="v2btn ghost mini" data-exc="' + esc(x.id) + '" style="margin-top:9px">Analisar</button></div>';
    }).join('') || '<div class="aten"><div class="aten-sub">Nada requer atenção agora. 🎉</div></div>';

    // Bloco "Planejamento": alertas de gestão da escala (conflitos, lacunas, vencendo).
    const planHtml = alerts.slice(0, 5).map(x => {
      const p = x.pessoa_id ? this.pessoaDe(x.pessoa_id) : null;
      const contexto = p ? p.nome : (x.equipe_id ? this.nomeEquipe(x.equipe_id) : '—');
      return '<div class="aten"><div class="aten-top">' + sevPill(x.severidade) +
        '<span class="aten-tit">' + esc(x.rotulo) + '</span></div>' +
        '<div class="aten-sub">' + esc(contexto) + '</div>' +
        '<button class="v2btn ghost mini" data-plan="' + esc(x.tipo) + '" style="margin-top:9px">Resolver</button></div>';
    }).join('') || '<div class="aten"><div class="aten-sub">Planejamento em dia. ✓</div></div>';

    const ativ = (d.marcacoes || []).slice(0, 6).map(m => {
      const p = this.pessoaDe(m.pessoa_id);
      const tone = m.origem === 'manual' ? '#d97706' : '#16a34a';
      return '<div class="ativ"><span class="t">' + hora(m.marcado_em) + '</span>' +
        '<span class="dot" style="background:' + tone + '"></span>' +
        '<span class="lbl">' + esc(p ? p.nome : m.pessoa_id) + ' registrou ' +
          (m.tipo === 'entrada' ? 'entrada' : 'saída') +
          (m.origem === 'manual' ? ' <span style="color:#94a3b8">(manual)</span>' : '') + '</span></div>';
    }).join('') || '<div class="ativ"><span class="lbl" style="color:#94a3b8">Sem marcações no período.</span></div>';

    $('rh-painel').className = 'viz';
    $('rh-painel').innerHTML =
      '<div class="pg-head"><div>' +
        '<h1 class="tit">Operação de hoje</h1>' +
        '<p class="sub">Presença, equipes e ocorrências do dia.</p>' +
      '</div></div>' +

      '<div class="kpis">' +
        kpi('Previstos hoje', esp, (cards.length) + ' equipe(s) em operação') +
        kpi('Presentes', pre, ind.taxaManual + '% por registro manual') +
        kpi('Presença', presencaHoje == null ? '—' : presencaHoje + '%', 'Meta operacional 95%') +
        kpi('Requerem atenção', exc.length, 'Exceções aguardando o RH', exc.length > 0) +
      '</div>' +

      '<div class="painel-grid">' +
        '<section>' +
          '<div class="sec-tit"><h2>Equipes em operação</h2>' +
            '<button class="link" id="verPlanejamento">Ver planejamento</button></div>' +
          (cards.length ? cards.map(teamCard).join('')
            : '<div class="v2card" style="padding:20px;color:#64748b">Nenhuma equipe com pessoas ativas hoje.</div>') +
        '</section>' +
        '<div>' +
          '<section class="side-sec">' +
            '<div class="side-sec-head">' +
              '<span class="sev bad">' + exc.length + '</span>' +
              '<h2>Requerem atenção</h2>' +
              '<button class="link" id="abrirFila" style="margin-left:auto">Abrir fila</button></div>' +
            atenHtml +
          '</section>' +
          '<section class="side-sec">' +
            '<div class="side-sec-head">' +
              '<span class="sev ' + (alerts.length ? 'warn' : '') + '">' + alerts.length + '</span>' +
              '<h2>Planejamento</h2>' +
              '<button class="link" id="abrirPlanos" style="margin-left:auto">Ver planos</button></div>' +
            planHtml +
          '</section>' +
          '<section class="side-sec">' +
            '<div class="side-sec-head"><h2>Atividade recente</h2></div>' +
            ativ +
          '</section>' +
        '</div>' +
      '</div>' +

      '<div class="vizrow">' +
        '<div class="v2card" style="padding:15px">' +
          '<h2 style="margin:0 0 4px;font-size:14px;font-weight:600">Marcações por dia</h2>' +
          '<p style="font-size:12px;color:#64748b;margin:0 0 10px">últimos ' + (d.periodo_dias || this.dias) + ' dias · biometria e manual</p>' +
          '<div class="cv" id="boxLinha" style="position:relative;height:220px"></div>' +
        '</div>' +
        '<div class="v2card" style="padding:15px">' +
          '<h2 style="margin:0 0 4px;font-size:14px;font-weight:600">Taxa de registro manual por equipe</h2>' +
          '<p style="font-size:12px;color:#64748b;margin:0 0 10px">onde a biometria parou · alarme em ' + (cfg.alarmeManual || 20) + '%</p>' +
          '<div class="cv" id="boxManual" style="position:relative;height:220px"></div>' +
        '</div>' +
      '</div>';

    $('verPlanejamento').onclick = () => { this.aba = 'alocacao'; this.pintar(); };
    $('abrirFila').onclick = () => { this.aba = 'pendencias'; this.pintar(); };
    $('abrirPlanos').onclick = () => { this.aba = 'planos'; this.pintar(); };
    $('rh-painel').querySelectorAll('button[data-plan]').forEach(b => {
      b.onclick = () => { this.aba = 'planos'; this.pintar(); };
    });
    $('rh-painel').querySelectorAll('button[data-exc]').forEach(b => {
      b.onclick = () => { this.aba = 'pendencias'; this.pendSel = b.dataset.exc; this.pintar(); };
    });

    this.carregarGraficos({ serie, equipes: ind.equipes, motivos, alarme: cfg.alarmeManual || 20 });
  },

  /** Cerca ativa por equipe hoje (uma alocação representa o grupo). */
  cercaPorEquipe() {
    const m = {};
    for (const a of (this.dados.alocacoes_hoje || [])) if (!m[a.equipe_id]) m[a.equipe_id] = a;
    return m;
  },

  pessoaDe(id) { return (this.dados.pessoas || []).find(x => x.pessoa_id === id) || null; },

  /** Mini-mapa decorativo (placeholder) tingido pelo status da equipe. */
  svgMiniMapa(status) {
    const cor = status === 'critico' || status === 'serio' ? '#dc2626' : '#1d4ed8';
    return '<svg viewBox="0 0 132 118" width="132" height="118" style="display:block">' +
      '<rect width="132" height="118" fill="#eef2f6"></rect>' +
      '<path d="M-5 32 H137 M-5 78 H137 M28 -5 V123 M92 -5 V123" stroke="#dfe5ec" stroke-width="7"></path>' +
      '<circle cx="66" cy="58" r="28" fill="' + cor + '" fill-opacity="0.10" stroke="' + cor + '" stroke-opacity="0.45" stroke-width="1.5"></circle>' +
      '<circle cx="66" cy="58" r="4.5" fill="' + cor + '" stroke="#fff" stroke-width="2"></circle></svg>';
  },

  /* ------------------------------------------------ tabelas alternativas */

  tabelaSerie(el, serie) {
    if (!el) return;
    const linhas = serie.dias.map((dd, i) =>
      '<tr><td class="num">' + data(dd) + '</td><td class="num">' + serie.biometria[i] + '</td><td class="num">' +
      serie.manual[i] + '</td><td class="num">' + serie.total[i] + '</td></tr>').join('');
    el.innerHTML = '<table class="tabdados"><thead><tr><th>Dia</th><th>Biometria</th>' +
      '<th>Manual</th><th>Total</th></tr></thead><tbody>' + linhas + '</tbody></table>';
  },

  tabelaManual(el, equipes) {
    if (!el) return;
    const linhas = equipes.map(e =>
      '<tr><td>' + esc(e.nome) + '</td><td class="num">' + e.taxa_manual + '%</td><td class="num">' +
      e.marcacoes + '</td></tr>').join('');
    el.innerHTML = '<table class="tabdados"><thead><tr><th>Equipe</th>' +
      '<th>Taxa manual</th><th>Marcações</th></tr></thead><tbody>' + linhas + '</tbody></table>';
  },

  tabelaMotivos(el, motivos) {
    if (!el) return;
    const linhas = motivos.map(m =>
      '<tr><td>' + esc(m.rotulo) + '</td><td class="num">' + m.total + '</td></tr>').join('');
    el.innerHTML = '<table class="tabdados"><thead><tr><th>Motivo</th>' +
      '<th>Pendências</th></tr></thead><tbody>' + linhas + '</tbody></table>';
  },

  /* --------------------------------------------------- carga da biblioteca */

  // Chart.js só entra quando o painel abre — o celular do gestor, que nunca vê
  // esta tela, jamais baixa a biblioteca. Injeta uma vez e reusa.
  async carregarChart() {
    if (this._Chart) return this._Chart;
    if (window.Chart) { this._Chart = window.Chart; return this._Chart; }
    const src = (window.EFRAT_CFG && window.EFRAT_CFG.chartCdn);
    if (!src) return null;
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    }).catch(() => null);
    this._Chart = window.Chart || null;
    return this._Chart;
  },

  css(nome) {
    return getComputedStyle($('rh-painel')).getPropertyValue(nome).trim();
  },

  async carregarGraficos({ serie, equipes, motivos, alarme }) {
    const Chart = await this.carregarChart();
    // se a aba já mudou enquanto a biblioteca carregava, não pinte nada
    if (!Chart || this.aba !== 'painel') return;

    const s1 = this.css('--serie-1') || '#2d6cdf';
    const s2 = this.css('--serie-2') || '#e0a800';
    const grid = this.css('--v-grid') || '#e5e9f0';
    const txt = this.css('--v-text2') || '#8390a6';
    const temMarcacao = serie.total.some(v => v > 0);

    const base = {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { grid: { color: grid }, ticks: { color: txt } },
        y: { beginAtZero: true, grid: { color: grid }, ticks: { color: txt } }
      }
    };

    const vazio = (id, msg) => {
      const box = $(id);
      if (box) box.innerHTML = '<div class="vazio-viz">' + msg + '</div>';
    };
    const canvas = id => {
      const box = $(id);
      if (!box) return null;
      box.innerHTML = '<canvas></canvas>';
      return box.querySelector('canvas');
    };

    /* 6.2 linha — duas séries (biometria/manual), sem duplo eixo Y */
    if (temMarcacao) {
      const cv = canvas('boxLinha');
      if (cv) this._charts.push(new Chart(cv, {
        type: 'line',
        data: {
          labels: serie.dias.map(data),
          datasets: [
            { label: 'Biometria', data: serie.biometria, borderColor: s1, backgroundColor: s1, borderWidth: 2, pointRadius: 0, tension: .2 },
            { label: 'Manual', data: serie.manual, borderColor: s2, backgroundColor: s2, borderWidth: 2, pointRadius: 0, tension: .2 }
          ]
        },
        options: Object.assign({}, base, { plugins: { legend: { labels: { color: txt } } } })
      }));
    } else vazio('boxLinha', 'Sem marcações neste período');

    /* 6.3 barras horizontais — taxa manual por equipe, uma cor só.
       Linha de alarme tracejada desenhada à mão: evita puxar o plugin
       chartjs-annotation de um segundo CDN só por uma linha vertical. */
    const comManual = (equipes || []).filter(e => e.marcacoes > 0);
    if (comManual.length) {
      const cv = canvas('boxManual');
      const linhaAlarme = {
        id: 'linhaAlarme',
        afterDraw(chart) {
          const { ctx, chartArea, scales } = chart;
          const x = scales.x.getPixelForValue(alarme);
          if (x < chartArea.left || x > chartArea.right) return;
          ctx.save();
          ctx.setLineDash([5, 4]);
          ctx.strokeStyle = txt; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(x, chartArea.top); ctx.lineTo(x, chartArea.bottom); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = txt; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText('alarme ' + alarme + '%', x, chartArea.top - 2);
          ctx.restore();
        }
      };
      if (cv) this._charts.push(new Chart(cv, {
        type: 'bar',
        data: {
          labels: comManual.map(e => e.nome),
          datasets: [{ label: 'Taxa manual (%)', data: comManual.map(e => e.taxa_manual), backgroundColor: s1 }]
        },
        options: Object.assign({}, base, {
          indexAxis: 'y',
          plugins: { legend: { display: false } },
          scales: {
            x: { beginAtZero: true, grid: { color: grid }, ticks: { color: txt } },
            y: { grid: { color: grid }, ticks: { color: txt } }
          }
        }),
        plugins: [linhaAlarme]
      }));
    } else vazio('boxManual', 'Sem marcações neste período');

    /* 6.4 barras — pendências por motivo, uma cor; clique filtra a aba */
    const comMotivo = (motivos || []).filter(m => m.total > 0);
    if (comMotivo.length) {
      const cv = canvas('boxMotivo');
      if (cv) {
        const self = this;
        this._charts.push(new Chart(cv, {
          type: 'bar',
          data: {
            labels: comMotivo.map(m => m.rotulo),
            datasets: [{ data: comMotivo.map(m => m.total), backgroundColor: s1 }]
          },
          options: Object.assign({}, base, {
            plugins: { legend: { display: false } },
            onClick: () => { self.aba = 'pendencias'; self.pintar(); }
          })
        }));
      }
    } else vazio('boxMotivo', 'Nada esperando decisão');
  },

  /* ----------------------------------------------------- pendências */

  pintarPendencias() {
    const el = $('rh-pendencias');
    const abertas = this.exceptions();
    // Resolvidas: marcações de hoje que já tiveram decisão do RH (não mais pendentes,
    // mas que um dia foram exceção). Aproximação leve: manuais/revisadas de hoje já
    // decididas. Aqui listamos as marcações de hoje NÃO pendentes que vieram de
    // origem manual ou veredito revisar — o histórico do que passou pela fila.
    const hoje = this.hojeServidor();
    const resolvidas = (this.dados.marcacoes || []).filter(m =>
      m.marcado_dia === hoje && !m.pendente && (m.origem === 'manual' || m.veredito === 'revisar'));

    const fila = this.pendTab === 'abertas' ? abertas : resolvidas.map(m => this.excDeMarcacao(m));
    // seleção default: primeiro da fila
    if (!this.pendSel || !fila.some(x => x.id === this.pendSel)) this.pendSel = fila[0] ? fila[0].id : null;
    const sel = fila.find(x => x.id === this.pendSel) || null;

    const seg = (chave, rot, n) =>
      '<button class="' + (this.pendTab === chave ? 'on' : '') + '" data-tab="' + chave + '">' +
        esc(rot) + (n ? ' (' + n + ')' : '') + '</button>';

    const item = x => {
      const p = this.pessoaDe(x.pessoa_id);
      const sevCls = x.severidade === 'critico' ? 'bad' : 'warn';
      const sevTxt = x.severidade === 'critico' ? 'CRÍTICO' : 'ATENÇÃO';
      const est = this.pendTab === 'abertas' ? 'Aguardando decisão do RH' : 'Tratada';
      return '<button class="pend-item ' + (this.pendSel === x.id ? 'on' : '') + '" data-sel="' + esc(x.id) + '">' +
        '<div class="top"><span class="sev ' + sevCls + '">' + sevTxt + '</span>' +
          '<span class="hora">' + esc(x.hora) + '</span></div>' +
        '<div class="tit">' + esc(x.rotulo) + '</div>' +
        '<div class="who">' + esc(p ? p.nome : x.pessoa_id) + ' · ' + esc(this.nomeEquipe(x.equipe_id)) + '</div>' +
        '<div class="est">' + est + '</div></button>';
    };

    el.innerHTML =
      '<div class="pend2">' +
        '<div class="pend-master">' +
          '<div class="pend-master-head">' +
            '<h1>Pendências</h1>' +
            '<p>Exceções detectadas contra o plano do dia.</p>' +
            '<div class="segtabs">' + seg('abertas', 'Abertas', abertas.length) + seg('resolvidas', 'Resolvidas', resolvidas.length) + '</div>' +
          '</div>' +
          '<div class="pend-list">' +
            (fila.length ? fila.map(item).join('')
              : '<div style="padding:46px 22px;text-align:center;color:#64748b">' +
                '<div style="font-size:22px">✓</div><div style="margin-top:8px;font-weight:500">Nada nesta caixa</div>' +
                '<div style="font-size:12.5px;margin-top:3px">Todas as exceções deste filtro foram tratadas.</div></div>') +
          '</div>' +
        '</div>' +
        '<div class="pend-detail" id="pendDetail">' + this.htmlDetalhePend(sel) + '</div>' +
      '</div>';

    el.querySelectorAll('.segtabs button').forEach(b => {
      b.onclick = () => { this.pendTab = b.dataset.tab; this.pendSel = null; this.pintarPendencias(); };
    });
    el.querySelectorAll('.pend-item').forEach(b => {
      b.onclick = () => { this.pendSel = b.dataset.sel; this.pintarPendencias(); };
    });
    this.ligarAcoesDetalhe();
  },

  /** Empacota uma marcação resolvida no mesmo formato de exceção, p/ o detalhe. */
  excDeMarcacao(m) {
    let tipo = 'zona_cinzenta';
    if (m.dentro_cerca === false) tipo = 'fora_da_cerca';
    else if (m.origem === 'manual') tipo = 'registro_manual';
    return {
      id: 'm:' + m.id_cliente, tipo, severidade: (TIPOS_EXCECAO[tipo] || {}).severidade || 'atencao',
      rotulo: (TIPOS_EXCECAO[tipo] || {}).rotulo || 'Exceção', pessoa_id: m.pessoa_id,
      equipe_id: m.equipe_id, hora: String(m.marcado_em).slice(11, 16), marcacao: m, alocacao: null,
      alvo: { tipo: 'marcacao', id: m.id_cliente }, resolvida: true
    };
  },

  htmlDetalhePend(x) {
    if (!x) return '<div class="pend-vazio"><div><div style="font-size:22px">📥</div>' +
      '<div style="margin-top:10px;font-weight:500">Selecione uma pendência</div>' +
      '<div style="font-size:13px;color:#64748b;margin-top:3px">O detalhe abre aqui com evidência, mapa e decisão.</div></div></div>';

    const p = this.pessoaDe(x.pessoa_id);
    const m = x.marcacao;
    const cerca = this.cercaPorEquipe()[x.equipe_id];
    const sevCls = x.severidade === 'critico' ? 'bad' : 'warn';
    const sevTxt = x.severidade === 'critico' ? 'CRÍTICO' : 'ATENÇÃO';

    // prova biométrica: miniatura do cadastro × foto de auditoria (quando houver)
    const fotoCad = p && p.miniatura ? '<img src="' + p.miniatura + '">' : '👤';
    const fotoReg = m && m.foto_auditoria ? '<img src="' + m.foto_auditoria + '">' : '👤';
    const match = m && m.score != null
      ? 'Distância facial ' + Number(m.score).toFixed(3) + ' (menor = melhor)'
      : 'Sem captura de auditoria para comparar';

    const fatos = [
      ['Onde deveria estar', cerca ? (this.nomeEquipe(x.equipe_id) + ' · cerca ' + cerca.cerca_raio_m + ' m') : 'Sem alocação'],
      ['Jornada prevista', this.jornadaDe(x.equipe_id)],
      ['Origem', m ? (m.origem === 'manual' ? 'Registro manual' : 'Biometria facial · app') : 'Ausência detectada'],
      ['Desvio', m && m.distancia_cerca_m != null ? (m.distancia_cerca_m + ' m do centro') : '—']
    ];

    // ações dependem do tipo
    let acoes = '';
    if (x.resolvida) {
      acoes = '<span class="pill ok" style="height:32px;padding:0 12px"><span class="dot"></span>Tratada</span>';
    } else if (x.tipo === 'sem_entrada') {
      acoes = '<button class="v2btn" data-lancar="' + esc(x.pessoa_id) + '">Lançar entrada manual</button>';
    } else {
      acoes = '<button class="v2btn danger" data-decidir="rejeitar" data-alvo-id="' + esc(x.alvo.id) + '">Rejeitar</button>' +
              '<button class="v2btn" data-decidir="aprovar" data-alvo-id="' + esc(x.alvo.id) + '">Aprovar registro</button>';
    }

    return '<div class="cab">' +
        '<span class="av">' + esc(this.iniciais(p ? p.nome : '?')) + '</span>' +
        '<div style="flex:1;min-width:240px">' +
          '<div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">' +
            '<h1>' + esc(p ? p.nome : x.pessoa_id) + '</h1><span class="sev ' + sevCls + '">' + sevTxt + '</span></div>' +
          '<div style="font-size:13.5px;color:#475569;margin-top:3px">' + esc(x.rotulo) +
            ' · ' + esc(x.hora) + ' · ' + esc(this.nomeEquipe(x.equipe_id)) + '</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap" id="pendAcoes">' + acoes + '</div>' +
      '</div>' +

      '<div class="prova">' +
        '<section><h2>Prova biométrica</h2><div class="fotos">' +
          '<div><div class="foto">' + fotoCad + '</div><div class="cap">Cadastro</div></div>' +
          '<div><div class="foto">' + fotoReg + '</div><div class="cap">Registro' + (m ? ' · ' + x.hora : '') + '</div></div>' +
        '</div><div class="match">✓ ' + esc(match) + '</div></section>' +
        '<section><h2>Local esperado × registrado</h2>' +
          '<div class="foto" style="aspect-ratio:auto;height:186px">' + this.svgMapaProva(m, cerca) + '</div>' +
          '<div class="cap">' + (cerca ? ('Cerca ' + cerca.cerca_raio_m + ' m') : 'Sem cerca definida') +
            (m && m.dentro_cerca === false ? ' · <b style="color:#b42318">fora da área</b>' : '') + '</div>' +
        '</section>' +
      '</div>' +

      '<div class="fatos"><h2 style="margin:0 0 11px;font-size:14px;font-weight:600">Contexto do registro</h2>' +
        '<div class="g">' + fatos.map(f =>
          '<div><div class="k">' + esc(f[0]) + '</div><div class="v">' + esc(f[1]) + '</div></div>').join('') + '</div></div>' +

      (x.resolvida ? '' :
        '<div class="decisao"><h2>Decisão</h2>' +
          '<input id="pendJust" placeholder="Justificativa — fica na auditoria e no espelho de ponto">' +
          '<div class="linha"><span style="font-size:12.5px;color:#94a3b8">Registrado como ' + esc(this.dados.usuario.nome || 'RH') + ' · RH</span></div>' +
        '</div>');
  },

  /** Mapa de prova (placeholder SVG): cerca + pino do registro fora, se houver. */
  svgMapaProva(m, cerca) {
    const fora = m && m.dentro_cerca === false;
    return '<svg viewBox="0 0 460 186" preserveAspectRatio="xMidYMid slice" style="width:100%;height:100%">' +
      '<rect width="460" height="186" fill="#eef2f6"></rect>' +
      '<path d="M-10 60 H470 M-10 140 H470 M96 -10 V210 M300 -10 V210" stroke="#dfe5ec" stroke-width="10"></path>' +
      '<circle cx="180" cy="96" r="60" fill="#1d4ed8" fill-opacity="0.10" stroke="#1d4ed8" stroke-opacity="0.5" stroke-width="1.6"></circle>' +
      '<circle cx="180" cy="96" r="6" fill="#1d4ed8" stroke="#fff" stroke-width="2.5"></circle>' +
      (fora ? '<path d="M180 96 L336 70" stroke="#b42318" stroke-width="1.6" stroke-dasharray="5 4"></path>' +
              '<circle cx="336" cy="70" r="7" fill="#b42318" stroke="#fff" stroke-width="2.5"></circle>' : '') +
      '</svg>';
  },

  ligarAcoesDetalhe() {
    const cont = $('pendAcoes');
    if (!cont) return;
    const just = () => (($('pendJust') && $('pendJust').value) || '').trim();

    cont.querySelectorAll('button[data-decidir]').forEach(b => {
      b.onclick = async () => {
        b.disabled = true;
        const r = await ApiRh.decidir(this.token, {
          tipo: 'marcacao', id: b.dataset.alvoId, acao: b.dataset.decidir, motivo: just()
        });
        if (!r.ok) { toast(r.erro || 'Falha', 'bad'); b.disabled = false; return; }
        toast(b.dataset.decidir === 'aprovar' ? 'Registro aprovado' : 'Registro rejeitado', 'ok');
        this.pendSel = null;
        await this.recarregar();
      };
    });

    cont.querySelectorAll('button[data-lancar]').forEach(b => {
      b.onclick = async () => {
        b.disabled = true;
        const r = await ApiRh.lancarPonto(this.token, {
          colaborador_id: b.dataset.lancar, tipo: 'entrada',
          marcado_em: this.dados.servidor_hora || new Date().toISOString(),
          motivo: just() || 'entrada lançada pelo RH'
        });
        if (!r.ok) { toast(r.erro || 'Falha', 'bad'); b.disabled = false; return; }
        toast('Entrada lançada', 'ok');
        this.pendSel = null;
        await this.recarregar();
      };
    });
  },

  /* ---------------------------------------------------- colaboradores */

  /** Último ponto e status de hoje por pessoa, para a tabela. */
  resumoPessoa(pessoaId) {
    const hoje = this.hojeServidor();
    const minhas = (this.dados.marcacoes || []).filter(m => m.pessoa_id === pessoaId)
      .sort((a, b) => String(b.marcado_em).localeCompare(String(a.marcado_em)));
    const ultima = minhas[0] || null;
    const marcouHoje = minhas.some(m => m.marcado_dia === hoje);
    const alocadoHoje = (this.dados.alocacoes_hoje || []).some(a => a.colaborador_id === pessoaId);
    let status = { cls: 'mut', txt: 'Fora de escala' };
    if (marcouHoje) status = { cls: 'ok', txt: 'Trabalhando' };
    else if (alocadoHoje) status = { cls: 'bad', txt: 'Sem entrada' };
    const ultimo = ultima
      ? (ultima.marcado_dia === hoje ? '' : (data(ultima.marcado_dia) + ' ')) +
        (ultima.tipo === 'entrada' ? 'E ' : 'S ') + this.horaSegura(ultima.marcado_em)
      : '— sem registro';
    return { status, ultimo };
  },

  /** Formata HH:MM de um timestamp, tolerando o formato do Postgres (sem 'T'). */
  horaSegura(iso) {
    if (!iso) return '';
    let d = new Date(iso);
    if (isNaN(d)) d = new Date(String(iso).replace(' ', 'T'));   // "2026-09-01 23:00:00" → ISO
    if (isNaN(d)) {
      const m = String(iso).match(/(\d{2}):(\d{2})/);   // último recurso: pega HH:MM do texto
      return m ? m[1] + ':' + m[2] : '';
    }
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  },

  pintarPessoas() {
    const eqs = this.dados.equipes || [];
    const q = this.buscaPessoas.toLowerCase();
    const lista = (this.dados.pessoas || []).slice()
      .filter(p => !q || (p.nome + ' ' + p.matricula).toLowerCase().includes(q))
      .sort((a, b) => a.nome.localeCompare(b.nome));
    const total = (this.dados.pessoas || []).length;

    const linha = p => {
      const r = this.resumoPessoa(p.pessoa_id);
      const semBio = !p.tem_biometria;
      return '<tr>' +
        '<td><div class="cel-nome"><span class="av' + (semBio ? ' bad' : '') + '">' + esc(this.iniciais(p.nome)) + '</span>' +
          '<span><span class="n">' + esc(p.nome) +
            (p.papel === 'gestor' ? ' <span class="pill mut" style="padding:0 6px">gestor</span>' : '') +
            (p.ativo ? '' : ' <span class="pill mut" style="padding:0 6px">inativo</span>') + '</span>' +
          '<span class="m">Matrícula ' + esc(p.matricula) + '</span></span></div></td>' +
        '<td>' + esc(this.nomeEquipe(p.equipe_id)) + '</td>' +
        '<td style="font-variant-numeric:tabular-nums">' + esc(this.jornadaDe(p.equipe_id)) + '</td>' +
        '<td><span class="pill ' + (p.tem_biometria ? 'ok' : 'warn') + '"><span class="dot"></span>' +
          (p.tem_biometria ? 'Ativa' : 'Pendente') + '</span></td>' +
        '<td><span class="pill ' + r.status.cls + '"><span class="dot"></span>' + r.status.txt + '</span></td>' +
        '<td style="font-variant-numeric:tabular-nums">' + esc(r.ultimo) + '</td>' +
        '<td style="white-space:nowrap;text-align:right">' +
          '<button class="v2btn ghost mini" data-editar="' + p.pessoa_id + '">Editar</button> ' +
          '<button class="v2btn ghost mini" data-codigo="' + esc(p.matricula) + '" data-nome="' + esc(p.nome) + '">Código</button> ' +
          '<button class="v2btn ghost mini" data-bio="' + p.pessoa_id + '">' + (p.tem_biometria ? 'Refazer' : 'Biometria') + '</button>' +
        '</td></tr>';
    };

    $('rh-pessoas').innerHTML =
      '<div class="pg-head"><div>' +
        '<h1 class="tit">Colaboradores</h1>' +
        '<p class="sub">' + total + ' pessoas cadastradas.</p></div>' +
        '<div class="acoes"><button class="v2btn" id="btnAbrirNovo">+ Colaborador</button></div>' +
      '</div>' +
      '<div id="areaNovo"></div>' +
      '<div class="tbl-wrap">' +
        '<div class="tbl-bar">' +
          '<div class="tbl-busca">🔍<input id="pBusca" placeholder="Buscar por nome ou matrícula…" value="' + esc(this.buscaPessoas) + '"></div>' +
          '<span style="margin-left:auto;font-size:12.5px;color:#94a3b8">' + lista.length + ' de ' + total + '</span>' +
        '</div>' +
        '<div style="overflow:auto"><table class="densa"><thead><tr>' +
          '<th>Colaborador</th><th>Equipe</th><th>Jornada</th><th>Biometria</th><th>Status</th><th>Último ponto</th><th></th>' +
        '</tr></thead><tbody>' +
          (lista.length ? lista.map(linha).join('')
            : '<tr><td colspan="7" style="padding:40px;text-align:center;color:#64748b">Nenhum colaborador encontrado.</td></tr>') +
        '</tbody></table></div>' +
      '</div>' +
      '<div id="areaBio"></div>';

    const busca = $('pBusca');
    busca.oninput = () => {
      this.buscaPessoas = busca.value;
      // repinta só o corpo mantendo o foco/caret na busca
      const caret = busca.selectionStart;
      this.pintarPessoas();
      const nb = $('pBusca'); if (nb) { nb.focus(); nb.setSelectionRange(caret, caret); }
    };
    $('btnAbrirNovo').onclick = () => this.formColaborador(null);

    $('rh-pessoas').querySelectorAll('button[data-bio]').forEach(b => {
      b.onclick = () => this.abrirBiometria(b.dataset.bio);
    });
    $('rh-pessoas').querySelectorAll('button[data-codigo]').forEach(b => {
      b.onclick = () => this.mostrarCodigoAtivacao(b.dataset.nome, b.dataset.codigo);
    });
    $('rh-pessoas').querySelectorAll('button[data-editar]').forEach(b => {
      b.onclick = () => this.formColaborador(this.pessoaDe(b.dataset.editar));
    });
  },

  /**
   * Formulário de colaborador — cria (pessoa null) ou edita (pessoa existente).
   * O endpoint /rh/colaborador faz upsert por (empresa, matrícula): editar é
   * reenviar a mesma matrícula com os novos dados.
   */
  formColaborador(pessoa) {
    const eqs = this.dados.equipes || [];
    const p = pessoa || {};
    const editando = !!pessoa;
    const opt = (val, txt, sel) => '<option value="' + val + '"' + (sel ? ' selected' : '') + '>' + esc(txt) + '</option>';
    $('areaNovo').innerHTML =
      '<div class="card"><h2>' + (editando ? 'Editar colaborador' : 'Novo colaborador') + '</h2>' +
        '<div class="form-grid">' +
          '<div><label class="lb2">Nome</label><input class="inp" id="pNome" value="' + esc(p.nome || '') + '"></div>' +
          '<div><label class="lb2">Matrícula</label><input class="inp" id="pMat" value="' + esc(p.matricula || '') + '"' +
            (editando ? ' readonly title="A matrícula identifica o colaborador e não muda"' : '') + '></div>' +
          '<div><label class="lb2">Equipe</label><select class="inp" id="pEquipe">' +
            eqs.map(e => opt(e.equipe_id, e.nome, p.equipe_id === e.equipe_id)).join('') + '</select></div>' +
          '<div><label class="lb2">Papel</label><select class="inp" id="pPapel">' +
            opt('colaborador', 'Colaborador', p.papel !== 'gestor') + opt('gestor', 'Gestor', p.papel === 'gestor') + '</select></div>' +
          (editando ? '<div><label class="lb2">Status</label><select class="inp" id="pAtivo">' +
            opt('true', 'Ativo', p.ativo !== false) + opt('false', 'Inativo', p.ativo === false) + '</select></div>' : '') +
        '</div>' +
        '<div class="row2" style="margin-top:14px">' +
          '<button class="act" id="btnNovaPessoa">Salvar</button>' +
          '<button class="act ghost" id="btnCancelarNovo">Cancelar</button></div>' +
      '</div>';
    $('btnCancelarNovo').onclick = () => { $('areaNovo').innerHTML = ''; };
    $('areaNovo').scrollIntoView({ behavior: 'smooth', block: 'start' });

    $('btnNovaPessoa').onclick = async () => {
      const nome = $('pNome').value.trim(), matricula = $('pMat').value.trim();
      if (!nome || !matricula) { toast('Informe nome e matrícula', 'warn'); return; }
      const corpo = { nome, matricula, equipe_id: $('pEquipe').value, papel: $('pPapel').value };
      if (editando && $('pAtivo')) corpo.ativo = $('pAtivo').value === 'true';
      const btn = $('btnNovaPessoa'); btn.disabled = true; btn.textContent = 'Salvando…';
      const r = await ApiRh.colaborador(this.token, corpo);
      btn.disabled = false; btn.textContent = 'Salvar';
      if (!r.ok) { toast(r.erro || 'Falha', 'bad'); return; }
      toast(editando ? 'Colaborador atualizado' : 'Colaborador salvo', 'ok');
      await this.recarregar();
      $('areaNovo').innerHTML = '';
      // No cadastro novo, mostra o código de ativação para enviar ao funcionário.
      if (!editando) this.mostrarCodigoAtivacao(nome, matricula);
    };
  },

  /**
   * Código de ativação do colaborador. Não é senha — é o par (código da empresa
   * + matrícula) que ele digita UMA vez no app para parear o celular. Mostra com
   * botão de copiar e um texto pronto para mandar no WhatsApp.
   */
  mostrarCodigoAtivacao(nome, matricula) {
    const empresa = this.dados.empresa_id || '';
    const primeiro = String(nome || '').split(' ')[0];
    const link = location.origin;
    // Mensagem com cada dado em sua PRÓPRIA linha e prefixado — assim, mesmo no
    // WhatsApp, o funcionário consegue tocar-e-segurar pra copiar só o código.
    const texto = 'Olá ' + primeiro + '! Ative seu ponto facial:\n\n' +
      '1) Abra: ' + link + '\n' +
      '2) Toque em ATIVAR MEU PONTO\n\n' +
      'Código da empresa:\n' + empresa + '\n\n' +
      'Sua matrícula:\n' + matricula + '\n\n' +
      'Depois é só olhar para a câmera e piscar.';
    // cada campo com botão de copiar SÓ aquele valor
    const campo = (rotulo, valor, id) =>
      '<div class="cod-linha"><div class="cod-info"><span class="lb">' + rotulo + '</span>' +
        '<div class="mono cod">' + esc(valor) + '</div></div>' +
        '<button class="act ghost mini" data-copiar="' + esc(valor) + '" id="' + id + '">Copiar</button></div>';
    $('areaBio').innerHTML =
      '<div class="card"><h2>Código de ativação de ' + esc(nome) + '</h2>' +
        '<p class="nota" style="margin:-4px 0 12px">Envie ao funcionário. Ele usa uma vez para ativar o ponto no próprio celular. Copie cada dado separadamente ou a mensagem inteira.</p>' +
        campo('Código da empresa', empresa, 'cpEmp') +
        campo('Matrícula', matricula, 'cpMat') +
        campo('Link do app', link, 'cpLink') +
        '<button class="act" id="btnAbrirWa">📲 Enviar pelo WhatsApp</button>' +
        '<button class="act ghost" id="btnCopiarConvite">Copiar mensagem inteira</button>' +
        '<button class="act ghost" id="btnFecharCodigo">Fechar</button>' +
      '</div>';
    const copiar = async (valor, ok) => {
      try { await navigator.clipboard.writeText(valor); toast(ok, 'ok'); }
      catch (e) { toast('Não consegui copiar — selecione manualmente', 'warn'); }
    };
    $('areaBio').querySelectorAll('button[data-copiar]').forEach(b => {
      b.onclick = () => copiar(b.dataset.copiar, 'Copiado');
    });
    $('btnCopiarConvite').onclick = () => copiar(texto, 'Mensagem copiada');
    // Abre o WhatsApp com a mensagem pronta — o RH só escolhe o contato.
    $('btnAbrirWa').onclick = () => window.open('https://wa.me/?text=' + encodeURIComponent(texto), '_blank');
    $('btnFecharCodigo').onclick = () => { $('areaBio').innerHTML = ''; };
    $('areaBio').scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  async abrirBiometria(pessoaId) {
    const p = (this.dados.pessoas || []).find(x => x.pessoa_id === pessoaId);
    if (!p) return;
    this.alvoCadastro = p;
    this.capturas = [];
    // Layout compacto: a câmera fica num quadro de tamanho fixo (não empurra a
    // tela), as 3 miniaturas ao lado, e uma linha de status sempre visível.
    $('areaBio').innerHTML =
      '<div class="card bio"><h2>Biometria de ' + esc(p.nome) + '</h2>' +
        '<p class="nota" style="margin:-4px 0 10px">3 fotos de frente, boa luz. Sem boné, óculos escuros ou máscara. Pode tirar na hora ou enviar do arquivo.</p>' +
        '<div class="biogrid">' +
          '<div class="camwrap biocam">' +
            '<video id="videoCad" playsinline muted autoplay></video>' +
            '<div class="camoff" id="camOffCad">Câmera desligada</div>' +
          '</div>' +
          '<div class="shots" id="cadShots"></div>' +
        '</div>' +
        '<div id="bioStatus" class="biostatus"></div>' +
        '<div class="biobtns">' +
          '<button class="act" id="btnCapCad">📷 Tirar foto</button>' +
          '<button class="act ghost" id="btnUploadCad">🖼️ Enviar imagem</button>' +
          '<input type="file" id="fileCad" accept="image/*" class="hide" multiple>' +
        '</div>' +
        '<button class="act" id="btnSalvarBio" disabled>Salvar biometria</button>' +
        '<button class="act ghost" id="btnFecharBio">Fechar</button>' +
      '</div>';
    this.pintarShots();
    this.bioStatus('Toque em "Tirar foto" ou "Enviar imagem" para começar.');
    $('btnCapCad').onclick = () => this.capturarCadastro();
    $('btnUploadCad').onclick = () => $('fileCad').click();
    $('fileCad').onchange = e => this.enviarImagens(e.target.files);
    $('btnSalvarBio').onclick = () => this.salvarBiometria();
    $('btnFecharBio').onclick = () => { this.pararCamCad(); $('areaBio').innerHTML = ''; };
    $('areaBio').scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  /** Linha de status/rastreio: o RH entende o que está acontecendo e por quê. */
  bioStatus(msg, tipo) {
    const el = $('bioStatus');
    if (!el) return;
    el.textContent = msg;
    el.className = 'biostatus' + (tipo ? ' ' + tipo : '');
  },

  pintarShots() {
    $('cadShots').innerHTML = [0, 1, 2].map(i =>
      this.capturas[i] ? '<div><img src="' + this.capturas[i].thumb + '"></div>' : '<div class="vazio">' + (i + 1) + '</div>').join('');
    $('btnSalvarBio').disabled = this.capturas.length < 3;
    const btn = $('btnCapCad');
    if (btn) btn.textContent = this.capturas.length < 3 ? '📷 Tirar foto (' + this.capturas.length + '/3)' : '📷 Completo';
  },

  async ligarCamCad() {
    if (this._camCad) return true;
    try {
      this._camCad = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      $('videoCad').srcObject = this._camCad;
      await $('videoCad').play();
      $('camOffCad').classList.add('hide');
      return true;
    } catch (e) {
      this.bioStatus('Sem acesso à câmera (' + e.name + '). Use "Enviar imagem".', 'bad');
      return false;
    }
  },

  pararCamCad() {
    if (this._camCad) { this._camCad.getTracks().forEach(t => t.stop()); this._camCad = null; }
  },

  async capturarCadastro() {
    if (this.capturas.length >= 3) { this.bioStatus('Já tem 3 fotos. Salve ou remova para refazer.', 'warn'); return; }
    if (!Face.pronto) { this.bioStatus('Reconhecimento ainda carregando, aguarde…', 'warn'); return; }
    this.bioStatus('Ligando a câmera…');
    if (!(await this.ligarCamCad())) return;
    $('btnCapCad').disabled = true;
    this.bioStatus('Analisando o rosto…');
    try {
      const r = await Face.capturar($('videoCad'));
      if (!r) { this.bioStatus('Nenhum rosto detectado. Aproxime, melhore a luz e tente de novo.', 'bad'); return; }
      if (r.reprovado) { this.bioStatus('Qualidade insuficiente: ' + r.qualidade.msg + '. Tente de novo.', 'warn'); return; }
      this.capturas.push(r);
      this.pintarShots();
      this.bioStatus(this.capturas.length + ' de 3 capturadas. ' +
        (this.capturas.length < 3 ? 'Mova um pouco a cabeça e capture de novo.' : 'Pronto para salvar.'), 'ok');
    } catch (e) {
      this.bioStatus('Erro ao capturar: ' + (e.message || e), 'bad');
    } finally { $('btnCapCad').disabled = false; }
  },

  /** Upload de imagens do arquivo — mesmo gate de qualidade da câmera. */
  async enviarImagens(files) {
    if (!files || !files.length) return;
    if (!Face.pronto) { this.bioStatus('Reconhecimento ainda carregando, aguarde…', 'warn'); return; }
    for (const file of files) {
      if (this.capturas.length >= 3) break;
      this.bioStatus('Lendo "' + file.name + '"…');
      try {
        const img = await this.carregarImagem(file);
        const r = await Face.capturarDeImagem(img);
        if (!r) { this.bioStatus('Sem rosto em "' + file.name + '". Escolha uma foto de frente, nítida.', 'bad'); continue; }
        if (r.reprovado) { this.bioStatus('"' + file.name + '": ' + r.qualidade.msg + '. Tente outra.', 'warn'); continue; }
        this.capturas.push(r);
        this.pintarShots();
        this.bioStatus(this.capturas.length + ' de 3 prontas.', 'ok');
      } catch (e) {
        this.bioStatus('Não consegui ler "' + file.name + '": ' + (e.message || e), 'bad');
      }
    }
    $('fileCad').value = '';   // permite reenviar o mesmo arquivo
  },

  carregarImagem(file) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('arquivo de imagem inválido'));
      img.src = URL.createObjectURL(file);
    });
  },

  async salvarBiometria() {
    const c = this.capturas;
    if (c.length < 3) { this.bioStatus('Faltam capturas (precisa de 3).', 'warn'); return; }
    const coer = Math.max(
      euclidiana(c[0].descritor, c[1].descritor),
      euclidiana(c[0].descritor, c[2].descritor),
      euclidiana(c[1].descritor, c[2].descritor));
    if (coer > 0.55 && !confirm('As 3 capturas estão pouco parecidas entre si (' + coer.toFixed(3) +
      ').\n\nIsso costuma virar falso negativo depois. Salvar assim mesmo?')) return;
    $('btnSalvarBio').disabled = true;
    this.bioStatus('Salvando biometria…');
    const p = this.alvoCadastro;
    // Autenticado pelo JWT do RH — sem credencial de aparelho (o RH não tem uma).
    const bio = await ApiRh.biometria(this.token, {
      colaborador_id: p.pessoa_id, vetores: c.map(x => x.descritor),
      miniatura: c[0].thumb, coerencia: Number(coer.toFixed(4))
    });
    $('btnSalvarBio').disabled = false;
    if (!bio.ok) { this.bioStatus('Falha ao gravar: ' + (bio.erro || 'erro'), 'bad'); return; }
    toast('Biometria salva (coerência ' + coer.toFixed(3) + ')', 'ok');
    this.pararCamCad();
    $('areaBio').innerHTML = '';
    await this.recarregar();
  },

  /* --------------------------------------------------------- equipes */

  pintarEquipes() {
    const eqs = (this.dados.equipes || []).slice().sort((a, b) => a.nome.localeCompare(b.nome));
    const cont = {};
    for (const p of (this.dados.pessoas || [])) if (p.ativo) cont[p.equipe_id] = (cont[p.equipe_id] || 0) + 1;
    $('rh-equipes').innerHTML =
      '<div class="pg-head"><div><h1 class="tit">Equipes</h1>' +
        '<p class="sub">' + eqs.length + ' equipe(s) cadastrada(s).</p></div></div>' +
      '<div class="card"><h2>Nova equipe</h2>' +
        '<label class="lb">Nome</label><input type="text" id="eNome">' +
        '<label class="lb">Unidade</label><input type="text" id="eUnidade" value="Unidade Piloto">' +
        '<button class="act" id="btnNovaEquipe">Criar equipe</button>' +
        '<p class="nota" style="margin-top:8px">Equipes da mesma unidade compartilham a carga — é isso que permite marcar um colaborador remanejado sem cair em registro manual.</p></div>' +
      '<div class="card"><h2>Equipes</h2>' +
        (eqs.length ? eqs.map(e =>
          '<div class="linha-item"><span class="ponto ' + (e.ativo ? 'ok' : 'bad') + '"></span>' +
          '<div style="flex:1"><div class="nm">' + esc(e.nome) + '</div>' +
          '<div class="mt">' + esc(e.unidade) + ' · ' + (cont[e.equipe_id] || 0) + ' pessoas</div></div></div>').join('')
          : '<p class="nota">Nenhuma equipe.</p>') +
      '</div>';
    $('btnNovaEquipe').onclick = async () => {
      const r = await ApiRh.equipe(this.token, {
        nome: $('eNome').value.trim(), unidade: $('eUnidade').value.trim()
      });
      if (!r.ok) { toast(r.erro || 'Falha', 'bad'); return; }
      toast('Equipe criada', 'ok');
      await this.recarregar();
    };
  },

  /* ------------------------------------------------------- registros */

  pintarRegistros() {
    const pessoas = (this.dados.pessoas || []).slice().sort((a, b) => a.nome.localeCompare(b.nome));
    $('rh-registros').innerHTML =
      '<div class="pg-head"><div><h1 class="tit">Espelho de ponto</h1>' +
        '<p class="sub">Registros por colaborador no período.</p></div></div>' +
      '<div class="card"><h2>Espelho de ponto</h2>' +
        '<label class="lb">Colaborador</label><select id="regPessoa">' +
          pessoas.map(p => '<option value="' + p.pessoa_id + '">' + esc(p.nome) + '</option>').join('') +
        '</select><div id="regSaida"></div></div>';
    const desenhar = () => {
      const id = $('regPessoa').value;
      const linhas = espelho(this.dados.marcacoes, id);
      $('regSaida').innerHTML = linhas.length
        ? linhas.map(l => '<div class="esp"><span class="d">' + data(l.dia) + '</span><span>' +
            l.marcacoes.map(m => (m.tipo === 'entrada' ? 'E ' : 'S ') + '<span class="mono">' + hora(m.marcado_em) + '</span>' +
              (m.origem === 'manual' ? ' <span class="tag">manual</span>' : '') +
              (m.pendente ? ' <span class="tag">pendente</span>' : '')).join(' · ') +
            '</span></div>').join('')
        : '<p class="nota" style="margin-top:10px">Sem marcações no período.</p>';
    };
    $('regPessoa').onchange = desenhar;
    if (pessoas.length) desenhar();
  },

  /* --------------------------------------------------------- mapa operacional */

  pintarMapaOp() {
    $('rh-mapa').innerHTML =
      '<div class="pg-head"><div><h1 class="tit">Mapa</h1>' +
        '<p class="sub">Cercas ativas hoje e onde cada ponto foi registrado.</p></div></div>' +
      '<div id="mapaOp" class="mapa-full"></div>' +
      '<div class="mapa-legenda">' +
        '<span><i style="background:#1d4ed8"></i> cerca da equipe</span>' +
        '<span><i style="background:#12805c"></i> ponto dentro da cerca</span>' +
        '<span><i style="background:#b42318"></i> ponto fora da cerca</span></div>';
    MapaOp.abrir(this);
  },

  /* --------------------------------------------------------- jornadas */

  pintarJornadas() {
    const js = (this.dados.jornadas || []).slice().sort((a, b) => a.nome.localeCompare(b.nome));
    const eqs = (this.dados.equipes || []).slice().sort((a, b) => a.nome.localeCompare(b.nome));
    const pessoas = (this.dados.pessoas || []).filter(p => p.ativo);

    const linhaJornada = j =>
      '<tr><td><b>' + esc(j.nome) + '</b></td>' +
      '<td class="mono">' + esc(j.entrada) + ' → ' + esc(j.saida) + '</td>' +
      '<td>' + j.tolerancia_min + ' min</td>' +
      '<td><span class="pill ' + (j.ativa ? 'ok' : 'mut') + '"><span class="dot"></span>' + (j.ativa ? 'Ativa' : 'Inativa') + '</span></td>' +
      '<td style="text-align:right"><button class="v2btn ghost mini" data-jed="' + esc(j.jornada_id) + '">Editar</button></td></tr>';

    const linhaEquipe = e => {
      const opts = '<option value="">— sem jornada (usa padrão) —</option>' +
        js.map(j => '<option value="' + j.jornada_id + '"' + (e.jornada_id === j.jornada_id ? ' selected' : '') + '>' + esc(j.nome) + '</option>').join('');
      const sopts = '<option value="">— sem supervisor —</option>' +
        pessoas.map(p => '<option value="' + p.pessoa_id + '"' + (e.supervisor_id === p.pessoa_id ? ' selected' : '') + '>' + esc(p.nome) + '</option>').join('');
      return '<tr><td><b>' + esc(e.nome) + '</b></td>' +
        '<td><select class="inp" data-assoc-eq="' + esc(e.equipe_id) + '" data-assoc="jornada">' + opts + '</select></td>' +
        '<td><select class="inp" data-assoc-eq="' + esc(e.equipe_id) + '" data-assoc="supervisor">' + sopts + '</select></td></tr>';
    };

    $('rh-jornadas').innerHTML =
      '<div class="pg-head"><div><h1 class="tit">Jornadas</h1>' +
        '<p class="sub">Turnos de trabalho. A hora de entrada define quando a ausência vira pendência.</p></div>' +
        '<div class="acoes"><button class="v2btn" id="btnNovaJornada">+ Nova jornada</button></div></div>' +
      '<div id="areaJornada"></div>' +
      '<div class="tbl-wrap" style="margin-bottom:16px"><table class="adtable"><thead><tr>' +
        '<th>Jornada</th><th>Horário</th><th>Tolerância</th><th>Status</th><th></th></tr></thead><tbody>' +
        (js.length ? js.map(linhaJornada).join('') : '<tr><td colspan="5" style="padding:30px;text-align:center;color:#64748b">Nenhuma jornada. Crie a primeira.</td></tr>') +
      '</tbody></table></div>' +
      '<h2 style="font-size:16px;margin:0 0 12px">Jornada e supervisor por equipe</h2>' +
      '<div class="tbl-wrap"><table class="adtable"><thead><tr>' +
        '<th>Equipe</th><th>Jornada</th><th>Supervisor</th></tr></thead><tbody>' +
        (eqs.length ? eqs.map(linhaEquipe).join('') : '<tr><td colspan="3" style="padding:30px;text-align:center;color:#64748b">Nenhuma equipe.</td></tr>') +
      '</tbody></table></div>';

    $('btnNovaJornada').onclick = () => this.formJornada(null);
    $('rh-jornadas').querySelectorAll('[data-jed]').forEach(b => {
      b.onclick = () => this.formJornada(js.find(j => j.jornada_id === b.dataset.jed));
    });
    // Associação equipe→jornada/supervisor: grava no change.
    $('rh-jornadas').querySelectorAll('[data-assoc]').forEach(sel => {
      sel.onchange = async () => {
        const eqId = sel.dataset.assocEq;
        const jSel = $('rh-jornadas').querySelector('[data-assoc-eq="' + eqId + '"][data-assoc="jornada"]');
        const sSel = $('rh-jornadas').querySelector('[data-assoc-eq="' + eqId + '"][data-assoc="supervisor"]');
        const r = await ApiRh.jornada(this.token, {
          equipe_id: eqId, jornada_id: jSel.value || null, supervisor_id: sSel.value || null
        });
        if (!r.ok) { toast(r.erro || 'Falha', 'bad'); return; }
        toast('Equipe atualizada', 'ok');
        await this.recarregar();
      };
    });
  },

  formJornada(j) {
    j = j || {};
    $('areaJornada').innerHTML =
      '<div class="card"><h2>' + (j.jornada_id ? 'Editar jornada' : 'Nova jornada') + '</h2>' +
        '<div class="form-grid">' +
          '<div><label class="lb2">Nome</label><input class="inp" id="jNome" value="' + esc(j.nome || '') + '" placeholder="Ex.: Comercial"></div>' +
          '<div><label class="lb2">Entrada</label><input class="inp" id="jEntrada" type="time" value="' + esc(j.entrada || '07:00') + '"></div>' +
          '<div><label class="lb2">Saída</label><input class="inp" id="jSaida" type="time" value="' + esc(j.saida || '17:00') + '"></div>' +
          '<div><label class="lb2">Tolerância (min)</label><input class="inp" id="jTol" type="number" min="0" max="120" value="' + (j.tolerancia_min != null ? j.tolerancia_min : 10) + '"></div>' +
        '</div>' +
        '<div class="row2" style="margin-top:14px">' +
          '<button class="act" id="btnSalvarJornada">Salvar</button>' +
          '<button class="act ghost" id="btnCancelarJornada">Cancelar</button></div>' +
      '</div>';
    $('btnCancelarJornada').onclick = () => { $('areaJornada').innerHTML = ''; };
    $('btnSalvarJornada').onclick = async () => {
      const nome = $('jNome').value.trim();
      if (!nome) { toast('Informe o nome', 'warn'); return; }
      const r = await ApiRh.jornada(this.token, {
        jornada_id: j.jornada_id, nome, entrada: $('jEntrada').value, saida: $('jSaida').value,
        tolerancia_min: Number($('jTol').value) || 10
      });
      if (!r.ok) { toast(r.erro || 'Falha', 'bad'); return; }
      toast('Jornada salva', 'ok');
      $('areaJornada').innerHTML = '';
      await this.recarregar();
    };
    $('areaJornada').scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  /* --------------------------------------------------------- relatórios */

  pintarRelatorios() {
    const d = this.dados;
    const hoje = this.hojeServidor();
    const cfg = window.EFRAT_CFG || {};
    const ind = indicadores(d.marcacoes, d.pessoas, d.equipes);
    const serie = serieDiaria(d.marcacoes, d.periodo_dias || this.dias, hoje);
    const motivos = pendenciasPorMotivo(d.marcacoes, d.recadastros, d.pessoas);

    $('rh-relatorios').innerHTML =
      '<div class="pg-head"><div><h1 class="tit">Relatórios</h1>' +
        '<p class="sub">Marcações, presença e registro manual no período de ' + (d.periodo_dias || this.dias) + ' dias.</p></div>' +
        '<div class="acoes"><button class="v2btn ghost" id="btnCsvMarc">Exportar marcações (CSV)</button>' +
          '<button class="v2btn ghost" id="btnCsvEquipe">Exportar por equipe (CSV)</button></div></div>' +
      '<div class="vizrow">' +
        '<div class="v2card" style="padding:15px">' +
          '<h2 style="margin:0 0 4px;font-size:14px;font-weight:600">Marcações por dia</h2>' +
          '<p style="font-size:12px;color:#64748b;margin:0 0 10px">biometria e manual</p>' +
          '<div class="cv" id="boxLinha" style="position:relative;height:240px"></div></div>' +
        '<div class="v2card" style="padding:15px">' +
          '<h2 style="margin:0 0 4px;font-size:14px;font-weight:600">Taxa de registro manual por equipe</h2>' +
          '<p style="font-size:12px;color:#64748b;margin:0 0 10px">alarme em ' + (cfg.alarmeManual || 20) + '%</p>' +
          '<div class="cv" id="boxManual" style="position:relative;height:240px"></div></div>' +
      '</div>' +
      '<div class="vizrow">' +
        '<div class="v2card" style="padding:15px">' +
          '<h2 style="margin:0 0 4px;font-size:14px;font-weight:600">Pendências por motivo</h2>' +
          '<p style="font-size:12px;color:#64748b;margin:0 0 10px">o que está segurando a fila</p>' +
          '<div class="cv" id="boxMotivo" style="position:relative;height:240px"></div></div>' +
        '<div class="v2card" style="padding:15px"><h2 style="margin:0 0 10px;font-size:14px;font-weight:600">Resumo</h2>' +
          '<table class="adtable"><tbody>' +
            '<tr><td>Total de marcações</td><td style="text-align:right"><b>' + ind.total + '</b></td></tr>' +
            '<tr><td>Registro manual</td><td style="text-align:right"><b>' + ind.taxaManual + '%</b></td></tr>' +
            '<tr><td>Pendências abertas</td><td style="text-align:right"><b>' + ind.pendentes + '</b></td></tr>' +
            '<tr><td>Ativos sem biometria</td><td style="text-align:right"><b>' + ind.semBiometria + '</b></td></tr>' +
          '</tbody></table></div>' +
      '</div>';

    $('btnCsvMarc').onclick = () => {
      const linhas = (d.marcacoes || []).map(m => [
        m.marcado_dia, String(m.marcado_em).slice(11, 16), this.nomeDe(m.pessoa_id),
        this.nomeEquipe(m.equipe_id), m.tipo, m.origem, m.veredito,
        m.dentro_cerca === false ? 'fora' : (m.dentro_cerca ? 'dentro' : '')
      ]);
      this.baixarCsv('marcacoes-' + hoje + '.csv',
        ['Dia', 'Hora', 'Colaborador', 'Equipe', 'Tipo', 'Origem', 'Veredito', 'Cerca'], linhas);
    };
    $('btnCsvEquipe').onclick = () => {
      const linhas = ind.equipes.map(e => [e.nome, e.pessoas, e.marcacoes, e.manuais, e.taxa_manual + '%', e.pendentes]);
      this.baixarCsv('equipes-' + hoje + '.csv',
        ['Equipe', 'Pessoas', 'Marcações', 'Manuais', 'Taxa manual', 'Pendentes'], linhas);
    };

    this.carregarGraficos({ serie, equipes: ind.equipes, motivos, alarme: cfg.alarmeManual || 20 });
  },

  baixarCsv(nome, cabecalho, linhas) {
    const csv = '﻿' + csvDe(cabecalho, linhas);   // BOM p/ acento no Excel
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nome; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('CSV gerado', 'ok');
  },

  /* --------------------------------------------------------- auditoria */

  pintarAuditoria() {
    const cs = this.dados.correcoes || [];
    const rotAcao = a => a === 'aprovar' ? 'Aprovou' : a === 'rejeitar' ? 'Rejeitou' : a === 'lancar' ? 'Lançou' : esc(a);
    const pillAcao = a => a === 'rejeitar' ? 'bad' : a === 'aprovar' ? 'ok' : 'mut';

    const linha = c =>
      '<tr><td class="mono" style="white-space:nowrap">' + esc(String(c.criada_em).slice(0, 16).replace('T', ' ')) + '</td>' +
      '<td>' + esc(c.usuario_rh_nome || c.usuario_rh_login || 'RH') + '</td>' +
      '<td><span class="pill ' + pillAcao(c.acao) + '"><span class="dot"></span>' + rotAcao(c.acao) + '</span></td>' +
      '<td>' + esc(c.pessoa_nome || (c.alvo_tipo === 'template' ? 'recadastro' : '—')) + '</td>' +
      '<td style="color:#64748b">' + esc(c.motivo || '—') + '</td></tr>';

    $('rh-auditoria').innerHTML =
      '<div class="pg-head"><div><h1 class="tit">Auditoria</h1>' +
        '<p class="sub">Trilha imutável de todas as decisões do RH sobre o ponto.</p></div>' +
        '<div class="acoes"><button class="v2btn ghost" id="btnCsvAud">Exportar (CSV)</button></div></div>' +
      '<div class="tbl-wrap"><div class="tbl-bar">' +
        '<div class="tbl-busca">🔍<input id="audBusca" placeholder="Buscar por pessoa, RH ou motivo…"></div>' +
        '<span style="margin-left:auto;font-size:12.5px;color:#94a3b8">' + cs.length + ' registro(s)</span></div>' +
        '<div style="overflow:auto"><table class="adtable"><thead><tr>' +
          '<th>Quando</th><th>Quem</th><th>Ação</th><th>Colaborador</th><th>Motivo</th></tr></thead>' +
          '<tbody id="audBody">' +
          (cs.length ? cs.map(linha).join('') : '<tr><td colspan="5" style="padding:40px;text-align:center;color:#64748b">Nenhuma decisão registrada ainda.</td></tr>') +
        '</tbody></table></div></div>';

    const busca = $('audBusca');
    busca.oninput = () => {
      const q = busca.value.toLowerCase();
      const filtradas = cs.filter(c =>
        ((c.pessoa_nome || '') + ' ' + (c.usuario_rh_nome || '') + ' ' + (c.motivo || '')).toLowerCase().includes(q));
      $('audBody').innerHTML = filtradas.length ? filtradas.map(linha).join('')
        : '<tr><td colspan="5" style="padding:30px;text-align:center;color:#64748b">Nada encontrado.</td></tr>';
    };
    $('btnCsvAud').onclick = () => {
      const linhas = cs.map(c => [String(c.criada_em).slice(0, 16).replace('T', ' '),
        c.usuario_rh_nome || c.usuario_rh_login || 'RH', rotAcao(c.acao), c.pessoa_nome || '', c.motivo || '']);
      this.baixarCsv('auditoria.csv', ['Quando', 'Quem', 'Ação', 'Colaborador', 'Motivo'], linhas);
    };
  },

  /* --------------------------------------------------------- configurações */

  pintarConfig() {
    const cfg = window.EFRAT_CFG || {};
    const emp = this.dados.empresa || {};
    const usuarios = this.dados.usuarios_rh || [];

    const linhaUsuario = u =>
      '<tr><td><b>' + esc(u.nome) + '</b> <span style="color:#94a3b8">@' + esc(u.usuario) + '</span>' +
        (u.trocar_senha ? ' <span class="pill warn" style="padding:0 6px">senha temporária</span>' : '') + '</td>' +
      '<td>' + esc(u.criado_em || '') + '</td>' +
      '<td><span class="pill ' + (u.ativo ? 'ok' : 'mut') + '"><span class="dot"></span>' + (u.ativo ? 'Ativo' : 'Inativo') + '</span></td>' +
      '<td style="text-align:right">' + (u.usuario_id === this.dados.usuario.id ? '<span style="color:#94a3b8;font-size:12px">você</span>' :
        '<button class="v2btn ghost mini" data-uativar="' + esc(u.usuario_id) + '" data-estado="' + (u.ativo ? 'desativar' : 'ativar') + '">' + (u.ativo ? 'Desativar' : 'Reativar') + '</button>') + '</td></tr>';

    $('rh-config').innerHTML =
      '<div class="pg-head"><div><h1 class="tit">Configurações</h1>' +
        '<p class="sub">Parâmetros da operação, dados da empresa e acesso do RH.</p></div></div>' +

      '<div class="cfg-sec"><h2>Anti-fraude e operação</h2>' +
        '<p class="cap">Estes valores valem para o app do colaborador e para a detecção de exceções.</p>' +
        '<div class="form-grid">' +
          '<div><label class="lb2">Limiar facial (aceite)</label><input class="inp" id="cfLimiar" type="number" step="0.01" min="0.2" max="0.9" value="' + (cfg.limiarAceite ?? 0.45) + '"></div>' +
          '<div><label class="lb2">Raio de cerca padrão (m)</label><input class="inp" id="cfRaio" type="number" min="30" max="5000" value="' + (cfg.raioPadraoM ?? 200) + '"></div>' +
          '<div><label class="lb2">Tolerância GPS (m)</label><input class="inp" id="cfGps" type="number" min="0" max="500" value="' + (cfg.toleranciaGpsM ?? 100) + '"></div>' +
          '<div><label class="lb2">Hora-limite de entrada</label><input class="inp" id="cfHora" type="time" value="' + (cfg.horaEntrada || '08:00') + '"></div>' +
          '<div><label class="lb2">Alarme de registro manual (%)</label><input class="inp" id="cfAlarme" type="number" min="1" max="100" value="' + (cfg.alarmeManual ?? 20) + '"></div>' +
        '</div>' +
        '<button class="act" id="btnSalvarCfg" style="margin-top:14px;width:auto;padding:10px 18px">Salvar parâmetros</button></div>' +

      '<div class="cfg-sec"><h2>Empresa</h2>' +
        '<p class="cap">Nome exibido no painel e no pareamento do colaborador.</p>' +
        '<div class="form-grid">' +
          '<div><label class="lb2">Nome da empresa</label><input class="inp" id="cfNome" value="' + esc(emp.nome || '') + '"></div>' +
          '<div><label class="lb2">Fuso horário</label><input class="inp" id="cfFuso" value="' + esc(emp.fuso || 'America/Campo_Grande') + '"></div>' +
        '</div>' +
        '<button class="act" id="btnSalvarEmp" style="margin-top:14px;width:auto;padding:10px 18px">Salvar empresa</button></div>' +

      '<div class="cfg-sec"><h2>Usuários do RH</h2>' +
        '<p class="cap">Crie acessos para a equipe de RH. A senha temporária aparece uma vez — repasse com segurança.</p>' +
        '<div class="tbl-wrap" style="margin-bottom:12px"><table class="adtable"><thead><tr>' +
          '<th>Usuário</th><th>Criado</th><th>Status</th><th></th></tr></thead><tbody>' +
          usuarios.map(linhaUsuario).join('') + '</tbody></table></div>' +
        '<div id="areaNovoUsuario"></div>' +
        '<button class="v2btn" id="btnNovoUsuario">+ Novo usuário RH</button></div>';

    $('btnSalvarCfg').onclick = async () => {
      const dados = {
        limiarAceite: Number($('cfLimiar').value), raioPadraoM: Number($('cfRaio').value),
        toleranciaGpsM: Number($('cfGps').value), horaEntrada: $('cfHora').value,
        alarmeManual: Number($('cfAlarme').value)
      };
      const r = await ApiRh.config(this.token, { dados });
      if (!r.ok) { toast(r.erro || 'Falha', 'bad'); return; }
      toast('Parâmetros salvos', 'ok');
      await this.recarregar();
    };
    $('btnSalvarEmp').onclick = async () => {
      const r = await ApiRh.config(this.token, { empresa_nome: $('cfNome').value.trim(), fuso: $('cfFuso').value.trim() });
      if (!r.ok) { toast(r.erro || 'Falha', 'bad'); return; }
      toast('Empresa atualizada', 'ok');
      await this.recarregar();
    };
    $('btnNovoUsuario').onclick = () => this.formNovoUsuario();
    $('rh-config').querySelectorAll('[data-uativar]').forEach(b => {
      b.onclick = async () => {
        const r = await ApiRh.usuario(this.token, { acao: b.dataset.estado, usuario_id: b.dataset.uativar });
        if (!r.ok) { toast(r.erro || 'Falha', 'bad'); return; }
        toast('Usuário atualizado', 'ok');
        await this.recarregar();
      };
    });
  },

  formNovoUsuario() {
    $('areaNovoUsuario').innerHTML =
      '<div class="card"><h2>Novo usuário RH</h2>' +
        '<div class="form-grid">' +
          '<div><label class="lb2">Nome</label><input class="inp" id="nuNome"></div>' +
          '<div><label class="lb2">Usuário (login)</label><input class="inp" id="nuUsuario" autocapitalize="off" placeholder="ex.: maria.rh"></div>' +
        '</div>' +
        '<div class="row2" style="margin-top:14px">' +
          '<button class="act" id="btnCriarUsuario">Criar</button>' +
          '<button class="act ghost" id="btnCancelarUsuario">Cancelar</button></div>' +
        '<div id="nuResultado"></div>' +
      '</div>';
    $('btnCancelarUsuario').onclick = () => { $('areaNovoUsuario').innerHTML = ''; };
    $('btnCriarUsuario').onclick = async () => {
      const nome = $('nuNome').value.trim(), usuario = $('nuUsuario').value.trim();
      if (!nome || !usuario) { toast('Informe nome e usuário', 'warn'); return; }
      const btn = $('btnCriarUsuario'); btn.disabled = true; btn.textContent = 'Criando…';
      const r = await ApiRh.usuario(this.token, { acao: 'criar', nome, usuario });
      btn.disabled = false; btn.textContent = 'Criar';
      if (!r.ok) { toast(r.erro || 'Falha', 'bad'); return; }
      // Atualiza a lista em segundo plano SEM repintar a aba (não perder a senha).
      const d = await ApiRh.dados(this.token, this.dias);
      if (d.ok) { this.dados = d.dados; this.aplicarConfig(); }
      // A senha temporária aparece UMA vez — mostra destacada para repassar.
      $('nuResultado').innerHTML =
        '<div class="senha-box">Usuário <b>@' + esc(r.dados.usuario) + '</b> criado. Senha temporária (repasse com ' +
        'segurança; ele troca no 1º acesso):<div class="mono" style="margin-top:6px">' + esc(r.dados.senha_temporaria) + '</div>' +
        '<button class="v2btn ghost mini" id="btnFecharSenha" style="margin-top:10px">Concluir</button></div>';
      $('nuNome').value = ''; $('nuUsuario').value = '';
      $('btnFecharSenha').onclick = () => { this.pintarConfig(); };
    };
    $('areaNovoUsuario').scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  /* ------------------------------------------------- troca de senha temporária */

  telaTrocarSenha() {
    $('rh-painel').classList.remove('hide');
    ['alocacao', 'mapa', 'pendencias', 'pessoas', 'equipes', 'registros', 'jornadas', 'relatorios', 'auditoria', 'config', 'stub']
      .forEach(a => { const el = $('rh-' + a); if (el) el.classList.add('hide'); });
    $('rhCrumb').textContent = 'Trocar senha';
    $('rhNome').textContent = this.dados.usuario.nome || 'RH';
    $('rhIniciais').textContent = this.iniciais(this.dados.usuario.nome || 'RH');
    $('rh-painel').innerHTML =
      '<div class="cfg-sec" style="max-width:460px;margin:40px auto">' +
        '<h2>Defina uma nova senha</h2>' +
        '<p class="cap">Seu acesso usa uma senha temporária. Escolha uma senha só sua para continuar.</p>' +
        '<label class="lb2">Nova senha</label><input class="inp" id="tsNova" type="password">' +
        '<label class="lb2">Confirmar</label><input class="inp" id="tsConf" type="password">' +
        '<button class="act" id="btnTrocarSenha" style="margin-top:16px">Salvar e entrar</button>' +
      '</div>';
    $('btnTrocarSenha').onclick = async () => {
      const nova = $('tsNova').value, conf = $('tsConf').value;
      if (nova.length < 8) { toast('A senha precisa de ao menos 8 caracteres', 'warn'); return; }
      if (nova !== conf) { toast('As senhas não conferem', 'warn'); return; }
      // Deriva no navegador com um sal novo (mesma mecânica do login).
      const salNovo = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
      const chaveNova = await derivar(nova, salNovo, 150000);
      const r = await ApiRh.usuario(this.token, { acao: 'trocar_senha', chave_nova: chaveNova, sal_novo: salNovo });
      if (!r.ok) { toast(r.erro || 'Falha ao trocar senha', 'bad'); return; }
      toast('Senha atualizada', 'ok');
      this.precisaTrocarSenha = false;
      this.abrir(this.aoSair);   // agora entra normalmente
    };
  }
};
