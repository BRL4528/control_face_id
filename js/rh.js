// Painel do RH. Tudo que é administração vive aqui e em lugar nenhum mais.
import { Api, ApiRh } from './api.js';
import { Face } from './face.js';
import { derivar } from './cripto.js';
import {
  indicadores, espelho,
  presencaPorEquipe, serieDiaria, pendenciasPorMotivo, retidasPorAparelho
} from './regras.js';
import { $, esc, mostrar, toast, hora, data } from './ui.js';

export const Rh = {
  cred: null,
  dados: null,
  aba: 'painel',
  aoSair: null,
  capturas: [],
  alvoCadastro: null,
  pessoaAberta: null,   // T-8188C6: ficha da pessoa aberta na aba Colaboradores
  equipeAberta: null,   // T-8188C6: detalhe da equipe aberto na aba Equipes
  dias: 30,          // período ativo do painel (7 / 30 / 90)
  _charts: [],       // instâncias Chart.js vivas, destruídas ao repintar
  _Chart: null,      // biblioteca carregada sob demanda
  _pollAparelhos: null,  // T-C20AD3: refresh próprio da aba Aparelhos (§1.2)

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
    $('btnSairRh').onclick = () => {
      this.destruirGraficos(); clearTimeout(this._pollAparelhos);
      this.cred = null; this.dados = null;
      this.pessoaAberta = null; this.equipeAberta = null;
      this.aoSair();
    };
    this.pintar();
  },

  /** Chart.js vaza canvas se repintado sem destruir a instância anterior. */
  destruirGraficos() {
    for (const c of this._charts) { try { c.destroy(); } catch (e) { /* já morto */ } }
    this._charts = [];
  },

  pintar() {
    this.destruirGraficos();   // troca de aba mata os gráficos da anterior
    clearTimeout(this._pollAparelhos);   // idem pro refresh próprio da aba Aparelhos
    $('rhPeriodo').textContent = 'últimos ' + (this.dados.periodo_dias || this.dias) + ' dias';
    document.querySelectorAll('#rh nav button').forEach(b => b.classList.toggle('on', b.dataset.aba === this.aba));
    ['painel', 'aparelhos', 'pendencias', 'pessoas', 'equipes', 'registros'].forEach(a =>
      $('rh-' + a).classList.toggle('hide', a !== this.aba));
    if (this.aba === 'painel') this.pintarPainel();
    if (this.aba === 'aparelhos') this.pintarAparelhos();
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

  /* ----------------------------------------------------- aparelhos */

  // T-87615C: aba que destrava o resto — sem ela, o aparelho gera identidade
  // própria e fica preso em "Aguardando liberação do RH" pra sempre, porque
  // não existia rota nem tela onde o RH liberasse (docs/fase3-rh-pessoas.md § A).
  //
  // Liberar exige DIGITAR o código que a tela do aparelho mostra — não um
  // clique em item de lista. É a prova de posse física do ADR (docs/adr-
  // acesso-v3.md): por isso o código nunca aparece em nenhuma leitura do RH
  // (nem no card do pendente, nem na rede — servidor-falso.js não devolve
  // codigo_curto pro RH), e o campo é texto livre, sem datalist/autocomplete,
  // senão o navegador reconstrói a lista que acabou de ser escondida.
  /**
   * T-C20AD3 (§1.2): a aba tem leitura própria (/efrat/rh/aparelhos) — muda
   * enquanto o RH olha, e recarregar o painel inteiro (marcações, pessoas,
   * equipes) a cada refresh por causa de 3 linhas seria desperdício. Por
   * isso tem poll próprio (`_pollAparelhos`), igual ao poll de estado do
   * aparelho em app.js: reagenda a si mesmo, e para sozinho quando a aba
   * troca ou o RH sai (ver `pintar()`/`btnSairRh`).
   */
  async pintarAparelhos() {
    clearTimeout(this._pollAparelhos);
    const r = await ApiRh.aparelhos(this.cred);
    if (!r.ok) { toast(r.erro || 'Falha ao carregar aparelhos', 'bad'); return; }
    const { pendentes, ativos, encerrados } = r.dados;
    const el = $('rh-aparelhos');

    // pendentes[] não tem dispositivo_id (§1.1 regra 2 — defesa em
    // profundidade: a lista de pendentes não carrega nenhum identificador
    // que outra rota aceite como alvo de ativação). Recusar resolve por
    // pendente_id.
    const linhaPendente = d => '<div class="linha-item"><span class="ponto muted"></span>' +
      '<div style="flex:1"><div class="nm">' + esc(d.apelido_declarado || '(sem nome)') + '</div>' +
      '<div class="mt">pedindo liberação desde ' + data(String(d.primeiro_pedido_em).slice(0, 10)) + '</div></div>' +
      '<button class="act ghost" style="width:auto;margin:0;padding:9px 12px;font-size:12px" data-pendente="' + esc(d.pendente_id) + '">Recusar</button>' +
      '</div>';
    const linhaAtivo = d => '<div class="linha-item"><span class="ponto ok"></span>' +
      '<div style="flex:1"><div class="nm">' + esc(d.apelido || d.dispositivo_id) + '</div>' +
      '<div class="mt">' + esc(d.unidade || '—') + ' · último uso ' +
        (d.ultimo_uso_em ? (data(d.ultimo_uso_em.slice(0, 10)) + ' ' + hora(d.ultimo_uso_em)) : 'ainda não usou') + '</div></div>' +
      '<button class="act ghost" style="width:auto;margin:0;padding:9px 12px;font-size:12px" data-revogar="' + esc(d.dispositivo_id) + '" data-apelido="' + esc(d.apelido || d.dispositivo_id) + '">Revogar</button>' +
      '</div>';
    const linhaEncerrado = d => '<div class="linha-item"><span class="ponto muted"></span>' +
      '<div style="flex:1"><div class="nm">' + esc(d.apelido || d.dispositivo_id) + '</div>' +
      '<div class="mt">' + (d.estado === 'revogado' ? 'revogado' : 'recusado') +
        (d.por ? (' por ' + esc(d.por)) : '') + (d.em ? (' em ' + data(String(d.em).slice(0, 10))) : '') + '</div></div>' +
      '</div>';

    el.innerHTML =
      '<div class="card"><h2>Liberar aparelho</h2>' +
        '<p class="nota" style="margin:0 0 10px">Peça para a pessoa mostrar o código na tela do aparelho e digite aqui — é a prova de que você está diante do aparelho certo.</p>' +
        '<label class="lb">Código do aparelho</label>' +
        '<input type="text" id="aparelhoCodigo" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="6" style="text-transform:uppercase">' +
        '<button class="act" id="btnLiberarAparelho">Liberar</button>' +
        '<div id="aparelhoLiberarConf"></div>' +
      '</div>' +
      '<div class="card"><h2>Pedindo liberação <span class="nota">— ' + pendentes.length + '</span></h2>' +
        '<div id="aparelhoPendentesLista">' +
          (pendentes.length ? pendentes.map(linhaPendente).join('') : '<p class="nota">Nada esperando decisão.</p>') +
        '</div>' +
      '</div>' +
      '<div class="card"><h2>Liberados <span class="nota">— ' + ativos.length + '</span></h2>' +
        '<div id="aparelhoAtivosLista">' +
          (ativos.length ? ativos.map(linhaAtivo).join('') : '<p class="nota">Nenhum aparelho liberado ainda.</p>') +
        '</div>' +
        '<div id="aparelhoRevogarConf"></div>' +
      '</div>' +
      // §1.2: 30 dias de histórico auditável — recusado/revogado não some da
      // tela, só sai da lista ACIONÁVEL (pendentes/ativos) e vira linha
      // read-only aqui, sem botão nenhum.
      (encerrados.length
        ? '<div class="card"><h2>Encerrados <span class="nota">— últimos 30 dias</span></h2>' + encerrados.map(linhaEncerrado).join('') + '</div>'
        : '');

    $('btnLiberarAparelho').onclick = () => {
      const codigo = $('aparelhoCodigo').value.trim();
      if (!codigo) { toast('Digite o código mostrado no aparelho', 'warn'); return; }
      this.confirmarLiberarAparelho(codigo);
    };

    // Recusar não exige código nem confirmação (§1.4: "errar uma recusa não
    // dá acesso a ninguém"). Revogar e liberar são ações de mais peso — cada
    // uma tem sua confirmação própria com equipes/texto do contrato.
    el.querySelectorAll('button[data-pendente]').forEach(b => {
      b.onclick = async () => {
        b.disabled = true;
        const pendenteId = b.dataset.pendente;
        const rr = await ApiRh.aparelhoRecusar(this.cred, {
          pendente_id: pendenteId, idempotency_key: 'recusar-' + pendenteId
        });
        if (!rr.ok) { toast(rr.erro || 'Falha', 'bad'); b.disabled = false; return; }
        toast('Aparelho recusado', 'ok');
        await this.pintarAparelhos();
      };
    });
    el.querySelectorAll('button[data-revogar]').forEach(b => {
      b.onclick = () => this.confirmarRevogarAparelho(b.dataset.revogar, b.dataset.apelido);
    });

    if (this.aba === 'aparelhos') {
      this._pollAparelhos = setTimeout(() => this.pintarAparelhos(), 15000);
    }
  },

  /**
   * Tela de escopo do contrato (§1.3), texto fechado com o Designer:
   * cabeçalho e linha de apoio ao pé da letra, e SEM botão "selecionar
   * todas" — é o que impede um aparelho perdido de expor a empresa inteira
   * (Cenário 3, ameacas-v3.md). `equipes_ids` é obrigatório no corpo de
   * /aparelho/aprovar; até esta tela existir, aprovar liberava para TODAS
   * as equipes ativas sozinho, sem o RH escolher nada.
   */
  confirmarLiberarAparelho(codigo) {
    const equipesAtivas = (this.dados.equipes || []).filter(e => e.ativo);
    const linhaEquipe = e => '<label class="linha-item" style="cursor:pointer">' +
      '<input type="checkbox" value="' + esc(e.equipe_id) + '" style="width:auto;flex:0;margin:0 10px 0 0">' +
      '<span style="flex:1">' + esc(e.nome) + '<span class="nota"> · ' + esc(e.unidade || '') + '</span></span>' +
      '</label>';
    $('aparelhoLiberarConf').innerHTML =
      '<div class="card" style="margin-top:12px">' +
        '<h2>Quem bate ponto neste aparelho?</h2>' +
        '<p class="nota" style="margin:0 0 10px">Marque as equipes que trabalham neste local. Só quem estiver ' +
          'marcado aqui é reconhecido por este aparelho — se ele for perdido ou roubado, é só isso que fica exposto.</p>' +
        (equipesAtivas.length ? equipesAtivas.map(linhaEquipe).join('') : '<p class="nota">Nenhuma equipe ativa cadastrada.</p>') +
        '<div class="row2">' +
          '<button class="act" id="btnConfirmarLiberar">Liberar</button>' +
          '<button class="act ghost" id="btnCancelarLiberar">Cancelar</button>' +
        '</div>' +
      '</div>';
    $('btnCancelarLiberar').onclick = () => { $('aparelhoLiberarConf').innerHTML = ''; };
    $('btnConfirmarLiberar').onclick = async () => {
      const equipesIds = [...$('aparelhoLiberarConf').querySelectorAll('input[type=checkbox]:checked')].map(i => i.value);
      if (!equipesIds.length) { toast('Selecione ao menos uma equipe antes de liberar o aparelho.', 'warn'); return; }
      $('btnConfirmarLiberar').disabled = true;
      const r = await ApiRh.aparelhoAprovar(this.cred, {
        codigo, equipes_ids: equipesIds,
        idempotency_key: 'aprovar-' + codigo + '-' + equipesIds.slice().sort().join(',')
      });
      $('btnConfirmarLiberar').disabled = false;
      if (!r.ok) { toast(r.erro || 'Código inválido', 'bad'); return; }
      toast('Aparelho liberado', 'ok');
      $('aparelhoCodigo').value = '';
      await this.pintarAparelhos();
    };
  },

  /**
   * Confirmação de revogar — texto fechado no contrato (§1.6): revogar não
   * apaga ponto não enviado, ele ainda chega e vira pendência pro RH. Sem
   * confirm() nativo (T-4B538E/T-8ADD9C já tiraram os últimos): mesmo padrão
   * inline de pedirAutorizacaoTelefone, motivo opcional porque §1.5 não exige.
   */
  confirmarRevogarAparelho(dispositivoId, apelido) {
    $('aparelhoRevogarConf').innerHTML =
      '<div class="card" style="margin-top:12px;border-color:var(--ambar)">' +
        '<p class="nota" style="margin:0 0 10px"><b>Revogar ' + esc(apelido) + '?</b> Se este aparelho tiver ponto ' +
          'não enviado, ele ainda entrega — e cada marcação vai cair na sua mesa para conferência, com a hora da ' +
          'batida e a hora em que chegou.</p>' +
        '<label class="lb">Por quê? (opcional)</label>' +
        '<input type="text" id="revogarMotivo" placeholder="ex.: aparelho extraviado">' +
        '<div class="row2">' +
          '<button class="act danger" id="btnConfirmarRevogar">Confirmar revogação</button>' +
          '<button class="act ghost" id="btnCancelarRevogar">Cancelar</button>' +
        '</div>' +
      '</div>';
    $('btnCancelarRevogar').onclick = () => { $('aparelhoRevogarConf').innerHTML = ''; };
    $('btnConfirmarRevogar').onclick = async () => {
      $('btnConfirmarRevogar').disabled = true;
      const r = await ApiRh.aparelhoRevogar(this.cred, {
        dispositivo_id: dispositivoId, motivo: $('revogarMotivo').value.trim(),
        idempotency_key: 'revogar-' + dispositivoId
      });
      if (!r.ok) { toast(r.erro || 'Falha', 'bad'); $('btnConfirmarRevogar').disabled = false; return; }
      toast('Aparelho revogado', 'ok');
      await this.pintarAparelhos();
    };
  },

  /* ----------------------------------------------------- pendências */

  /**
   * Recadastro (substituição ou primeiro cadastro de biometria) nunca ganha
   * ação em lote e nunca fica pronto pra aprovar sem o RH marcar que olhou —
   * é a defesa contra o cenário que o QA descreveu: RH com dezenas de
   * pendentes aprova em lote sem olhar, e destrói sozinho a defesa que a
   * fila existe pra sustentar (docs/fase3-seguranca.md §1.7b/1.7c).
   */
  pintarPendencias() {
    const ms = (this.dados.marcacoes || []).filter(m => m.pendente)
      .sort((a, b) => String(b.marcado_em).localeCompare(String(a.marcado_em)));
    const rc = this.dados.recadastros || [];
    const el = $('rh-pendencias');
    if (!ms.length && !rc.length) {
      el.innerHTML = '<div class="card"><p class="nota">Nada esperando decisão. 🎉</p></div>';
      return;
    }

    // T-D00CE0 (§1.6 do contrato): marcação retida por aparelho revogado sai
    // da lista normal de pendências e vira card agrupado por aparelho — sem
    // a contagem visível o RH não percebe inflação da fila mesmo quando cada
    // linha isolada parece plausível. Pessoa inativa é problema de PESSOA,
    // não de aparelho: continua na lista normal, um item por vez.
    const msAparelho = ms.filter(m => m.motivo_codigo === 'aparelho_revogado');
    const msIndividuais = ms.filter(m => m.motivo_codigo !== 'aparelho_revogado');
    const gruposAparelho = retidasPorAparelho(msAparelho);

    const pessoaDe = t => (this.dados.pessoas || []).find(x => x.pessoa_id === t.pessoa_id) || {};
    // Sem miniatura/biometria anterior == primeiro cadastro; com == substituição
    // de um rosto já em uso. As duas nunca aparecem numa lista uniforme.
    const substituicoes = rc.filter(t => pessoaDe(t).tem_biometria);
    const primeiroCadastro = rc.filter(t => !pessoaDe(t).tem_biometria);
    // Contagem do dia só quando o servidor manda `criado_em`; sem essa data
    // ainda no contrato, mostra o total corrente em vez de fingir precisão.
    const hoje = this.hojeServidor();
    const temData = rc.some(t => t.criado_em);
    const doDia = temData ? rc.filter(t => String(t.criado_em).slice(0, 10) === hoje) : rc;

    const cartaoFace = (t, ehSubstituicao) => {
      const p = pessoaDe(t);
      // T-89E18B: os DOIS caminhos sem ninguém do RH acompanhando a captura
      // precisam do aviso — link (celular do colaborador) E upload (a foto já
      // existe pronta, é o caminho mais fácil pra foto-de-foto, e é o que o RH
      // usa justamente quando o colaborador está longe — menos como saber de
      // onde a imagem veio). Só rh_camera tem RH presente na captura; essa não avisa.
      const semSupervisao = t.origem === 'link' ? 'link' : (t.origem === 'rh_upload' ? 'upload' : null);
      const gate = 'gate-' + t.template_id;
      return '<div class="pend pendface">' +
        '<div class="top"><div style="flex:1">' +
          '<div class="nm"><b>' + (ehSubstituicao ? 'Substituição de biometria' : 'Primeiro cadastro') +
            '</b> · ' + esc(p.nome || t.pessoa_id) + '</div>' +
          // Coerência sai da TELA como decimal (correção do Orquestrador) E
          // sem virar sinal nenhum no lugar: a faixa aceita (abaixo de 0,45) é
          // ocupada por variação legítima de adorno — boné 0,169, capuz 0,253,
          // capacete de obra 0,257, óculos escuros 0,422, máscara 0,440, todas
          // de MESMA pessoa contra template limpo (README). Num cliente de
          // engenharia, onde capacete é o normal, um corte dentro dessa faixa
          // acenderia no caso comum — aviso que acende sempre treina o RH a
          // ignorar. Não há corte que preste; por isso não é número nem
          // booleano, é ausência mesmo. Continua persistido e devolvido nas
          // rotas de escrita, para auditoria e recalibração (T-8ADD9C).
          '<div class="mt">versão ' + t.versao +
            (semSupervisao === 'link' ? ' · <span class="tag">via link do celular</span>' : '') +
            (semSupervisao === 'upload' ? ' · <span class="tag">via upload de fotos</span>' : '') + '</div>' +
        '</div></div>' +
        '<div class="fotos">' +
          (ehSubstituicao
            ? (p.miniatura ? '<img src="' + p.miniatura + '">' : '<div class="vazio">atual</div>')
            : '') +
          (t.miniatura ? '<img src="' + t.miniatura + '">' : '<div class="vazio">novo</div>') +
        '</div>' +
        (semSupervisao === 'link' ? '<p class="nota aviso">Confira se é a pessoa certa. Este cadastro veio pelo celular do ' +
          'colaborador e ninguém do RH acompanhou a captura.</p>' : '') +
        // Texto fechado com o Designer (750f40fef8, T-89E18B): mesma unidade
        // estrutural do texto de "via link" — "este cadastro" (evento único),
        // fecha igual em "ninguém do RH acompanhou a captura".
        (semSupervisao === 'upload' ? '<p class="nota aviso">Confira se é a pessoa certa. Este cadastro veio de ' +
          'arquivos já prontos, e ninguém do RH acompanhou a captura.</p>' : '') +
        '<label class="lb gate"><input type="checkbox" id="' + gate + '"> ' +
          (ehSubstituicao ? 'Comparei as duas fotos: é a mesma pessoa.' : 'Conferi a foto: é a pessoa certa.') +
        '</label>' +
        '<div class="row2">' +
          '<button class="act" disabled data-tipo="template" data-id="' + t.template_id + '" data-gate="' + gate + '" data-acao="aprovar">Aprovar</button>' +
          '<button class="act danger" data-tipo="template" data-id="' + t.template_id + '" data-acao="rejeitar">Rejeitar</button>' +
        '</div></div>';
    };

    el.innerHTML =
      (rc.length ? '<p class="nota contagem">' + doDia.length + ' cadastro(s) de face pendente' +
        (doDia.length === 1 ? '' : 's') + (temData ? ' hoje' : '') + '</p>' : '') +
      (substituicoes.length
        ? '<h3 class="secaopend">Substituição de biometria <span class="nota">— ' + substituicoes.length + '</span></h3>' +
          substituicoes.map(t => cartaoFace(t, true)).join('')
        : '') +
      (primeiroCadastro.length
        ? '<h3 class="secaopend">Primeiro cadastro <span class="nota">— ' + primeiroCadastro.length + '</span></h3>' +
          primeiroCadastro.map(t => cartaoFace(t, false)).join('')
        : '') +
      (gruposAparelho.length
        ? '<h3 class="secaopend">Aparelho revogado <span class="nota">— ' + gruposAparelho.length + '</span></h3>' +
          gruposAparelho.map(g => this.cardGrupoAparelho(g)).join('')
        : '') +
      msIndividuais.map(m => this.cartaoMarcacao(m)).join('');

    // O checkbox de conferência é dono do habilitar/desabilitar do próprio
    // "Aprovar" — nunca dos outros cards, e nunca de um "aprovar todos".
    el.querySelectorAll('input[type=checkbox][id^="gate-"]').forEach(cb => {
      cb.onchange = () => {
        el.querySelectorAll('button[data-gate="' + cb.id + '"]').forEach(b => { b.disabled = !cb.checked; });
      };
    });

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

    // T-D00CE0: "RH decide em bloco ou uma por uma" (§1.6) — o bloco chama a
    // MESMA rota /rh/decidir, um item de cada vez, em sequência; não é uma
    // rota nova de lote, é o mesmo caminho individual repetido.
    el.querySelectorAll('button[data-grupo]').forEach(b => {
      b.onclick = async () => {
        const grupo = gruposAparelho.find(g => g.dispositivo_id === b.dataset.grupo);
        if (!grupo) return;
        b.disabled = true;
        let falhas = 0;
        for (const m of grupo.itens) {
          const r = await ApiRh.decidir(this.cred, {
            tipo: 'marcacao', id: m.id_cliente, acao: b.dataset.grupoAcao, motivo: ''
          });
          if (!r.ok) falhas++;
        }
        if (falhas) toast(falhas + ' de ' + grupo.itens.length + ' não puderam ser decididas', 'bad');
        else toast(grupo.itens.length + ' marcações decididas', 'ok');
        await this.recarregar();
      };
    });
  },

  /** Card de uma marcação pendente, individual — usado na lista normal e
   * dentro do "ver uma por uma" de um grupo de aparelho revogado. */
  cartaoMarcacao(m) {
    const p = (this.dados.pessoas || []).find(x => x.pessoa_id === m.pessoa_id) || {};
    const motivos = [];
    if (m.origem === 'manual') motivos.push('registro manual');
    if (m.veredito === 'revisar') motivos.push('zona cinzenta');
    if (p.papel === 'gestor') motivos.push('ponto do próprio gestor');
    if (Math.abs(Number(m.deriva_relogio_ms) || 0) > 120000) motivos.push('relógio divergente');
    // T-D00CE0: motivo_codigo é o que /efrat/marcacoes manda pronto pra
    // marcação retida (§1.6/§3.3) — o cliente só escolhe a frase pelo
    // código, nunca reconstrói o motivo a partir de outros campos.
    if (m.motivo_codigo === 'pessoa_inativa_no_envio') motivos.push('colaborador foi inativado depois desta marcação');
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
  },

  /** Card agrupado de marcações retidas por UM aparelho revogado — contagem
   * e faixa de horário visíveis, decisão em bloco ou uma por uma (§1.6). */
  cardGrupoAparelho(g) {
    const dataDe = iso => iso ? data(String(iso).slice(0, 10)) + ' ' + hora(iso) : '—';
    return '<div class="pend"><div class="top"><div style="flex:1">' +
        '<div class="nm"><b>' + esc(g.apelido) + '</b> · aparelho revogado</div>' +
        '<div class="mt">revogado em ' + dataDe(g.revogado_em) + ' · <b>' + g.total +
          '</b> marcaç' + (g.total === 1 ? 'ão recebida' : 'ões recebidas') +
          (g.recebido_max ? ' até ' + dataDe(g.recebido_max) : '') +
          ', batidas entre ' + dataDe(g.batida_min) + ' e ' + dataDe(g.batida_max) + '</div>' +
      '</div></div>' +
      '<div class="row2">' +
        '<button class="act" data-grupo="' + esc(g.dispositivo_id) + '" data-grupo-acao="aprovar">Aprovar todas</button>' +
        '<button class="act danger" data-grupo="' + esc(g.dispositivo_id) + '" data-grupo-acao="rejeitar">Rejeitar todas</button>' +
      '</div>' +
      '<details style="margin-top:10px"><summary class="nota" style="cursor:pointer">Ver uma por uma</summary>' +
        g.itens.map(m => this.cartaoMarcacao(m)).join('') +
      '</details>' +
    '</div>';
  },

  /* ---------------------------------------------------- colaboradores */

  // T-8188C6: linha da lista é um botão só (mesmo padrão de .linha-item que
  // a aba Aparelhos já usa) — abre a ficha da pessoa, onde vivem edição,
  // inativar/reativar e biometria juntos. Sem nada clicável dentro de
  // clicável: nunca dá pra aninhar <button>.
  linhaPessoa(p) {
    return '<button type="button" class="linha-item" data-pessoa="' + p.pessoa_id + '">' +
      (p.miniatura ? '<img src="' + p.miniatura + '">' : '<span class="ponto ' + (p.ativo ? 'muted' : 'bad') + '"></span>') +
      '<div style="flex:1;text-align:left"><div class="nm">' + esc(p.nome) +
        (p.papel === 'gestor' ? ' <span class="tag">gestor</span>' : '') +
        (p.ativo ? '' : ' <span class="tag">inativo</span>') +
        (p.telefone_compartilhado ? ' <span class="tag">telefone compartilhado</span>' : '') + '</div>' +
      '<div class="mt">' + esc(p.matricula) + ' · ' + esc(this.nomeEquipe(p.equipe_id)) +
        (p.tem_biometria ? '' : ' · <span class="warnfg">sem biometria</span>') + '</div></div>' +
      '</button>';
  },

  pintarPessoas() {
    if (this.pessoaAberta) return this.pintarPessoaDetalhe();
    const eqs = (this.dados.equipes || []).filter(e => e.ativo);
    const lista = (this.dados.pessoas || []).slice().sort((a, b) => a.nome.localeCompare(b.nome));
    $('rh-pessoas').innerHTML =
      '<div class="card"><h2>Novo colaborador</h2>' +
        '<label class="lb">Nome</label><input type="text" id="pNome">' +
        '<label class="lb">Matrícula</label><input type="text" id="pMat">' +
        '<label class="lb">Telefone (celular)</label><input type="text" id="pTelefone" placeholder="(67) 99876-5432">' +
        '<label class="lb">Equipe</label><select id="pEquipe"><option value="">Sem equipe</option>' +
          eqs.map(e => '<option value="' + e.equipe_id + '">' + esc(e.nome) + '</option>').join('') + '</select>' +
        '<label class="lb">Papel</label><select id="pPapel">' +
          '<option value="colaborador">Colaborador</option><option value="gestor">Gestor</option></select>' +
        '<button class="act" id="btnNovaPessoa">Salvar</button>' +
        '<div id="pConflito"></div>' +
      '</div>' +
      '<div class="card"><h2>Cadastrados <span class="nota">— ' + lista.length + '</span></h2>' +
        lista.map(p => this.linhaPessoa(p)).join('') +
      '</div>';

    $('btnNovaPessoa').onclick = () => this.criarPessoa();
    $('rh-pessoas').querySelectorAll('button[data-pessoa]').forEach(b => {
      b.onclick = () => { this.pessoaAberta = b.dataset.pessoa; this.pintar(); };
    });
  },

  async criarPessoa(autorizacao) {
    const dados = Object.assign({
      nome: $('pNome').value.trim(), matricula: $('pMat').value.trim(),
      telefone: $('pTelefone').value.trim(),
      equipe_id: $('pEquipe').value || null, papel: $('pPapel').value
    }, autorizacao || {});
    $('btnNovaPessoa').disabled = true;
    const r = await ApiRh.colaborador(this.cred, dados);
    $('btnNovaPessoa').disabled = false;
    if (!r.ok) {
      if (r.codigo === 'TELEFONE_DUPLICADO') { this.pedirAutorizacaoTelefone('pConflito', r, a => this.criarPessoa(Object.assign({}, dados, a))); return; }
      toast(r.erro || 'Falha', 'bad');
      return;
    }
    $('pConflito').innerHTML = '';
    toast('Colaborador salvo', 'ok');
    await this.recarregar();
  },

  /**
   * Diálogo de autorização de telefone duplicado (§3.1, texto fechado com o
   * Designer): nomeia quem já usa o número, exige motivo de 10-200
   * caracteres, botão só destrava com 10+. `aoConfirmar(autorizacao)` recebe
   * `{ autorizar_telefone_duplicado: true, motivo_telefone_duplicado }`.
   */
  pedirAutorizacaoTelefone(elId, respostaErro, aoConfirmar) {
    const nome = respostaErro.detalhe && respostaErro.detalhe.nome;
    $(elId).innerHTML =
      '<div class="card" style="margin-top:12px;border-color:var(--ambar)">' +
        '<p class="nota" style="margin:0 0 10px">Autorizando, esta pessoa fica cadastrada com o mesmo celular de <b>' +
          esc(nome || 'outra pessoa') + '</b> — e não vai poder receber o link de cadastro de face enquanto o número ' +
          'for compartilhado. O rosto dela terá de ser cadastrado aqui, pela câmera do computador ou por upload de fotos.</p>' +
        '<label class="lb">Por que autorizar mesmo assim?</label>' +
        '<textarea id="motivoTelDup" rows="2" placeholder="ex.: pai e filho no mesmo canteiro, um celular só" style="width:100%;box-sizing:border-box"></textarea>' +
        '<button class="act" id="btnAutorizarTelDup" disabled style="margin-top:10px">Salvar mesmo assim</button>' +
      '</div>';
    const campo = $('motivoTelDup');
    const botao = $('btnAutorizarTelDup');
    campo.oninput = () => { botao.disabled = campo.value.trim().length < 10; };
    botao.onclick = () => aoConfirmar({ autorizar_telefone_duplicado: true, motivo_telefone_duplicado: campo.value.trim() });
  },

  /* -------------------------------------------------------- ficha da pessoa */

  pintarPessoaDetalhe() {
    const p = (this.dados.pessoas || []).find(x => x.pessoa_id === this.pessoaAberta);
    if (!p) { this.pessoaAberta = null; return this.pintarPessoas(); }
    const eqs = (this.dados.equipes || []).filter(e => e.ativo || e.equipe_id === p.equipe_id);
    $('rh-pessoas').innerHTML =
      '<button type="button" class="act ghost" id="btnVoltarPessoas" style="width:auto;margin-bottom:12px">← Colaboradores</button>' +
      '<div class="card"><h2>' + esc(p.nome) + (p.ativo ? '' : ' <span class="tag">inativo</span>') + '</h2>' +
        (p.telefone_compartilhado
          ? '<p class="nota" style="margin:0 0 10px">Telefone compartilhado com <b>' +
              p.telefone_compartilhado_com.map(o => esc(o.nome)).join(', ') + '</b>.</p>'
          : '') +
        '<label class="lb">Nome</label><input type="text" id="pdNome" value="' + esc(p.nome) + '">' +
        '<label class="lb">Matrícula</label><input type="text" id="pdMat" value="' + esc(p.matricula) + '">' +
        '<label class="lb">Telefone (celular)</label><input type="text" id="pdTelefone" value="' + esc(p.telefone || '') + '">' +
        '<label class="lb">Equipe</label><select id="pdEquipe"><option value="">Sem equipe</option>' +
          eqs.map(e => '<option value="' + e.equipe_id + '"' + (e.equipe_id === p.equipe_id ? ' selected' : '') + '>' + esc(e.nome) + '</option>').join('') + '</select>' +
        '<label class="lb">Papel</label><select id="pdPapel">' +
          '<option value="colaborador"' + (p.papel === 'colaborador' ? ' selected' : '') + '>Colaborador</option>' +
          '<option value="gestor"' + (p.papel === 'gestor' ? ' selected' : '') + '>Gestor</option></select>' +
        '<button class="act" id="btnSalvarPessoa">Salvar</button>' +
        '<div id="pdConflito"></div>' +
      '</div>' +
      (p.ativo
        ? '<div class="card"><h2>Biometria</h2>' +
            '<button class="act ghost" id="btnAbrirBio">' + (p.tem_biometria ? 'Refazer biometria' : 'Cadastrar biometria') + '</button>' +
            '<div id="areaBio"></div>' +
          '</div>' +
          '<div class="card"><h2>Inativar</h2>' +
            '<p class="nota" style="margin:0 0 10px">A pessoa sai da carga e para de bater ponto. O histórico continua ' +
              'intacto. Reativar exige cadastrar o rosto de novo.</p>' +
            '<label class="lb">Por quê?</label>' +
            '<textarea id="motivoInativar" rows="2" placeholder="motivo do desligamento ou afastamento" style="width:100%;box-sizing:border-box"></textarea>' +
            '<button class="act danger" id="btnInativarPessoa" disabled style="margin-top:10px">Inativar</button>' +
          '</div>'
        : '<div class="card"><h2>Reativar</h2>' +
            '<p class="nota" style="margin:0 0 10px">Volta a poder bater ponto, mas sem biometria — cadastre o rosto de ' +
              'novo depois de reativar.</p>' +
            '<label class="lb">Telefone (celular)</label><input type="text" id="reativarTelefone" value="' + esc(p.telefone || '') + '">' +
            '<button class="act" id="btnReativarPessoa">Reativar</button>' +
            '<div id="reativarConflito"></div>' +
          '</div>');

    $('btnVoltarPessoas').onclick = () => { this.pessoaAberta = null; this.pintar(); };
    $('btnSalvarPessoa').onclick = () => this.salvarPessoa(p);
    const btnBio = $('btnAbrirBio');
    if (btnBio) btnBio.onclick = () => this.abrirBiometria(p.pessoa_id);
    const campoMotivo = $('motivoInativar');
    const btnInativar = $('btnInativarPessoa');
    if (campoMotivo && btnInativar) {
      campoMotivo.oninput = () => { btnInativar.disabled = campoMotivo.value.trim().length < 10; };
      btnInativar.onclick = () => this.inativarPessoa(p, campoMotivo.value.trim());
    }
    const btnReativar = $('btnReativarPessoa');
    if (btnReativar) btnReativar.onclick = () => this.reativarPessoa(p);
  },

  async salvarPessoa(p) {
    const dados = {
      pessoa_id: p.pessoa_id, versao_cadastro: p.versao_cadastro,
      nome: $('pdNome').value.trim(), matricula: $('pdMat').value.trim(), telefone: $('pdTelefone').value.trim(),
      equipe_id: $('pdEquipe').value || null, papel: $('pdPapel').value
    };
    $('btnSalvarPessoa').disabled = true;
    const r = await ApiRh.colaborador(this.cred, dados);
    $('btnSalvarPessoa').disabled = false;
    if (!r.ok) {
      if (r.codigo === 'TELEFONE_DUPLICADO') {
        this.pedirAutorizacaoTelefone('pdConflito', r, a => {
          this.pessoaAberta = p.pessoa_id;
          return this.salvarPessoaComAutorizacao(dados, a);
        });
        return;
      }
      if (r.codigo === 'CADASTRO_DESATUALIZADO') {
        toast('Alguém alterou esta pessoa enquanto você editava. Recarregando.', 'warn');
        await this.recarregar();
        return;
      }
      toast(r.erro || 'Falha', 'bad');
      return;
    }
    toast('Colaborador salvo', 'ok');
    await this.recarregar();
  },

  async salvarPessoaComAutorizacao(dados, autorizacao) {
    const r = await ApiRh.colaborador(this.cred, Object.assign({}, dados, autorizacao));
    if (!r.ok) { toast(r.erro || 'Falha', 'bad'); return; }
    toast('Colaborador salvo', 'ok');
    await this.recarregar();
  },

  async inativarPessoa(p, motivo) {
    $('btnInativarPessoa').disabled = true;
    const r = await ApiRh.colaboradorInativar(this.cred, {
      pessoa_id: p.pessoa_id, versao_cadastro: p.versao_cadastro, motivo,
      idempotency_key: 'inativar-' + p.pessoa_id + '-' + p.versao_cadastro
    });
    if (!r.ok) { toast(r.erro || 'Falha', 'bad'); $('btnInativarPessoa').disabled = false; return; }
    toast('Colaborador inativado', 'ok');
    await this.recarregar();
  },

  async reativarPessoa(p) {
    const telefone = $('reativarTelefone').value.trim();
    $('btnReativarPessoa').disabled = true;
    const r = await ApiRh.colaboradorReativar(this.cred, {
      pessoa_id: p.pessoa_id, versao_cadastro: p.versao_cadastro, telefone,
      idempotency_key: 'reativar-' + p.pessoa_id + '-' + p.versao_cadastro
    });
    $('btnReativarPessoa').disabled = false;
    if (!r.ok) {
      if (r.codigo === 'TELEFONE_DUPLICADO') {
        this.pedirAutorizacaoTelefone('reativarConflito', r, a => this.reativarPessoaComAutorizacao(p, telefone, a));
        return;
      }
      toast(r.erro || 'Falha', 'bad');
      return;
    }
    toast('Colaborador reativado', 'ok');
    await this.recarregar();
  },

  async reativarPessoaComAutorizacao(p, telefone, autorizacao) {
    const r = await ApiRh.colaboradorReativar(this.cred, Object.assign({
      pessoa_id: p.pessoa_id, versao_cadastro: p.versao_cadastro, telefone,
      idempotency_key: 'reativar-' + p.pessoa_id + '-' + p.versao_cadastro
    }, autorizacao));
    if (!r.ok) { toast(r.erro || 'Falha', 'bad'); return; }
    toast('Colaborador reativado', 'ok');
    await this.recarregar();
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
    $('btnSalvarBio').disabled = true;
    const p = this.alvoCadastro;
    // versao_cadastro precisa ir junto (§3.2): sem ela o servidor recusa com
    // CADASTRO_DESATUALIZADO — esta chamada não muda nada na pessoa, mas é a
    // MESMA rota de edição, então segue a mesma pré-condição.
    const r = await ApiRh.colaborador(this.cred, {
      pessoa_id: p.pessoa_id, versao_cadastro: p.versao_cadastro, nome: p.nome, matricula: p.matricula,
      equipe_id: p.equipe_id, papel: p.papel
    });
    if (!r.ok) { toast(r.erro || 'Falha', 'bad'); $('btnSalvarBio').disabled = false; return; }
    // T-4B538E: coerência é calculada e decidida no servidor (§4.2 do
    // contrato) — mandar um número calculado aqui era campo morto que parecia
    // vivo: o servidor sempre ignorou e recalculou o dele.
    const bio = await Api.cadastrar(this._dispositivo.dispositivo_id, this._dispositivo.credencial, {
      origem: 'rh', pessoa_id: p.pessoa_id, nome: p.nome, matricula: p.matricula,
      equipe_id: p.equipe_id, vetores: c.map(x => x.descritor), miniatura: c[0].thumb
    });
    $('btnSalvarBio').disabled = false;
    if (!bio.ok) { toast(bio.erro || 'Falha ao gravar biometria', 'bad'); return; }
    toast('Biometria salva', 'ok');
    this.pararCamCad();
    $('areaBio').innerHTML = '';
    await this.recarregar();
  },

  /* --------------------------------------------------------- equipes */

  pintarEquipes() {
    if (this.equipeAberta) return this.pintarEquipeDetalhe();
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
          '<button type="button" class="linha-item" data-equipe="' + e.equipe_id + '">' +
          '<span class="ponto ' + (e.ativo ? 'ok' : 'bad') + '"></span>' +
          '<div style="flex:1;text-align:left"><div class="nm">' + esc(e.nome) + (e.ativo ? '' : ' <span class="tag">inativa</span>') + '</div>' +
          '<div class="mt">' + esc(e.unidade || '—') + ' · ' + (cont[e.equipe_id] || 0) + ' pessoas</div></div></button>').join('')
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
    $('rh-equipes').querySelectorAll('button[data-equipe]').forEach(b => {
      b.onclick = () => { this.equipeAberta = b.dataset.equipe; this.pintar(); };
    });
  },

  /**
   * §2.1 do contrato: "sem rota de membro" não é "sem gestão de membro" — a
   * tela abre a equipe, mostra os membros, adiciona e remove de dentro dela.
   * Por baixo é sempre /rh/colaborador escrevendo equipe_id da PESSOA; não
   * existe /rh/equipe/membro. Mandar o RH trocar um <select> na aba de
   * pessoas não cumpriria o pedido, mesmo sendo a mesma escrita.
   */
  pintarEquipeDetalhe() {
    const equipe = (this.dados.equipes || []).find(e => e.equipe_id === this.equipeAberta);
    if (!equipe) { this.equipeAberta = null; return this.pintarEquipes(); }
    const membros = (this.dados.pessoas || []).filter(p => p.equipe_id === equipe.equipe_id && p.ativo)
      .sort((a, b) => a.nome.localeCompare(b.nome));
    const foraDaEquipe = (this.dados.pessoas || []).filter(p => p.ativo && p.equipe_id !== equipe.equipe_id)
      .sort((a, b) => a.nome.localeCompare(b.nome));

    $('rh-equipes').innerHTML =
      '<button type="button" class="act ghost" id="btnVoltarEquipes" style="width:auto;margin-bottom:12px">← Equipes</button>' +
      '<div class="card"><h2>' + esc(equipe.nome) + (equipe.ativo ? '' : ' <span class="tag">inativa</span>') + '</h2>' +
        '<label class="lb">Nome</label><input type="text" id="eDetNome" value="' + esc(equipe.nome) + '">' +
        '<label class="lb">Unidade</label><input type="text" id="eDetUnidade" value="' + esc(equipe.unidade || '') + '">' +
        '<button class="act" id="btnSalvarEquipe">Salvar</button>' +
        (equipe.ativo
          ? '<button class="act danger ghost" id="btnInativarEquipe" style="margin-top:8px">Inativar equipe</button>'
          : '<button class="act ghost" id="btnReativarEquipe" style="margin-top:8px">Reativar equipe</button>') +
      '</div>' +
      '<div class="card"><h2>Membros <span class="nota">— ' + membros.length + '</span></h2>' +
        (membros.length ? membros.map(p =>
          '<div class="linha-item"><div style="flex:1"><div class="nm">' + esc(p.nome) + '</div>' +
          '<div class="mt">' + esc(p.matricula) + '</div></div>' +
          '<button class="act ghost" style="width:auto;margin:0;padding:9px 12px;font-size:12px" data-remover="' + p.pessoa_id + '">Remover</button></div>').join('')
          : '<p class="nota">Nenhum membro.</p>') +
      '</div>' +
      '<div class="card"><h2>Adicionar membro</h2>' +
        (foraDaEquipe.length
          ? '<select id="eAdicionarSelect">' + foraDaEquipe.map(p =>
              '<option value="' + p.pessoa_id + '">' + esc(p.nome) +
              (p.equipe_id ? ' (' + esc(this.nomeEquipe(p.equipe_id)) + ')' : ' (sem equipe)') + '</option>').join('') +
            '</select><button class="act" id="btnAdicionarMembro" style="margin-top:8px">Adicionar</button>'
          : '<p class="nota">Todo mundo ativo já está nesta equipe.</p>') +
      '</div>';

    $('btnVoltarEquipes').onclick = () => { this.equipeAberta = null; this.pintar(); };
    $('btnSalvarEquipe').onclick = async () => {
      const r = await ApiRh.equipe(this.cred, {
        equipe_id: equipe.equipe_id, nome: $('eDetNome').value.trim(), unidade: $('eDetUnidade').value.trim()
      });
      if (!r.ok) { toast(r.erro || 'Falha', 'bad'); return; }
      toast('Equipe atualizada', 'ok');
      await this.recarregar();
    };
    const btnInativar = $('btnInativarEquipe');
    if (btnInativar) btnInativar.onclick = async () => {
      const r = await ApiRh.equipe(this.cred, { equipe_id: equipe.equipe_id, nome: equipe.nome, unidade: equipe.unidade, ativo: false });
      if (!r.ok) {
        toast(r.codigo === 'EQUIPE_COM_MEMBROS'
          ? 'Inative os ' + ((r.detalhe && r.detalhe.membros_ativos) || '') + ' membros ativos antes de inativar a equipe'
          : (r.erro || 'Falha'), 'bad');
        return;
      }
      toast('Equipe inativada', 'ok');
      await this.recarregar();
    };
    const btnReativar = $('btnReativarEquipe');
    if (btnReativar) btnReativar.onclick = async () => {
      const r = await ApiRh.equipe(this.cred, { equipe_id: equipe.equipe_id, nome: equipe.nome, unidade: equipe.unidade, ativo: true });
      if (!r.ok) { toast(r.erro || 'Falha', 'bad'); return; }
      toast('Equipe reativada', 'ok');
      await this.recarregar();
    };
    $('rh-equipes').querySelectorAll('button[data-remover]').forEach(b => {
      b.onclick = async () => {
        const pessoa = membros.find(p => p.pessoa_id === b.dataset.remover);
        b.disabled = true;
        const r = await ApiRh.colaborador(this.cred, { pessoa_id: pessoa.pessoa_id, versao_cadastro: pessoa.versao_cadastro, equipe_id: null });
        if (!r.ok) { toast(r.erro || 'Falha', 'bad'); b.disabled = false; return; }
        toast('Removido da equipe', 'ok');
        await this.recarregar();
      };
    });
    const btnAdicionar = $('btnAdicionarMembro');
    if (btnAdicionar) btnAdicionar.onclick = async () => {
      const pessoaId = $('eAdicionarSelect').value;
      const pessoa = foraDaEquipe.find(p => p.pessoa_id === pessoaId);
      btnAdicionar.disabled = true;
      const r = await ApiRh.colaborador(this.cred, { pessoa_id: pessoa.pessoa_id, versao_cadastro: pessoa.versao_cadastro, equipe_id: equipe.equipe_id });
      if (!r.ok) { toast(r.erro || 'Falha', 'bad'); btnAdicionar.disabled = false; return; }
      toast('Adicionado à equipe', 'ok');
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
