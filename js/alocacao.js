// Alocação diária + cerca virtual no mapa — o que o RH faz todo dia.
//
// Fluxo pensado para ser rápido no uso diário (ver docs/arquitetura-v4.md):
//   1. Escolhe o dia (default hoje) e a equipe.
//   2. Escolhe um LOCAL salvo (Obra Norte, Sede) — ou solta o pino no mapa e
//      salva como novo local. O círculo mostra o raio; arrasta pra ajustar.
//   3. Marca quem trabalha ali hoje (a equipe vem pré-marcada).
//   4. Salva. Uma chamada aloca todo mundo naquele ponto.
//
// MapLibre entra sob demanda (só quando a aba abre), como o Chart.js do painel —
// o celular do colaborador nunca baixa 800 KB de mapa.
import { ApiRh } from './api.js';
import { extrairCoordenadas } from './geo-parse.js';
import { $, esc, mostrar, toast } from './ui.js';

let _mapLibrePromise = null;
export function carregarMapLibre() {
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  if (_mapLibrePromise) return _mapLibrePromise;
  _mapLibrePromise = new Promise((res, rej) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = './vendor/maplibre-gl.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = './vendor/maplibre-gl.js';
    s.onload = () => res(window.maplibregl);
    s.onerror = rej;
    document.head.appendChild(s);
  });
  return _mapLibrePromise;
}

// Estilo raster do OpenStreetMap oficial — mapa mantido pela comunidade, livre,
// sem chave e sem marca d'água. Exige o cabeçalho Referer; por isso a
// Referrer-Policy do app é 'strict-origin-when-cross-origin' (envia só a origem
// para sites externos), não 'same-origin' — ver _headers/vercel.json.
export const ESTILO = {
  version: 8,
  sources: {
    base: {
      type: 'raster',
      tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
              'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
              'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap contributors'
    }
  },
  layers: [{ id: 'base', type: 'raster', source: 'base' }]
};

/** Círculo GeoJSON aproximado da cerca, para desenhar o raio no mapa. */
export function circuloGeoJSON(lat, lng, raioM, pontos = 64) {
  const coords = [];
  const dLat = raioM / 111320;
  const dLng = raioM / (111320 * Math.cos(lat * Math.PI / 180));
  for (let i = 0; i <= pontos; i++) {
    const t = (i / pontos) * 2 * Math.PI;
    coords.push([lng + dLng * Math.cos(t), lat + dLat * Math.sin(t)]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] } };
}

export const Alocacao = {
  rh: null,            // referência ao módulo Rh (dados + token)
  map: null,
  marcador: null,
  centro: null,        // { lat, lng }
  raio: 200,
  dia: null,
  equipeId: null,
  selecionados: new Set(),
  alvo: 'rh-alocacao', // elemento onde o editor é renderizado (modal ou seção)
  aoSalvar: null,      // callback após alocar/salvar (fecha modal, repinta cards)

  /**
   * Abre o EDITOR de alocação. Por padrão renderiza na seção da aba; o painel v2
   * passa `opts.alvo` (o corpo de um modal) e `opts.aoSalvar` (fechar+repintar).
   * `opts` pode pré-preencher dia/equipe/centro/raio/pessoas ao editar um card.
   */
  abrir(rh, opts) {
    opts = opts || {};
    this.rh = rh;
    this.alvo = opts.alvo || 'rh-alocacao';
    this.aoSalvar = opts.aoSalvar || null;
    this.dia = opts.dia || new Date().toISOString().slice(0, 10);
    const eqs = rh.dados.equipes || [];
    this.equipeId = opts.equipeId || (eqs[0] && eqs[0].equipe_id);
    this.centro = opts.centro || null;
    this.raio = opts.raio || 200;
    this.selecionados = opts.pessoas ? new Set(opts.pessoas) : new Set();
    this._preSelecao = !!opts.pessoas;   // não sobrescrever seleção vinda de edição
    this.map = null; this.marcador = null;
    this.pintar();
  },

  pintar() {
    const d = this.rh.dados;
    const eqs = d.equipes || [];
    const locais = d.locais || [];
    $(this.alvo).innerHTML =
      '<div class="card" style="margin:0;box-shadow:none;border:0">' +
        '<h2>Alocação do dia</h2>' +
        '<div class="alrow">' +
          '<div><label class="lb">Dia</label><input type="date" id="alDia" value="' + this.dia + '"></div>' +
          '<div><label class="lb">Equipe</label><select id="alEquipe">' +
            eqs.map(e => '<option value="' + e.equipe_id + '"' + (e.equipe_id === this.equipeId ? ' selected' : '') +
              '>' + esc(e.nome) + '</option>').join('') + '</select></div>' +
        '</div>' +
        '<label class="lb">Local (cerca)</label>' +
        '<select id="alLocal"><option value="">— escolha um local salvo ou defina abaixo —</option>' +
          locais.map(l => '<option value="' + l.local_id + '">' + esc(l.nome) + ' · ' + l.raio_m + 'm</option>').join('') +
        '</select>' +
        // Barra de localização: buscar endereço, colar coord/link do Maps, ou usar o GPS.
        '<div class="localbar">' +
          '<div class="buscabox">' +
            '<input type="text" id="alBusca" placeholder="🔍 Buscar endereço (rua, cidade)… ou colar coordenadas / link do Maps">' +
            '<button class="act ghost" id="btnBuscar" style="margin:0;width:auto">Buscar</button>' +
            '<button class="act ghost" id="btnMinhaLoc" title="Usar minha localização atual" style="margin:0;width:auto">📍</button>' +
          '</div>' +
          '<div id="alResultados" class="resultados hide"></div>' +
        '</div>' +
        '<div id="mapa" style="height:300px;border-radius:12px;overflow:hidden;margin:8px 0;background:var(--surface-2)"></div>' +
        '<div class="alrow">' +
          '<div style="flex:2"><label class="lb">Raio: <span id="alRaioVal" class="mono">' + this.raio + '</span> m</label>' +
            '<input type="range" id="alRaio" min="50" max="1000" step="10" value="' + this.raio + '"></div>' +
          '<div><label class="lb">&nbsp;</label><button class="act ghost" id="btnSalvarLocal" style="margin:0">Salvar local</button></div>' +
        '</div>' +
        '<p class="nota" id="alCoord">Toque no mapa para posicionar a cerca.</p>' +
      '</div>' +
      '<div class="card"><h2>Quem trabalha aqui hoje</h2>' +
        '<p class="nota" style="margin-bottom:8px">A equipe já vem marcada. Ajuste quem for remanejado.</p>' +
        '<div id="alPessoas" class="lista-check"></div>' +
        '<button class="act" id="btnAlocar">Alocar no mapa</button>' +
      '</div>';

    $('alDia').onchange = e => { this.dia = e.target.value; };
    $('alEquipe').onchange = e => { this.equipeId = e.target.value; this.marcarEquipe(); this.pintarPessoas(); };
    $('alLocal').onchange = e => this.escolherLocal(e.target.value);
    $('btnBuscar').onclick = () => this.buscar();
    $('alBusca').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); this.buscar(); } };
    $('btnMinhaLoc').onclick = () => this.minhaLocalizacao();
    $('alRaio').oninput = e => { this.raio = Number(e.target.value); $('alRaioVal').textContent = this.raio; this.desenharCerca(); };
    $('btnSalvarLocal').onclick = () => this.salvarLocal();
    $('btnAlocar').onclick = () => this.alocar();

    // Na abertura de edição, a seleção veio do card; não sobrescrever com o padrão.
    if (this._preSelecao) this._preSelecao = false; else this.marcarEquipe();
    this.pintarPessoas();
    this.iniciarMapa();
  },

  marcarEquipe() {
    // Pré-seleciona quem tem esta equipe como padrão.
    this.selecionados = new Set(
      (this.rh.dados.pessoas || []).filter(p => p.ativo && p.equipe_id === this.equipeId).map(p => p.pessoa_id));
  },

  pintarPessoas() {
    const pessoas = (this.rh.dados.pessoas || []).filter(p => p.ativo)
      .slice().sort((a, b) => a.nome.localeCompare(b.nome));
    $('alPessoas').innerHTML = pessoas.map(p =>
      '<label class="check"><input type="checkbox" data-id="' + p.pessoa_id + '"' +
        (this.selecionados.has(p.pessoa_id) ? ' checked' : '') + '>' +
        '<span>' + esc(p.nome) + '</span></label>').join('') || '<p class="nota">Nenhum colaborador ativo.</p>';
    $('alPessoas').querySelectorAll('input').forEach(c => {
      c.onchange = () => { c.checked ? this.selecionados.add(c.dataset.id) : this.selecionados.delete(c.dataset.id); };
    });
  },

  async iniciarMapa() {
    const box = $('mapa');
    try {
      const maplibregl = await carregarMapLibre();
      if (!$(this.alvo) || !$('mapa')) return;  // editor fechou enquanto carregava
      // Centro inicial: o que veio da edição, senão o primeiro local salvo, senão default.
      const l0 = (this.rh.dados.locais || [])[0];
      const ini = this.centro || (l0 ? { lat: l0.lat, lng: l0.lng } : null);
      const centro = ini ? [ini.lng, ini.lat] : [-54.6, -20.47];
      this.map = new maplibregl.Map({ container: 'mapa', style: ESTILO, center: centro, zoom: 14 });
      this.map.addControl(new maplibregl.NavigationControl(), 'top-right');
      this.map.on('load', () => {
        this.map.addSource('cerca', { type: 'geojson', data: circuloGeoJSON(centro[1], centro[0], this.raio) });
        this.map.addLayer({ id: 'cerca-fill', type: 'fill', source: 'cerca',
          paint: { 'fill-color': '#2d6cdf', 'fill-opacity': 0.15 } });
        this.map.addLayer({ id: 'cerca-linha', type: 'line', source: 'cerca',
          paint: { 'line-color': '#2d6cdf', 'line-width': 2 } });
        if (ini) this.definirCentro(ini.lat, ini.lng, false);
      });
      this.map.on('click', e => this.definirCentro(e.lngLat.lat, e.lngLat.lng, true));
    } catch (e) {
      box.innerHTML = '<p class="nota" style="padding:20px;text-align:center">Não consegui carregar o mapa. Verifique a conexão.</p>';
    }
  },

  definirCentro(lat, lng, moverCamera) {
    this.centro = { lat, lng };
    if (!this.marcador) {
      const maplibregl = window.maplibregl;
      this.marcador = new maplibregl.Marker({ color: '#2d6cdf', draggable: true }).setLngLat([lng, lat]).addTo(this.map);
      this.marcador.on('dragend', () => { const p = this.marcador.getLngLat(); this.definirCentro(p.lat, p.lng, false); });
    } else {
      this.marcador.setLngLat([lng, lat]);
    }
    if (moverCamera) this.map.easeTo({ center: [lng, lat] });
    this.desenharCerca();
    $('alCoord').textContent = 'Cerca em ' + lat.toFixed(5) + ', ' + lng.toFixed(5) + ' · raio ' + this.raio + ' m';
  },

  desenharCerca() {
    if (!this.map || !this.centro || !this.map.getSource('cerca')) return;
    this.map.getSource('cerca').setData(circuloGeoJSON(this.centro.lat, this.centro.lng, this.raio));
  },

  escolherLocal(localId) {
    const l = (this.rh.dados.locais || []).find(x => x.local_id === localId);
    if (!l) return;
    this.raio = l.raio_m;
    $('alRaio').value = l.raio_m; $('alRaioVal').textContent = l.raio_m;
    this.definirCentro(l.lat, l.lng, true);
  },

  /* --------------------------------------------- buscar / colar / GPS */

  /**
   * O que o RH digitou pode ser: (1) coordenadas coladas, (2) um link do Google
   * Maps, ou (3) um endereço para buscar. Tenta extrair coordenadas direto
   * primeiro (instantâneo, offline); se não for, geocodifica o texto como
   * endereço via Nominatim (comunidade OSM, grátis).
   */
  async buscar() {
    const texto = ($('alBusca').value || '').trim();
    if (!texto) return;
    this.esconderResultados();

    const coord = extrairCoordenadas(texto);
    if (coord && coord.erro) { toast(coord.erro, 'warn'); return; }
    if (coord) { this.definirCentro(coord.lat, coord.lng, true); toast('Ponto colado', 'ok'); return; }

    // Endereço → geocoding.
    const btn = $('btnBuscar'); btn.disabled = true; btn.textContent = '…';
    try {
      const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=5&addressdetails=0&q=' +
        encodeURIComponent(texto);
      const r = await fetch(url, { headers: { 'Accept-Language': 'pt-BR' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const lista = await r.json();
      if (!lista.length) { toast('Endereço não encontrado. Tente ser mais específico ou cole as coordenadas.', 'warn'); return; }
      this.mostrarResultados(lista);
    } catch (e) {
      toast('Busca indisponível agora. Cole as coordenadas (ex.: -20.46, -54.62).', 'bad');
    } finally { btn.disabled = false; btn.textContent = 'Buscar'; }
  },

  mostrarResultados(lista) {
    const box = $('alResultados');
    box.innerHTML = lista.map((r, i) =>
      '<button class="resultado" data-i="' + i + '">' + esc(r.display_name) + '</button>').join('');
    box.classList.remove('hide');
    box.querySelectorAll('button').forEach(b => {
      b.onclick = () => {
        const r = lista[Number(b.dataset.i)];
        this.definirCentro(parseFloat(r.lat), parseFloat(r.lon), true);
        this.esconderResultados();
        $('alBusca').value = r.display_name.split(',').slice(0, 2).join(',');
      };
    });
  },

  esconderResultados() {
    const box = $('alResultados');
    if (box) { box.classList.add('hide'); box.innerHTML = ''; }
  },

  minhaLocalizacao() {
    if (!navigator.geolocation) { toast('Sem GPS neste dispositivo', 'warn'); return; }
    const btn = $('btnMinhaLoc'); btn.disabled = true; btn.textContent = '…';
    navigator.geolocation.getCurrentPosition(
      p => { btn.disabled = false; btn.textContent = '📍';
        this.definirCentro(p.coords.latitude, p.coords.longitude, true); toast('No seu local atual', 'ok'); },
      () => { btn.disabled = false; btn.textContent = '📍'; toast('Não consegui obter sua localização', 'bad'); },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 });
  },

  async salvarLocal() {
    if (!this.centro) { toast('Toque no mapa para posicionar a cerca primeiro', 'warn'); return; }
    const nome = prompt('Nome do local (ex.: Obra Norte):');
    if (!nome) return;
    const r = await ApiRh.local(this.rh.token, { nome, lat: this.centro.lat, lng: this.centro.lng, raio_m: this.raio });
    if (!r.ok) { toast(r.erro || 'Falha ao salvar local', 'bad'); return; }
    toast('Local salvo', 'ok');
    // Recarrega os dados (novo local na lista) mas NÃO troca de aba — o editor
    // pode estar num modal. Só reinsere o novo local no select, se ele existe.
    const d = await ApiRh.dados(this.rh.token, this.rh.dias);
    if (d.ok) this.rh.dados = d.dados;
    const sel = $('alLocal');
    if (sel) {
      const locais = (this.rh.dados.locais || []);
      sel.innerHTML = '<option value="">— escolha um local salvo ou defina abaixo —</option>' +
        locais.map(l => '<option value="' + l.local_id + '">' + esc(l.nome) + ' · ' + l.raio_m + 'm</option>').join('');
    }
  },

  async alocar() {
    if (!this.centro) { toast('Defina a cerca no mapa', 'warn'); return; }
    if (!this.equipeId) { toast('Escolha a equipe', 'warn'); return; }
    if (!this.selecionados.size) { toast('Marque ao menos um colaborador', 'warn'); return; }
    const btn = $('btnAlocar'); btn.disabled = true; btn.textContent = 'Alocando…';
    const r = await ApiRh.alocar(this.rh.token, {
      dia: this.dia, equipe_id: this.equipeId,
      cerca: { lat: this.centro.lat, lng: this.centro.lng, raio_m: this.raio },
      colaboradores: [...this.selecionados]
    });
    btn.disabled = false; btn.textContent = 'Alocar no mapa';
    if (!r.ok) { toast(r.erro || 'Falha ao alocar', 'bad'); return; }
    toast(r.dados.gravadas + ' colaborador(es) alocado(s) para ' + this.dia, 'ok');
    if (this.aoSalvar) this.aoSalvar();   // fecha o modal e repinta os cards
  }
};
