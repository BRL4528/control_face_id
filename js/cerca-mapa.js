// Bloco de CERCA no mapa: buscar endereço / colar coordenada / GPS, soltar o
// pino e ajustar o raio. É a mesma peça em toda tela que desenha uma cerca — o
// local da equipe (Equipes) e a escala de exceção (js/plano.js) —, por isso
// vive aqui e não dentro de um editor.
//
// Uso:
//   const cerca = criarCercaMapa({ prefixo: 'eq', rh, centro, raio, locais: true });
//   elemento.innerHTML = '…' + cerca.html() + '…';
//   cerca.ligar();                  // depois do innerHTML: liga eventos e sobe o mapa
//   cerca.centro                    // { lat, lng } ou null
//   cerca.raio                      // metros
//
// Os ids saem prefixados (prefixo 'pl' → plBusca, plMapa, plRaio…), então dois
// blocos podem coexistir na mesma página.
import { carregarMapLibre, ESTILO, circuloGeoJSON } from './alocacao.js';
import { extrairCoordenadas } from './geo-parse.js';
import { $, esc, toast } from './ui.js';

export function criarCercaMapa(opts) {
  const p = opts.prefixo || 'ce';
  const id = sufixo => p + sufixo;

  return {
    rh: opts.rh,
    centro: opts.centro || null,
    raio: opts.raio || 200,
    comLocais: opts.locais !== false,    // mostra o select de locais salvos
    altura: opts.altura || '280px',
    map: null, marcador: null,

    /** HTML do bloco. Insira no innerHTML do editor e chame ligar() depois. */
    html() {
      const locais = (this.rh.dados.locais || []);
      return (this.comLocais
        ? '<label class="lb2">Local (cerca)</label>' +
          '<select class="inp" id="' + id('Local') + '"><option value="">— escolha um local salvo ou defina no mapa —</option>' +
            locais.map(l => '<option value="' + esc(l.local_id) + '">' + esc(l.nome) + ' · ' + l.raio_m + 'm</option>').join('') +
          '</select>'
        : '') +
        '<div class="localbar" style="margin-top:8px"><div class="buscabox">' +
          '<input class="inp" type="text" id="' + id('Busca') + '" placeholder="🔍 Buscar endereço… ou colar coordenadas / link do Maps">' +
          '<button class="v2btn ghost" id="' + id('BuscarBtn') + '" style="margin:0">Buscar</button>' +
          '<button class="v2btn ghost" id="' + id('Gps') + '" title="Minha localização" style="margin:0">📍</button>' +
        '</div><div id="' + id('Resultados') + '" class="resultados hide"></div></div>' +
        '<div id="' + id('Mapa') + '" style="height:' + this.altura + ';border-radius:12px;overflow:hidden;margin:10px 0;background:var(--v2-surf2)"></div>' +
        '<label class="lb2">Raio: <span id="' + id('RaioVal') + '" class="mono">' + this.raio + '</span> m</label>' +
        '<input type="range" id="' + id('Raio') + '" min="50" max="1000" step="10" value="' + this.raio + '" style="width:100%">' +
        '<p class="cap" id="' + id('Coord') + '">' +
          (this.centro ? ('Cerca em ' + this.centro.lat.toFixed(5) + ', ' + this.centro.lng.toFixed(5)) : 'Toque no mapa para posicionar a cerca.') +
        '</p>';
    },

    /** Liga os eventos e sobe o mapa. Chame logo após inserir o html(). */
    ligar() {
      const sel = $(id('Local'));
      if (sel) sel.onchange = e => this.escolherLocal(e.target.value);
      $(id('BuscarBtn')).onclick = () => this.buscar();
      $(id('Busca')).onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); this.buscar(); } };
      $(id('Gps')).onclick = () => this.minhaLocalizacao();
      $(id('Raio')).oninput = e => {
        this.raio = Number(e.target.value);
        $(id('RaioVal')).textContent = this.raio;
        this.desenharCerca();
      };
      this.iniciarMapa();
    },

    async iniciarMapa() {
      try {
        const maplibregl = await carregarMapLibre();
        if (!$(id('Mapa'))) return;
        const l0 = (this.rh.dados.locais || [])[0];
        const ini = this.centro || (l0 ? { lat: l0.lat, lng: l0.lng } : null);
        const centro = ini ? [ini.lng, ini.lat] : [-54.6, -20.47];
        this.map = new maplibregl.Map({ container: id('Mapa'), style: ESTILO, center: centro, zoom: 14 });
        this.map.addControl(new maplibregl.NavigationControl(), 'top-right');
        this.map.on('load', () => {
          this.map.addSource('cerca', { type: 'geojson', data: circuloGeoJSON(centro[1], centro[0], this.raio) });
          this.map.addLayer({ id: 'cerca-fill', type: 'fill', source: 'cerca', paint: { 'fill-color': '#1d4ed8', 'fill-opacity': 0.15 } });
          this.map.addLayer({ id: 'cerca-linha', type: 'line', source: 'cerca', paint: { 'line-color': '#1d4ed8', 'line-width': 2 } });
          if (ini) this.definirCentro(ini.lat, ini.lng, false);
        });
        this.map.on('click', e => this.definirCentro(e.lngLat.lat, e.lngLat.lng, true));
      } catch (e) {
        const el = $(id('Mapa'));
        if (el) el.innerHTML = '<p class="nota" style="padding:20px;text-align:center">Não consegui carregar o mapa.</p>';
      }
    },

    definirCentro(lat, lng, mover) {
      this.centro = { lat, lng };
      // Mapa não subiu (WebGL indisponível na máquina): a cerca ainda vale, só
      // não dá para ver o pino. Busca por endereço e local salvo seguem úteis.
      if (!this.map) {
        const c0 = $(id('Coord'));
        if (c0) c0.textContent = 'Cerca em ' + lat.toFixed(5) + ', ' + lng.toFixed(5) + ' · raio ' + this.raio + ' m (sem mapa nesta máquina)';
        return;
      }
      if (!this.marcador) {
        this.marcador = new window.maplibregl.Marker({ color: '#1d4ed8', draggable: true }).setLngLat([lng, lat]).addTo(this.map);
        this.marcador.on('dragend', () => { const q = this.marcador.getLngLat(); this.definirCentro(q.lat, q.lng, false); });
      } else this.marcador.setLngLat([lng, lat]);
      if (mover) this.map.easeTo({ center: [lng, lat] });
      this.desenharCerca();
      const c = $(id('Coord'));
      if (c) c.textContent = 'Cerca em ' + lat.toFixed(5) + ', ' + lng.toFixed(5) + ' · raio ' + this.raio + ' m';
    },

    desenharCerca() {
      if (this.map && this.centro && this.map.getSource('cerca')) {
        this.map.getSource('cerca').setData(circuloGeoJSON(this.centro.lat, this.centro.lng, this.raio));
      }
    },

    /** Move o pino para um local salvo e adota o raio dele. */
    escolherLocal(localId) {
      const l = (this.rh.dados.locais || []).find(x => x.local_id === localId);
      if (!l) return;
      this.definirRaio(l.raio_m);
      this.definirCentro(l.lat, l.lng, true);
    },

    definirRaio(m) {
      this.raio = Number(m) || this.raio;
      const r = $(id('Raio')), v = $(id('RaioVal'));
      if (r) r.value = this.raio;
      if (v) v.textContent = this.raio;
      this.desenharCerca();
    },

    async buscar() {
      const texto = ($(id('Busca')).value || '').trim();
      if (!texto) return;
      this.esconderResultados();
      const coord = extrairCoordenadas(texto);
      if (coord && coord.erro) { toast(coord.erro, 'warn'); return; }
      if (coord) { this.definirCentro(coord.lat, coord.lng, true); toast('Ponto colado', 'ok'); return; }
      const btn = $(id('BuscarBtn')); btn.disabled = true; btn.textContent = '…';
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
      const box = $(id('Resultados'));
      box.innerHTML = lista.map((r, i) => '<button class="resultado" data-i="' + i + '">' + esc(r.display_name) + '</button>').join('');
      box.classList.remove('hide');
      box.querySelectorAll('button').forEach(b => {
        b.onclick = () => {
          const r = lista[Number(b.dataset.i)];
          this.definirCentro(parseFloat(r.lat), parseFloat(r.lon), true);
          this.esconderResultados();
          $(id('Busca')).value = r.display_name.split(',').slice(0, 2).join(',');
        };
      });
    },

    esconderResultados() { const b = $(id('Resultados')); if (b) { b.classList.add('hide'); b.innerHTML = ''; } },

    minhaLocalizacao() {
      if (!navigator.geolocation) { toast('Sem GPS', 'warn'); return; }
      const btn = $(id('Gps')); btn.disabled = true; btn.textContent = '…';
      navigator.geolocation.getCurrentPosition(
        q => { btn.disabled = false; btn.textContent = '📍'; this.definirCentro(q.coords.latitude, q.coords.longitude, true); },
        () => { btn.disabled = false; btn.textContent = '📍'; toast('Não consegui sua localização', 'bad'); },
        { enableHighAccuracy: true, timeout: 8000 });
    }
  };
}
