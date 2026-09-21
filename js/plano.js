// Editor de PLANO recorrente de alocação — a EXCEÇÃO da escala: turma que
// trabalha noutro ponto, em certos dias, por um período. No dia a dia a cerca
// vem do local da equipe (js/rh.js → Equipes) e nada disso é necessário.
//
// O bloco de cerca no mapa é o componente compartilhado js/cerca-mapa.js.
import { ApiRh } from './api.js';
import { criarCercaMapa } from './cerca-mapa.js';
import { $, esc, toast } from './ui.js';

const DIAS = [
  { n: 1, r: 'Seg' }, { n: 2, r: 'Ter' }, { n: 3, r: 'Qua' },
  { n: 4, r: 'Qui' }, { n: 5, r: 'Sex' }, { n: 6, r: 'Sáb' }, { n: 7, r: 'Dom' }
];

export const PlanoEditor = {
  rh: null, alvo: 'planoEditor', aoSalvar: null,
  cerca: null,
  planoId: null, nome: '', equipeId: null, dias: new Set([1, 2, 3, 4, 5]), selecionados: new Set(),
  vigInicio: null, vigFim: '',

  abrir(rh, opts) {
    opts = opts || {};
    this.rh = rh;
    this.alvo = opts.alvo || 'planoEditor';
    this.aoSalvar = opts.aoSalvar || null;
    this.planoId = opts.plano_id || null;
    this.nome = opts.nome || '';
    const eqs = rh.dados.equipes || [];
    this.equipeId = opts.equipe_id || (eqs[0] && eqs[0].equipe_id);
    // Escala nova já nasce na cerca da equipe (equipe = obra); o RH só mexe se
    // esta escala for a exceção que vai para outro ponto.
    const lq = (opts.cerca_lat == null) ? this.localDaEquipe(this.equipeId) : null;
    this.cerca = criarCercaMapa({
      prefixo: 'pl', rh,
      centro: (opts.cerca_lat != null) ? { lat: opts.cerca_lat, lng: opts.cerca_lng }
            : lq ? { lat: lq.lat, lng: lq.lng } : null,
      raio: opts.cerca_raio_m || (lq && lq.raio_m) || (window.EFRAT_CFG || {}).raioPadraoM || 200
    });
    this.dias = new Set(opts.dias_semana && opts.dias_semana.length ? opts.dias_semana.map(Number) : [1, 2, 3, 4, 5]);
    this.selecionados = new Set(opts.colaboradores || []);
    this._preSel = !!opts.colaboradores;
    this.vigInicio = opts.vigencia_inicio || (rh.dados.servidor_hora || new Date().toISOString()).slice(0, 10);
    this.vigFim = opts.vigencia_fim || '';
    this.pintar();
  },

  /** O local (cerca) da equipe, quando ela tem um. */
  localDaEquipe(equipeId) {
    const d = this.rh.dados;
    const eq = (d.equipes || []).find(e => e.equipe_id === equipeId);
    if (!eq || !eq.local_id) return null;
    return (d.locais || []).find(l => l.local_id === eq.local_id) || null;
  },

  pintar() {
    const d = this.rh.dados;
    const eqs = d.equipes || [];
    $(this.alvo).innerHTML =
      '<div class="card" style="margin:0;box-shadow:none;border:0">' +
        '<label class="lb2">Nome da escala (projeto / obra)</label>' +
        '<input class="inp" id="plNome" type="text" maxlength="80" placeholder="Ex.: Obra Norte, Manutenção Sede" value="' + esc(this.nome) + '">' +
        '<div class="form-grid" style="margin-top:10px">' +
          '<div><label class="lb2">Equipe</label><select class="inp" id="plEquipe">' +
            eqs.map(e => '<option value="' + e.equipe_id + '"' + (e.equipe_id === this.equipeId ? ' selected' : '') + '>' + esc(e.nome) + '</option>').join('') + '</select></div>' +
          '<div><label class="lb2">Início da vigência</label><input class="inp" id="plIni" type="date" value="' + esc(this.vigInicio) + '"></div>' +
          '<div><label class="lb2">Fim (vazio = sem prazo)</label><input class="inp" id="plFim" type="date" value="' + esc(this.vigFim) + '"></div>' +
        '</div>' +
        '<label class="lb2" style="margin-top:12px">Dias da semana</label>' +
        '<div class="dias-semana" id="plDias">' +
          DIAS.map(x => '<button type="button" class="dia-btn' + (this.dias.has(x.n) ? ' on' : '') + '" data-dia="' + x.n + '">' + x.r + '</button>').join('') +
        '</div>' +
        '<div style="margin-top:12px">' + this.cerca.html() + '</div>' +
        '<label class="lb2" style="margin-top:8px">Colaboradores desta escala</label>' +
        '<div id="plPessoas" class="lista-check"></div>' +
        '<div class="row2" style="margin-top:14px">' +
          '<button class="act" id="plSalvar">Salvar escala</button>' +
          '<button class="act ghost" id="plCancelar">Cancelar</button></div>' +
      '</div>';

    $('plNome').oninput = e => { this.nome = e.target.value; };
    $('plEquipe').onchange = e => {
      this.equipeId = e.target.value;
      if (!this._preSel) this.marcarEquipe();
      // Escala ainda sem pino: acompanha a cerca da equipe escolhida.
      if (!this.planoId) {
        const l = this.localDaEquipe(this.equipeId);
        if (l) { this.cerca.definirRaio(l.raio_m); this.cerca.definirCentro(l.lat, l.lng, true); }
      }
      this.pintarPessoas();
    };
    $('plIni').onchange = e => { this.vigInicio = e.target.value; };
    $('plFim').onchange = e => { this.vigFim = e.target.value; };
    $('plDias').querySelectorAll('[data-dia]').forEach(b => {
      b.onclick = () => {
        const n = Number(b.dataset.dia);
        if (this.dias.has(n)) this.dias.delete(n); else this.dias.add(n);
        b.classList.toggle('on', this.dias.has(n));
      };
    });
    $('plSalvar').onclick = () => this.salvar();
    $('plCancelar').onclick = () => { if (this.aoSalvar) this.aoSalvar(true); };

    if (!this._preSel) this.marcarEquipe(); else this._preSel = false;
    this.pintarPessoas();
    this.cerca.ligar();
  },

  marcarEquipe() {
    this.selecionados = new Set(
      (this.rh.dados.pessoas || []).filter(p => p.ativo && p.equipe_id === this.equipeId).map(p => p.pessoa_id));
  },

  pintarPessoas() {
    const pessoas = (this.rh.dados.pessoas || []).filter(p => p.ativo).slice().sort((a, b) => a.nome.localeCompare(b.nome));
    $('plPessoas').innerHTML = pessoas.map(p =>
      '<label class="check"><input type="checkbox" data-id="' + p.pessoa_id + '"' + (this.selecionados.has(p.pessoa_id) ? ' checked' : '') + '>' +
        '<span>' + esc(p.nome) + '</span></label>').join('') || '<p class="nota">Nenhum colaborador ativo.</p>';
    $('plPessoas').querySelectorAll('input').forEach(c => {
      c.onchange = () => { c.checked ? this.selecionados.add(c.dataset.id) : this.selecionados.delete(c.dataset.id); };
    });
  },

  async salvar() {
    const centro = this.cerca.centro;
    if (!centro) { toast('Defina a cerca no mapa', 'warn'); return; }
    if (!this.equipeId) { toast('Escolha a equipe', 'warn'); return; }
    if (!this.dias.size) { toast('Escolha ao menos um dia da semana', 'warn'); return; }
    if (!this.selecionados.size) { toast('Marque ao menos um colaborador', 'warn'); return; }
    if (this.vigFim && this.vigFim < this.vigInicio) { toast('O fim da vigência é antes do início', 'warn'); return; }
    const btn = $('plSalvar'); btn.disabled = true; btn.textContent = 'Salvando…';
    const corpo = {
      acao: 'salvar', plano_id: this.planoId, nome: this.nome.trim() || null, equipe_id: this.equipeId,
      cerca: { lat: centro.lat, lng: centro.lng, raio_m: this.cerca.raio },
      colaboradores: [...this.selecionados],
      dias_semana: [...this.dias].sort((a, b) => a - b),
      vigencia_inicio: this.vigInicio, vigencia_fim: this.vigFim || null
    };
    let r = await ApiRh.plano(this.rh.token, corpo);
    // Uma pessoa só pode estar em UMA escala por dia. A API recusa e diz quem/onde;
    // o RH decide se tira a pessoa da outra escala (forcar) ou desiste.
    if (!r.ok && r.codigo === 'CONFLITO' && r.detalhes && r.detalhes.conflitos) {
      const nomeDe = id => { const p = (this.rh.dados.pessoas || []).find(x => x.pessoa_id === id); return p ? p.nome : id; };
      const linhas = r.detalhes.conflitos.map(c =>
        '• ' + c.em_comum.map(nomeDe).join(', ') + ' já está na escala "' + (c.nome || this.rh.nomeEquipe(c.equipe_id)) + '"');
      const ok = confirm('Cada pessoa só pode estar em uma escala por dia.\n\n' + linhas.join('\n') +
        '\n\nTirar de lá e colocar nesta escala?');
      if (ok) r = await ApiRh.plano(this.rh.token, Object.assign({ forcar: true }, corpo));
    }
    btn.disabled = false; btn.textContent = 'Salvar escala';
    if (!r.ok) { if (r.codigo !== 'CONFLITO') toast(r.erro || 'Falha ao salvar escala', 'bad'); return; }
    const d = r.dados;
    if (!d.alocacoes_gravadas) toast('Escala salva, mas nenhum dia foi gerado. Confira dias da semana, vigência e colaboradores.', 'warn');
    else toast('Escala salva · ' + d.alocacoes_gravadas + ' alocações em ' + d.dias_materializados + ' dias', 'ok');
    if (this.aoSalvar) this.aoSalvar();
  }
};
