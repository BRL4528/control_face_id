// Painel do RH. Tudo que é administração vive aqui e em lugar nenhum mais.
import { ApiRh } from './api.js';
import { Alocacao } from './alocacao.js';
import { Face } from './face.js';
import { derivar } from './cripto.js';
import {
  indicadores, espelho, euclidiana,
  presencaPorEquipe, serieDiaria, pendenciasPorMotivo,
  exceptionsDoDia, TIPOS_EXCECAO
} from './regras.js';
import { $, esc, mostrar, toast, hora, data } from './ui.js';

// Rótulo da aba na trilha do topo (breadcrumb) e no título de página.
const TITULOS = {
  painel: 'Central operacional', alocacao: 'Alocações', pendencias: 'Pendências',
  pessoas: 'Colaboradores', equipes: 'Equipes', registros: 'Espelho de ponto'
};

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

  async entrar(usuario, senha) {
    const s = await ApiRh.sal(usuario);
    if (!s.ok || !s.json) return { ok: false, erro: 'servidor indisponível' };
    const chave = await derivar(senha, s.json.sal, s.json.iteracoes);
    const login = await ApiRh.login(usuario, chave);
    if (!login.ok) return { ok: false, erro: login.erro || 'usuário ou senha inválidos' };
    this.token = login.dados.token;
    const d = await ApiRh.dados(this.token, this.dias);
    if (!d.ok) return { ok: false, erro: d.erro || 'falha ao carregar' };
    this.dados = d.dados;
    return { ok: true };
  },

  async recarregar() {
    const d = await ApiRh.dados(this.token, this.dias);
    if (d.ok) this.dados = d.dados;
    this.pintar();
  },

  abrir(aoSair) {
    this.aoSair = aoSair;
    mostrar('rh');
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

    // badge de pendências abertas na sidebar
    const nExc = this.exceptions().length;
    const badge = $('navBadgePend');
    if (badge) { badge.textContent = nExc; badge.classList.toggle('hide', nExc === 0); }

    // trilha do topo
    $('rhCrumb').textContent = this.aba === 'stub' ? this.stub : (TITULOS[this.aba] || '');

    ['painel', 'alocacao', 'pendencias', 'pessoas', 'equipes', 'registros', 'stub'].forEach(a =>
      $('rh-' + a).classList.toggle('hide', a !== this.aba));
    if (this.aba === 'painel') this.pintarPainel();
    if (this.aba === 'alocacao') this.pintarAlocacao();
    if (this.aba === 'pendencias') this.pintarPendencias();
    if (this.aba === 'pessoas') this.pintarPessoas();
    if (this.aba === 'equipes') this.pintarEquipes();
    if (this.aba === 'registros') this.pintarRegistros();
    if (this.aba === 'stub') this.pintarStub();
  },

  /** A fila de exceções de hoje, calculada da regra pura. Cache por pintura. */
  exceptions() {
    const d = this.dados || {};
    return exceptionsDoDia(
      d.marcacoes, d.pessoas, d.alocacoes_hoje, this.hojeServidor(),
      d.servidor_hora, (window.EFRAT_CFG && window.EFRAT_CFG.horaEntrada) || '08:00');
  },

  jornadaDe(equipeId) {
    // Jornada padrão da equipe. Sem cadastro de jornada ainda: valor operacional.
    return (window.EFRAT_CFG && window.EFRAT_CFG.jornadaPadrao) || '07:00–17:00';
  },

  nomeDe(id) {
    const p = (this.dados.pessoas || []).find(x => x.pessoa_id === id);
    return p ? p.nome : id;
  },
  nomeEquipe(id) {
    const e = (this.dados.equipes || []).find(x => x.equipe_id === id);
    return e ? e.nome : '—';
  },

  /* ----------------------------------------------------- alocação (mapa) */

  pintarAlocacao() { Alocacao.abrir(this); },

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
        (ultima.tipo === 'entrada' ? 'E ' : 'S ') + hora(ultima.marcado_em)
      : '— sem registro';
    return { status, ultimo };
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
    $('btnAbrirNovo').onclick = () => this.abrirNovoColaborador(eqs);

    $('rh-pessoas').querySelectorAll('button[data-bio]').forEach(b => {
      b.onclick = () => this.abrirBiometria(b.dataset.bio);
    });
    $('rh-pessoas').querySelectorAll('button[data-codigo]').forEach(b => {
      b.onclick = () => this.mostrarCodigoAtivacao(b.dataset.nome, b.dataset.codigo);
    });
  },

  /** Formulário "novo colaborador" — agora um painel que abre sob o cabeçalho. */
  abrirNovoColaborador(eqs) {
    $('areaNovo').innerHTML =
      '<div class="card"><h2>Novo colaborador</h2>' +
        '<label class="lb">Nome</label><input type="text" id="pNome">' +
        '<label class="lb">Matrícula</label><input type="text" id="pMat">' +
        '<label class="lb">Equipe</label><select id="pEquipe">' +
          (eqs || []).map(e => '<option value="' + e.equipe_id + '">' + esc(e.nome) + '</option>').join('') + '</select>' +
        '<label class="lb">Papel</label><select id="pPapel">' +
          '<option value="colaborador">Colaborador</option><option value="gestor">Gestor</option></select>' +
        '<div class="row2" style="margin-top:12px">' +
          '<button class="act" id="btnNovaPessoa">Salvar</button>' +
          '<button class="act ghost" id="btnCancelarNovo">Cancelar</button></div>' +
      '</div>';
    $('btnCancelarNovo').onclick = () => { $('areaNovo').innerHTML = ''; };
    $('areaNovo').scrollIntoView({ behavior: 'smooth', block: 'start' });

    $('btnNovaPessoa').onclick = async () => {
      const nome = $('pNome').value.trim(), matricula = $('pMat').value.trim();
      if (!nome || !matricula) { toast('Informe nome e matrícula', 'warn'); return; }
      const r = await ApiRh.colaborador(this.token, {
        nome, matricula, equipe_id: $('pEquipe').value, papel: $('pPapel').value
      });
      if (!r.ok) { toast(r.erro || 'Falha', 'bad'); return; }
      toast('Colaborador salvo', 'ok');
      await this.recarregar();
      $('areaNovo').innerHTML = '';
      // Mostra o código de ativação logo após salvar — é o que o RH envia ao
      // funcionário para ele ativar o ponto no próprio celular.
      this.mostrarCodigoAtivacao(nome, matricula);
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
  }
};
