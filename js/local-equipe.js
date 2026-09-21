// "Definir local" da equipe: o ponto no mapa onde quem está nela bate ponto.
// Uma tela só — escolhe um local já salvo OU solta o pino e salva um novo com o
// nome da equipe, e em ambos os casos já vincula (equipe.local_id).
//
// É o único passo manual quando uma equipe nova chega do Bitrix: jornada e raio
// vêm do padrão da empresa (Configurações).
import { ApiRh } from './api.js';
import { criarCercaMapa } from './cerca-mapa.js';
import { $, esc, toast } from './ui.js';

export const LocalEquipe = {
  rh: null, equipe: null, alvo: 'equipeLocalEditor', aoSalvar: null,
  cerca: null, localId: null,

  /** opts: { alvo, aoSalvar }. `equipe` é a linha de dados.equipes. */
  abrir(rh, equipe, opts) {
    opts = opts || {};
    this.rh = rh;
    this.equipe = equipe;
    this.alvo = opts.alvo || 'equipeLocalEditor';
    this.aoSalvar = opts.aoSalvar || null;
    const atual = (rh.dados.locais || []).find(l => l.local_id === equipe.local_id) || null;
    this.localId = atual ? atual.local_id : null;
    this.cerca = criarCercaMapa({
      prefixo: 'lq', rh, locais: false,          // a lista de locais salvos fica no select próprio abaixo
      centro: atual ? { lat: atual.lat, lng: atual.lng } : null,
      raio: (atual && atual.raio_m) || (window.EFRAT_CFG || {}).raioPadraoM || 200
    });
    this.pintar(atual);
  },

  pintar(atual) {
    const locais = this.rh.dados.locais || [];
    $(this.alvo).innerHTML =
      '<div class="card" style="margin:0;box-shadow:none;border:0">' +
        '<p class="cap">Quem está na equipe <b>' + esc(this.equipe.nome) + '</b> bate ponto aqui, todos os dias. ' +
          'O raio já vem do padrão da empresa; mexa só se esta obra precisar de outro.</p>' +
        (locais.length ?
          '<label class="lb2" style="margin-top:10px">Usar um local já salvo</label>' +
          '<select class="inp" id="lqSalvo"><option value="">— novo ponto no mapa —</option>' +
            locais.map(l => '<option value="' + esc(l.local_id) + '"' + (this.localId === l.local_id ? ' selected' : '') + '>' +
              esc(l.nome) + ' · ' + l.raio_m + 'm</option>').join('') + '</select>' : '') +
        '<label class="lb2" style="margin-top:10px">Nome do local</label>' +
        '<input class="inp" id="lqNome" type="text" maxlength="80" value="' + esc(atual ? atual.nome : this.equipe.nome) + '">' +
        '<div style="margin-top:10px">' + this.cerca.html() + '</div>' +
        '<div class="row2" style="margin-top:14px">' +
          '<button class="act" id="lqSalvar">Salvar local da equipe</button>' +
          (this.equipe.local_id ? '<button class="act ghost" id="lqTirar">Tirar o local</button>' : '') +
          '<button class="act ghost" id="lqCancelar">Cancelar</button></div>' +
      '</div>';

    const salvo = $('lqSalvo');
    if (salvo) salvo.onchange = e => {
      this.localId = e.target.value || null;
      const l = locais.find(x => x.local_id === this.localId);
      if (l) { $('lqNome').value = l.nome; this.cerca.definirRaio(l.raio_m); this.cerca.definirCentro(l.lat, l.lng, true); }
    };
    // Mexeu no pino ou no nome: deixa de ser "o local salvo X" e vira um novo.
    $('lqNome').oninput = () => { this.localId = null; if (salvo) salvo.value = ''; };

    $('lqSalvar').onclick = () => this.salvar();
    if ($('lqTirar')) $('lqTirar').onclick = () => this.vincular(null, 'Equipe ficou sem local', 'warn');
    $('lqCancelar').onclick = () => { if (this.aoSalvar) this.aoSalvar(true); };

    this.cerca.ligar();
    const definir = this.cerca.definirCentro.bind(this.cerca);
    this.cerca.definirCentro = (lat, lng, mover) => {
      // Pino movido à mão: o que for salvo é um local novo, não o escolhido.
      if (this.localId) { const l = locais.find(x => x.local_id === this.localId);
        if (!l || Math.abs(l.lat - lat) > 1e-7 || Math.abs(l.lng - lng) > 1e-7) { this.localId = null; if (salvo) salvo.value = ''; } }
      definir(lat, lng, mover);
    };
  },

  async salvar() {
    const nome = ($('lqNome').value || '').trim();
    if (!nome) { toast('Dê um nome ao local', 'warn'); return; }
    if (!this.localId && !this.cerca.centro) { toast('Toque no mapa para posicionar a cerca', 'warn'); return; }
    const btn = $('lqSalvar'); btn.disabled = true; btn.textContent = 'Salvando…';

    let localId = this.localId;
    if (!localId) {
      const c = this.cerca.centro;
      const r = await ApiRh.local(this.rh.token, { nome, lat: c.lat, lng: c.lng, raio_m: this.cerca.raio });
      if (!r.ok) { btn.disabled = false; btn.textContent = 'Salvar local da equipe'; toast(r.erro || 'Falha ao salvar o local', 'bad'); return; }
      localId = r.dados.local_id;
    }
    await this.vincular(localId, 'Local da equipe definido', 'ok');
  },

  async vincular(localId, msg, tom) {
    const r = await ApiRh.equipe(this.rh.token, { acao: 'local', equipe_id: this.equipe.equipe_id, local_id: localId });
    const btn = $('lqSalvar'); if (btn) { btn.disabled = false; btn.textContent = 'Salvar local da equipe'; }
    if (!r.ok) { toast(r.erro || 'Falha ao vincular o local', 'bad'); return; }
    toast(msg, tom);
    if (this.aoSalvar) this.aoSalvar();
  }
};
