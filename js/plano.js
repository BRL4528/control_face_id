// Editor de PLANO recorrente de alocação: equipe → cerca no mapa, dias da semana
// e vigência. Reaproveita a infra de mapa do editor diário (js/alocacao.js) e
// grava via /rh/plano, que materializa as alocações dos dias úteis.
import { ApiRh } from './api.js';
import { carregarMapLibre, ESTILO, circuloGeoJSON } from './alocacao.js';
import { extrairCoordenadas } from './geo-parse.js';
import { $, esc, toast } from './ui.js';

const DIAS = [
  { n: 1, r: 'Seg' }, { n: 2, r: 'Ter' }, { n: 3, r: 'Qua' },
  { n: 4, r: 'Qui' }, { n: 5, r: 'Sex' }, { n: 6, r: 'Sáb' }, { n: 7, r: 'Dom' }
];

export const PlanoEditor = {
  rh: null, alvo: 'planoEditor', aoSalvar: null,
  map: null, marcador: null, centro: null, raio: 200,
  planoId: null, equipeId: null, dias: new Set([1, 2, 3, 4, 5]), selecionados: new Set(),
  vigInicio: null, vigFim: '',

  abrir(rh, opts) {
    opts = opts || {};
    this.rh = rh;
    this.alvo = opts.alvo || 'planoEditor';
    this.aoSalvar = opts.aoSalvar || null;
    this.planoId = opts.plano_id || null;
    const eqs = rh.dados.equipes || [];
    this.equipeId = opts.equipe_id || (eqs[0] && eqs[0].equipe_id);
    this.centro = (opts.cerca_lat != null) ? { lat: opts.cerca_lat, lng: opts.cerca_lng } : null;
    this.raio = opts.cerca_raio_m || 200;
    this.dias = new Set(opts.dias_semana && opts.dias_semana.length ? opts.dias_semana.map(Number) : [1, 2, 3, 4, 5]);
    this.selecionados = new Set(opts.colaboradores || []);
    this._preSel = !!opts.colaboradores;
    this.vigInicio = opts.vigencia_inicio || (rh.dados.servidor_hora || new Date().toISOString()).slice(0, 10);
    this.vigFim = opts.vigencia_fim || '';
    this.map = null; this.marcador = null;
    this.pintar();
  },

  pintar() {
    const d = this.rh.dados;
    const eqs = d.equipes || [];
    const locais = d.locais || [];
    $(this.alvo).innerHTML =
      '<div class="card" style="margin:0;box-shadow:none;border:0">' +
        '<div class="form-grid">' +
          '<div><label class="lb2">Equipe</label><select class="inp" id="plEquipe">' +
            eqs.map(e => '<option value="' + e.equipe_id + '"' + (e.equipe_id === this.equipeId ? ' selected' : '') + '>' + esc(e.nome) + '</option>').join('') + '</select></div>' +
          '<div><label class="lb2">Início da vigência</label><input class="inp" id="plIni" type="date" value="' + esc(this.vigInicio) + '"></div>' +
          '<div><label class="lb2">Fim (vazio = sem prazo)</label><input class="inp" id="plFim" type="date" value="' + esc(this.vigFim) + '"></div>' +
        '</div>' +
        '<label class="lb2" style="margin-top:12px">Dias da semana</label>' +
        '<div class="dias-semana" id="plDias">' +
          DIAS.map(x => '<button type="button" class="dia-btn' + (this.dias.has(x.n) ? ' on' : '') + '" data-dia="' + x.n + '">' + x.r + '</button>').join('') +
        '</div>' +
        '<label class="lb2" style="margin-top:12px">Local (cerca)</label>' +
        '<select class="inp" id="plLocal"><option value="">— escolha um local salvo ou defina no mapa —</option>' +
          locais.map(l => '<option value="' + l.local_id + '">' + esc(l.nome) + ' · ' + l.raio_m + 'm</option>').join('') + '</select>' +
        '<div class="localbar" style="margin-top:8px"><div class="buscabox">' +
          '<input class="inp" type="text" id="plBusca" placeholder="🔍 Buscar endereço… ou colar coordenadas / link do Maps">' +
          '<button class="v2btn ghost" id="plBuscarBtn" style="margin:0">Buscar</button>' +
          '<button class="v2btn ghost" id="plGps" title="Minha localização" style="margin:0">📍</button>' +
        '</div><div id="plResultados" class="resultados hide"></div></div>' +
        '<div id="planoMapa" style="height:280px;border-radius:12px;overflow:hidden;margin:10px 0;background:var(--v2-surf2)"></div>' +
        '<label class="lb2">Raio: <span id="plRaioVal" class="mono">' + this.raio + '</span> m</label>' +
        '<input type="range" id="plRaio" min="50" max="1000" step="10" value="' + this.raio + '" style="width:100%">' +
        '<p class="cap" id="plCoord">' + (this.centro ? ('Cerca em ' + this.centro.lat.toFixed(5) + ', ' + this.centro.lng.toFixed(5)) : 'Toque no mapa para posicionar a cerca.') + '</p>' +
        '<label class="lb2" style="margin-top:8px">Colaboradores do plano</label>' +
        '<div id="plPessoas" class="lista-check"></div>' +
        '<div class="row2" style="margin-top:14px">' +
          '<button class="act" id="plSalvar">Salvar plano</button>' +
          '<button class="act ghost" id="plCancelar">Cancelar</button></div>' +
      '</div>';

    $('plEquipe').onchange = e => { this.equipeId = e.target.value; if (!this._preSel) this.marcarEquipe(); this.pintarPessoas(); };
    $('plIni').onchange = e => { this.vigInicio = e.target.value; };
    $('plFim').onchange = e => { this.vigFim = e.target.value; };
    $('plDias').querySelectorAll('[data-dia]').forEach(b => {
      b.onclick = () => {
        const n = Number(b.dataset.dia);
        if (this.dias.has(n)) this.dias.delete(n); else this.dias.add(n);
        b.classList.toggle('on', this.dias.has(n));
      };
    });
    $('plLocal').onchange = e => this.escolherLocal(e.target.value);
    $('plBuscarBtn').onclick = () => this.buscar();
    $('plBusca').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); this.buscar(); } };
    $('plGps').onclick = () => this.minhaLocalizacao();
    $('plRaio').oninput = e => { this.raio = Number(e.target.value); $('plRaioVal').textContent = this.raio; this.desenharCerca(); };
    $('plSalvar').onclick = () => this.salvar();
    $('plCancelar').onclick = () => { if (this.aoSalvar) this.aoSalvar(true); };

    if (!this._preSel) this.marcarEquipe(); else this._preSel = false;
    this.pintarPessoas();
    this.iniciarMapa();
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

  async iniciarMapa() {
    try {
      const maplibregl = await carregarMapLibre();
      if (!$(this.alvo) || !$('planoMapa')) return;
      const l0 = (this.rh.dados.locais || [])[0];
      const ini = this.centro || (l0 ? { lat: l0.lat, lng: l0.lng } : null);
      const centro = ini ? [ini.lng, ini.lat] : [-54.6, -20.47];
      this.map = new maplibregl.Map({ container: 'planoMapa', style: ESTILO, center: centro, zoom: 14 });
      this.map.addControl(new maplibregl.NavigationControl(), 'top-right');
      this.map.on('load', () => {
        this.map.addSource('cerca', { type: 'geojson', data: circuloGeoJSON(centro[1], centro[0], this.raio) });
        this.map.addLayer({ id: 'cerca-fill', type: 'fill', source: 'cerca', paint: { 'fill-color': '#1d4ed8', 'fill-opacity': 0.15 } });
        this.map.addLayer({ id: 'cerca-linha', type: 'line', source: 'cerca', paint: { 'line-color': '#1d4ed8', 'line-width': 2 } });
        if (ini) this.definirCentro(ini.lat, ini.lng, false);
      });
      this.map.on('click', e => this.definirCentro(e.lngLat.lat, e.lngLat.lng, true));
    } catch (e) {
      $('planoMapa').innerHTML = '<p class="nota" style="padding:20px;text-align:center">Não consegui carregar o mapa.</p>';
    }
  },

  definirCentro(lat, lng, mover) {
    this.centro = { lat, lng };
    if (!this.marcador) {
      this.marcador = new window.maplibregl.Marker({ color: '#1d4ed8', draggable: true }).setLngLat([lng, lat]).addTo(this.map);
      this.marcador.on('dragend', () => { const p = this.marcador.getLngLat(); this.definirCentro(p.lat, p.lng, false); });
    } else this.marcador.setLngLat([lng, lat]);
    if (mover) this.map.easeTo({ center: [lng, lat] });
    this.desenharCerca();
    if ($('plCoord')) $('plCoord').textContent = 'Cerca em ' + lat.toFixed(5) + ', ' + lng.toFixed(5) + ' · raio ' + this.raio + ' m';
  },

  desenharCerca() {
    if (this.map && this.centro && this.map.getSource('cerca')) this.map.getSource('cerca').setData(circuloGeoJSON(this.centro.lat, this.centro.lng, this.raio));
  },

  escolherLocal(localId) {
    const l = (this.rh.dados.locais || []).find(x => x.local_id === localId);
    if (!l) return;
    this.raio = l.raio_m; $('plRaio').value = l.raio_m; $('plRaioVal').textContent = l.raio_m;
    this.definirCentro(l.lat, l.lng, true);
  },

  async buscar() {
    const texto = ($('plBusca').value || '').trim();
    if (!texto) return;
    this.esconderResultados();
    const coord = extrairCoordenadas(texto);
    if (coord && coord.erro) { toast(coord.erro, 'warn'); return; }
    if (coord) { this.definirCentro(coord.lat, coord.lng, true); toast('Ponto colado', 'ok'); return; }
    const btn = $('plBuscarBtn'); btn.disabled = true; btn.textContent = '…';
    try {
      const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=5&q=' + encodeURIComponent(texto);
      const r = await fetch(url, { headers: { 'Accept-Language': 'pt-BR' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const lista = await r.json();
      if (!lista.length) { toast('Endereço não encontrado.', 'warn'); return; }
      this.mostrarResultados(lista);
    } catch (e) { toast('Busca indisponível. Cole as coordenadas.', 'bad'); }
    finally { btn.disabled = false; btn.textContent = 'Buscar'; }
  },

  mostrarResultados(lista) {
    const box = $('plResultados');
    box.innerHTML = lista.map((r, i) => '<button class="resultado" data-i="' + i + '">' + esc(r.display_name) + '</button>').join('');
    box.classList.remove('hide');
    box.querySelectorAll('button').forEach(b => {
      b.onclick = () => { const r = lista[Number(b.dataset.i)]; this.definirCentro(parseFloat(r.lat), parseFloat(r.lon), true); this.esconderResultados(); $('plBusca').value = r.display_name.split(',').slice(0, 2).join(','); };
    });
  },
  esconderResultados() { const b = $('plResultados'); if (b) { b.classList.add('hide'); b.innerHTML = ''; } },

  minhaLocalizacao() {
    if (!navigator.geolocation) { toast('Sem GPS', 'warn'); return; }
    const btn = $('plGps'); btn.disabled = true; btn.textContent = '…';
    navigator.geolocation.getCurrentPosition(
      p => { btn.disabled = false; btn.textContent = '📍'; this.definirCentro(p.coords.latitude, p.coords.longitude, true); },
      () => { btn.disabled = false; btn.textContent = '📍'; toast('Não consegui sua localização', 'bad'); },
      { enableHighAccuracy: true, timeout: 8000 });
  },

  async salvar() {
    if (!this.centro) { toast('Defina a cerca no mapa', 'warn'); return; }
    if (!this.equipeId) { toast('Escolha a equipe', 'warn'); return; }
    if (!this.dias.size) { toast('Escolha ao menos um dia da semana', 'warn'); return; }
    if (!this.selecionados.size) { toast('Marque ao menos um colaborador', 'warn'); return; }
    if (this.vigFim && this.vigFim < this.vigInicio) { toast('O fim da vigência é antes do início', 'warn'); return; }
    const btn = $('plSalvar'); btn.disabled = true; btn.textContent = 'Salvando…';
    const r = await ApiRh.plano(this.rh.token, {
      acao: 'salvar', plano_id: this.planoId, equipe_id: this.equipeId,
      cerca: { lat: this.centro.lat, lng: this.centro.lng, raio_m: this.raio },
      colaboradores: [...this.selecionados],
      dias_semana: [...this.dias].sort((a, b) => a - b),
      vigencia_inicio: this.vigInicio, vigencia_fim: this.vigFim || null
    });
    btn.disabled = false; btn.textContent = 'Salvar plano';
    if (!r.ok) { toast(r.erro || 'Falha ao salvar plano', 'bad'); return; }
    toast('Plano salvo · ' + r.dados.dias_materializados + ' dias aplicados', 'ok');
    if (this.aoSalvar) this.aoSalvar();
  }
};
