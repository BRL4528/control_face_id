// Painel do RH. Tudo que é administração vive aqui e em lugar nenhum mais.
import { ApiRh } from './api.js';
import { Face } from './face.js';
import { derivar } from './cripto.js';
import {
  indicadores, espelho, euclidiana,
  presencaPorEquipe, serieDiaria, pendenciasPorMotivo
} from './regras.js';
import { $, esc, mostrar, toast, hora, data } from './ui.js';

export const Rh = {
  cred: null,
  dados: null,
  aba: 'painel',
  aoSair: null,
  capturas: [],
  alvoCadastro: null,
  dias: 30,          // período ativo do painel (7 / 30 / 90)
  _charts: [],       // instâncias Chart.js vivas, destruídas ao repintar
  _Chart: null,      // biblioteca carregada sob demanda

  async entrar(usuario, senha) {
    const s = await ApiRh.sal(usuario);
    if (!s.ok) return { ok: false, erro: s.erro || 'servidor indisponível' };
    const chave = await derivar(senha, s.dados.sal, s.dados.iteracoes);
    const cred = { usuario, chave };
    const d = await ApiRh.dados(cred, this.dias);
    if (!d.ok) return { ok: false, erro: d.erro || 'usuário ou senha inválidos' };
    this.cred = cred;
    this.dados = d.dados;
    return { ok: true };
  },

  async recarregar() {
    const d = await ApiRh.dados(this.cred, this.dias);
    if (d.ok) this.dados = d.dados;
    this.pintar();
  },

  abrir(aoSair) {
    this.aoSair = aoSair;
    mostrar('rh');
    $('rhNome').textContent = this.dados.usuario.nome || 'RH';
    $('rhPeriodo').textContent = 'últimos ' + this.dados.periodo_dias + ' dias';
    document.querySelectorAll('#rh nav button').forEach(b => {
      b.onclick = () => { this.aba = b.dataset.aba; this.pintar(); };
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
    $('btnSairRh').onclick = () => { this.destruirGraficos(); this.cred = null; this.dados = null; this.aoSair(); };
    this.pintar();
  },

  /** Chart.js vaza canvas se repintado sem destruir a instância anterior. */
  destruirGraficos() {
    for (const c of this._charts) { try { c.destroy(); } catch (e) { /* já morto */ } }
    this._charts = [];
  },

  pintar() {
    this.destruirGraficos();   // troca de aba mata os gráficos da anterior
    $('rhPeriodo').textContent = 'últimos ' + (this.dados.periodo_dias || this.dias) + ' dias';
    document.querySelectorAll('#rh nav button').forEach(b => b.classList.toggle('on', b.dataset.aba === this.aba));
    ['painel', 'pendencias', 'pessoas', 'equipes', 'registros'].forEach(a =>
      $('rh-' + a).classList.toggle('hide', a !== this.aba));
    if (this.aba === 'painel') this.pintarPainel();
    if (this.aba === 'pendencias') this.pintarPendencias();
    if (this.aba === 'pessoas') this.pintarPessoas();
    if (this.aba === 'equipes') this.pintarEquipes();
    if (this.aba === 'registros') this.pintarRegistros();
  },

  nomeDe(id) {
    const p = (this.dados.pessoas || []).find(x => x.pessoa_id === id);
    return p ? p.nome : id;
  },
  nomeEquipe(id) {
    const e = (this.dados.equipes || []).find(x => x.equipe_id === id);
    return e ? e.nome : '—';
  },

  /* --------------------------------------------------------- painel */

  // "Hoje" segundo o relógio do servidor, não o do PC do RH — é ele que carimba
  // marcado_dia. Sem isso, um PC com data errada mostraria a equipe toda ausente.
  hojeServidor() {
    const iso = this.dados.servidor_hora || new Date().toISOString();
    return String(iso).slice(0, 10);
  },

  pintarPainel() {
    const d = this.dados;
    const hoje = this.hojeServidor();
    const cfg = window.EFRAT_CFG || {};
    const ICONE = { bom: '✓', atencao: '!', serio: '▲', critico: '✕' };

    const ind = indicadores(d.marcacoes, d.pessoas, d.equipes);
    const cards = presencaPorEquipe(d.pessoas, d.marcacoes, d.equipes, hoje);
    const serie = serieDiaria(d.marcacoes, d.periodo_dias || this.dias, hoje);
    const motivos = pendenciasPorMotivo(d.marcacoes, d.recadastros, d.pessoas);

    // presença de hoje, agregada sobre todas as equipes com card
    const esp = cards.reduce((s, c) => s + c.esperados, 0);
    const pre = cards.reduce((s, c) => s + c.presentes, 0);
    const presencaHoje = esp ? Math.round((pre / esp) * 100) : null;

    const tile = (lab, val, extra) =>
      '<div class="tile"><div class="lab">' + esc(lab) + '</div>' +
      '<div class="val">' + val + '</div>' +
      (extra ? '<div class="var">' + extra + '</div>' : '') + '</div>';

    const cardHtml = c => {
      const tit = c.ausentes.length
        ? 'Ausentes hoje: ' + esc(c.ausentes.join(', '))
        : 'Todos presentes';
      return '<div class="eqcard ' + c.status + '" title="' + tit + '">' +
        '<div class="bar"></div>' +
        '<div class="cnt"><span class="ic">' + ICONE[c.status] + '</span>' +
          c.presentes + '/' + c.esperados + '</div>' +
        '<div class="eqn">' + esc(c.nome) + '</div></div>';
    };

    $('rh-painel').className = 'viz';
    $('rh-painel').innerHTML =
      '<div class="tiles">' +
        tile('Presença hoje', presencaHoje == null ? '—' : presencaHoje + '%') +
        tile('Taxa manual', ind.taxaManual + '%') +
        tile('Pendências abertas', ind.pendentes) +
        tile('Ativos sem biometria', ind.semBiometria) +
      '</div>' +

      '<h3 style="font-size:14px;margin:0 0 8px">Equipes hoje</h3>' +
      (cards.length
        ? '<div class="cards">' + cards.map(cardHtml).join('') + '</div>'
        : '<p class="nota" style="margin-bottom:16px">Nenhuma equipe com pessoas ativas.</p>') +

      '<div class="vizrow">' +
        '<div class="vizbox">' +
          '<h3>Marcações por dia</h3>' +
          '<p class="cap">últimos ' + (d.periodo_dias || this.dias) + ' dias · biometria e manual</p>' +
          '<div class="cv" id="boxLinha"></div>' +
          '<button class="verdados" data-tab="tabLinha">ver dados</button>' +
          '<div id="tabLinha" class="hide"></div>' +
        '</div>' +
        '<div class="vizbox">' +
          '<h3>Taxa de registro manual por equipe</h3>' +
          '<p class="cap">onde a biometria parou · alarme em ' + (cfg.alarmeManual || 20) + '%</p>' +
          '<div class="cv" id="boxManual"></div>' +
          '<button class="verdados" data-tab="tabManual">ver dados</button>' +
          '<div id="tabManual" class="hide"></div>' +
        '</div>' +
        '<div class="vizbox">' +
          '<h3>Pendências por motivo</h3>' +
          '<p class="cap">clique numa barra para filtrar</p>' +
          '<div class="cv" id="boxMotivo"></div>' +
          '<button class="verdados" data-tab="tabMotivo">ver dados</button>' +
          '<div id="tabMotivo" class="hide"></div>' +
        '</div>' +
      '</div>';

    // botões "ver dados": alternam a tabela alternativa de cada gráfico
    $('rh-painel').querySelectorAll('.verdados').forEach(b => {
      b.onclick = () => $(b.dataset.tab).classList.toggle('hide');
    });

    // as tabelas alternativas existem sempre (leitor de tela, cópia p/ planilha)
    this.tabelaSerie($('tabLinha'), serie);
    this.tabelaManual($('tabManual'), ind.equipes);
    this.tabelaMotivos($('tabMotivo'), motivos);

    this.carregarGraficos({ serie, equipes: ind.equipes, motivos, alarme: cfg.alarmeManual || 20 });
  },

  /* ------------------------------------------------ tabelas alternativas */

  tabelaSerie(el, serie) {
    if (!el) return;
    const linhas = serie.dias.map((dd, i) =>
      '<tr><td>' + data(dd) + '</td><td>' + serie.biometria[i] + '</td><td>' +
      serie.manual[i] + '</td><td>' + serie.total[i] + '</td></tr>').join('');
    el.innerHTML = '<table class="tabdados"><thead><tr><th>Dia</th><th>Biometria</th>' +
      '<th>Manual</th><th>Total</th></tr></thead><tbody>' + linhas + '</tbody></table>';
  },

  tabelaManual(el, equipes) {
    if (!el) return;
    const linhas = equipes.map(e =>
      '<tr><td>' + esc(e.nome) + '</td><td>' + e.taxa_manual + '%</td><td>' +
      e.marcacoes + '</td></tr>').join('');
    el.innerHTML = '<table class="tabdados"><thead><tr><th>Equipe</th>' +
      '<th>Taxa manual</th><th>Marcações</th></tr></thead><tbody>' + linhas + '</tbody></table>';
  },

  tabelaMotivos(el, motivos) {
    if (!el) return;
    const linhas = motivos.map(m =>
      '<tr><td>' + esc(m.rotulo) + '</td><td>' + m.total + '</td></tr>').join('');
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

    const s1 = this.css('--serie-1') || '#2a78d6';
    const s2 = this.css('--serie-2') || '#eb6834';
    const grid = this.css('--v-grid') || '#2c3e50';
    const txt = this.css('--v-text2') || '#8fa3b5';
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
    const ms = (this.dados.marcacoes || []).filter(m => m.pendente)
      .sort((a, b) => String(b.marcado_em).localeCompare(String(a.marcado_em)));
    const rc = this.dados.recadastros || [];
    const el = $('rh-pendencias');
    if (!ms.length && !rc.length) {
      el.innerHTML = '<div class="card"><p class="nota">Nada esperando decisão. 🎉</p></div>';
      return;
    }
    el.innerHTML =
      rc.map(t => {
        const p = (this.dados.pessoas || []).find(x => x.pessoa_id === t.pessoa_id) || {};
        return '<div class="pend"><div class="top"><div style="flex:1">' +
          '<div class="nm"><b>Recadastro</b> · ' + esc(p.nome || t.pessoa_id) + '</div>' +
          '<div class="mt">versão ' + t.versao + ' · coerência ' + (t.coerencia == null ? '—' : Number(t.coerencia).toFixed(3)) + '</div>' +
          '</div></div>' +
          '<div class="fotos">' +
            (p.miniatura ? '<img src="' + p.miniatura + '">' : '<div class="vazio">atual</div>') +
            (t.miniatura ? '<img src="' + t.miniatura + '">' : '<div class="vazio">novo</div>') +
          '</div>' +
          '<div class="row2"><button class="act" data-tipo="template" data-id="' + t.template_id + '" data-acao="aprovar">Aprovar</button>' +
          '<button class="act danger" data-tipo="template" data-id="' + t.template_id + '" data-acao="rejeitar">Rejeitar</button></div></div>';
      }).join('') +
      ms.map(m => {
        const p = (this.dados.pessoas || []).find(x => x.pessoa_id === m.pessoa_id) || {};
        const motivos = [];
        if (m.origem === 'manual') motivos.push('registro manual');
        if (m.veredito === 'revisar') motivos.push('zona cinzenta');
        if (p.papel === 'gestor') motivos.push('ponto do próprio gestor');
        if (Math.abs(Number(m.deriva_relogio_ms) || 0) > 120000) motivos.push('relógio divergente');
        return '<div class="pend"><div class="top"><div style="flex:1">' +
          '<div class="nm"><b>' + esc(p.nome || m.pessoa_id) + '</b> · ' +
            (m.tipo === 'entrada' ? 'entrada' : 'saída') + ' ' + hora(m.marcado_em) + '</div>' +
          '<div class="mt">' + esc(this.nomeEquipe(m.equipe_id)) + ' · ' + motivos.join(' · ') +
            (m.motivo ? ' · "' + esc(m.motivo) + '"' : '') + '</div>' +
          '</div></div>' +
          '<div class="fotos">' +
            (p.miniatura ? '<img src="' + p.miniatura + '">' : '<div class="vazio">cadastro</div>') +
            (m.foto_auditoria ? '<img src="' + m.foto_auditoria + '">' : '<div class="vazio">sem foto</div>') +
          '</div>' +
          '<div class="row2"><button class="act" data-tipo="marcacao" data-id="' + m.id_cliente + '" data-acao="aprovar">Aprovar</button>' +
          '<button class="act danger" data-tipo="marcacao" data-id="' + m.id_cliente + '" data-acao="rejeitar">Rejeitar</button></div></div>';
      }).join('');

    el.querySelectorAll('button[data-acao]').forEach(b => {
      b.onclick = async () => {
        b.disabled = true;
        const r = await ApiRh.decidir(this.cred, {
          tipo: b.dataset.tipo, id: b.dataset.id, acao: b.dataset.acao, motivo: ''
        });
        if (!r.ok) { toast(r.erro || 'Falha', 'bad'); b.disabled = false; return; }
        toast('Decidido', 'ok');
        await this.recarregar();
      };
    });
  },

  /* ---------------------------------------------------- colaboradores */

  pintarPessoas() {
    const eqs = this.dados.equipes || [];
    const lista = (this.dados.pessoas || []).slice().sort((a, b) => a.nome.localeCompare(b.nome));
    $('rh-pessoas').innerHTML =
      '<div class="card"><h2>Novo colaborador</h2>' +
        '<label class="lb">Nome</label><input type="text" id="pNome">' +
        '<label class="lb">Matrícula</label><input type="text" id="pMat">' +
        '<label class="lb">Equipe</label><select id="pEquipe">' +
          eqs.map(e => '<option value="' + e.equipe_id + '">' + esc(e.nome) + '</option>').join('') + '</select>' +
        '<label class="lb">Papel</label><select id="pPapel">' +
          '<option value="colaborador">Colaborador</option><option value="gestor">Gestor</option></select>' +
        '<button class="act" id="btnNovaPessoa">Salvar</button></div>' +
      '<div class="card"><h2>Cadastrados <span class="nota">— ' + lista.length + '</span></h2>' +
        lista.map(p =>
          '<div class="linha-item">' +
          (p.miniatura ? '<img src="' + p.miniatura + '">' : '<span class="ponto ' + (p.ativo ? 'muted' : 'bad') + '"></span>') +
          '<div style="flex:1"><div class="nm">' + esc(p.nome) +
            (p.papel === 'gestor' ? ' <span class="tag">gestor</span>' : '') +
            (p.ativo ? '' : ' <span class="tag">inativo</span>') + '</div>' +
          '<div class="mt">' + esc(p.matricula) + ' · ' + esc(this.nomeEquipe(p.equipe_id)) +
            (p.tem_biometria ? '' : ' · <span class="warnfg">sem biometria</span>') + '</div></div>' +
          '<button class="act ghost" style="width:auto;margin:0;padding:9px 12px;font-size:12px" data-bio="' + p.pessoa_id + '">' +
            (p.tem_biometria ? 'Refazer' : 'Biometria') + '</button>' +
          '</div>').join('') +
      '</div>' +
      '<div id="areaBio"></div>';

    $('btnNovaPessoa').onclick = async () => {
      const r = await ApiRh.colaborador(this.cred, {
        nome: $('pNome').value.trim(), matricula: $('pMat').value.trim(),
        equipe_id: $('pEquipe').value, papel: $('pPapel').value
      });
      if (!r.ok) { toast(r.erro || 'Falha', 'bad'); return; }
      toast('Colaborador salvo', 'ok');
      await this.recarregar();
    };
    $('rh-pessoas').querySelectorAll('button[data-bio]').forEach(b => {
      b.onclick = () => this.abrirBiometria(b.dataset.bio);
    });
  },

  async abrirBiometria(pessoaId) {
    const p = (this.dados.pessoas || []).find(x => x.pessoa_id === pessoaId);
    if (!p) return;
    this.alvoCadastro = p;
    this.capturas = [];
    $('areaBio').innerHTML =
      '<div class="card"><h2>Biometria de ' + esc(p.nome) + '</h2>' +
        '<div class="camwrap" style="aspect-ratio:1/1">' +
          '<video id="videoCad" playsinline muted autoplay></video>' +
          '<div class="camoff" id="camOffCad">A câmera liga na primeira captura</div>' +
        '</div>' +
        '<div class="shots" id="cadShots"></div>' +
        '<button class="act ghost" id="btnCapCad">Capturar 1/3</button>' +
        '<button class="act" id="btnSalvarBio" disabled>Salvar biometria</button>' +
        '<button class="act ghost" id="btnFecharBio">Fechar</button>' +
        '<p class="nota" style="margin-top:10px">Sem boné, óculos escuros ou máscara. Mova um pouco a cabeça entre as capturas.</p>' +
      '</div>';
    this.pintarShots();
    $('btnCapCad').onclick = () => this.capturarCadastro();
    $('btnSalvarBio').onclick = () => this.salvarBiometria();
    $('btnFecharBio').onclick = () => { this.pararCamCad(); $('areaBio').innerHTML = ''; };
    $('areaBio').scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  pintarShots() {
    $('cadShots').innerHTML = [0, 1, 2].map(i =>
      this.capturas[i] ? '<div><img src="' + this.capturas[i].thumb + '"></div>' : '<div>' + (i + 1) + '</div>').join('');
    $('btnSalvarBio').disabled = this.capturas.length < 3;
    $('btnCapCad').textContent = this.capturas.length < 3 ? 'Capturar ' + (this.capturas.length + 1) + '/3' : 'Completo';
  },

  async ligarCamCad() {
    if (this._camCad) return true;
    try {
      this._camCad = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      $('videoCad').srcObject = this._camCad;
      await $('videoCad').play();
      $('camOffCad').classList.add('hide');
      return true;
    } catch (e) { toast('Sem acesso à câmera', 'bad'); return false; }
  },

  pararCamCad() {
    if (this._camCad) { this._camCad.getTracks().forEach(t => t.stop()); this._camCad = null; }
  },

  async capturarCadastro() {
    if (!(await this.ligarCamCad())) return;
    $('btnCapCad').disabled = true;
    try {
      const r = await Face.capturar($('videoCad'));
      if (!r) { toast('Nenhum rosto — tire óculos escuros ou máscara', 'warn'); return; }
      if (r.reprovado) { toast('Qualidade insuficiente: ' + r.qualidade.msg, 'warn'); return; }
      this.capturas.push(r);
      this.pintarShots();
    } finally { $('btnCapCad').disabled = false; }
  },

  async salvarBiometria() {
    const c = this.capturas;
    const coer = Math.max(
      euclidiana(c[0].descritor, c[1].descritor),
      euclidiana(c[0].descritor, c[2].descritor),
      euclidiana(c[1].descritor, c[2].descritor));
    if (coer > 0.55 && !confirm('As 3 capturas estão pouco parecidas entre si (' + coer.toFixed(3) +
      ').\n\nIsso costuma virar falso negativo depois. Salvar assim mesmo?')) return;
    $('btnSalvarBio').disabled = true;
    const p = this.alvoCadastro;
    const r = await ApiRh.colaborador(this.cred, {
      pessoa_id: p.pessoa_id, nome: p.nome, matricula: p.matricula,
      equipe_id: p.equipe_id, papel: p.papel
    });
    if (!r.ok) { toast(r.erro || 'Falha', 'bad'); $('btnSalvarBio').disabled = false; return; }
    const bio = await fetch(window.EFRAT_CFG.apiBase + '/efrat/cadastro', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: this._tokenAparelho, origem: 'rh', pessoa_id: p.pessoa_id,
        nome: p.nome, matricula: p.matricula, equipe_id: p.equipe_id,
        vetores: c.map(x => x.descritor), miniatura: c[0].thumb, coerencia: Number(coer.toFixed(4))
      })
    }).then(x => x.json()).catch(() => null);
    $('btnSalvarBio').disabled = false;
    if (!bio || !bio.ok) { toast((bio && bio.erro) || 'Falha ao gravar biometria', 'bad'); return; }
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
      const r = await ApiRh.equipe(this.cred, {
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
      '<div class="card"><h2>Espelho de ponto</h2>' +
        '<label class="lb">Colaborador</label><select id="regPessoa">' +
          pessoas.map(p => '<option value="' + p.pessoa_id + '">' + esc(p.nome) + '</option>').join('') +
        '</select><div id="regSaida"></div></div>';
    const desenhar = () => {
      const id = $('regPessoa').value;
      const linhas = espelho(this.dados.marcacoes, id);
      $('regSaida').innerHTML = linhas.length
        ? linhas.map(l => '<div class="esp"><span class="d">' + data(l.dia) + '</span><span>' +
            l.marcacoes.map(m => (m.tipo === 'entrada' ? 'E ' : 'S ') + hora(m.marcado_em) +
              (m.origem === 'manual' ? ' <span class="tag">manual</span>' : '') +
              (m.pendente ? ' <span class="tag">pendente</span>' : '')).join(' · ') +
            '</span></div>').join('')
        : '<p class="nota" style="margin-top:10px">Sem marcações no período.</p>';
    };
    $('regPessoa').onchange = desenhar;
    if (pessoas.length) desenhar();
  }
};
