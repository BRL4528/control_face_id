// Mapa operacional do dia: todas as cercas ativas hoje + os pinos das marcações,
// verde (dentro da cerca) ou vermelho (fora). Reaproveita o carregador e o estilo
// do editor de alocação — não duplica a infra de mapa.
import { carregarMapLibre, ESTILO, circuloGeoJSON } from './alocacao.js';
import { $, esc, hora } from './ui.js';

export const MapaOp = {
  map: null,

  /** Desenha o mapa dentro de #mapaOp com os dados de hoje do painel Rh. */
  async abrir(rh) {
    const box = $('mapaOp');
    if (!box) return;
    try {
      const maplibregl = await carregarMapLibre();
      if (!$('mapaOp')) return;   // trocou de aba enquanto carregava

      const alocs = rh.dados.alocacoes_hoje || [];
      const hoje = rh.hojeServidor();
      const marcs = (rh.dados.marcacoes || []).filter(m =>
        String(m.marcado_dia).slice(0, 10) === hoje && m.lat != null && m.lng != null);

      // Uma cerca por equipe (várias alocações da mesma equipe compartilham a cerca).
      const cercas = [];
      const vistas = new Set();
      for (const a of alocs) {
        if (vistas.has(a.equipe_id)) continue;
        vistas.add(a.equipe_id);
        cercas.push({ equipe_id: a.equipe_id, lat: Number(a.cerca_lat), lng: Number(a.cerca_lng), raio: Number(a.cerca_raio_m) || 200,
                      pessoas: alocs.filter(x => x.equipe_id === a.equipe_id).length });
      }

      // Enquadramento: todas as cercas (com o raio) + todos os pinos. Sem nada, MS.
      const bounds = new maplibregl.LngLatBounds();
      for (const c of cercas) {
        const dLat = c.raio / 111320, dLng = c.raio / (111320 * Math.cos(c.lat * Math.PI / 180));
        bounds.extend([c.lng - dLng, c.lat - dLat]); bounds.extend([c.lng + dLng, c.lat + dLat]);
      }
      for (const m of marcs) bounds.extend([m.lng, m.lat]);
      const temAlgo = cercas.length || marcs.length;

      this.map = new maplibregl.Map({ container: 'mapaOp', style: ESTILO, center: [-54.6, -20.47], zoom: 12 });
      this.map.addControl(new maplibregl.NavigationControl(), 'top-right');
      if (temAlgo) this.map.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: 0 });

      if (!temAlgo) {
        box.insertAdjacentHTML('beforeend', '<div class="mapa-vazio">Nenhuma cerca ativa hoje (' + esc(rh.dataLonga(hoje)) +
          '). Crie uma escala para a equipe aparecer aqui.</div>');
      } else if (!marcs.length) {
        box.insertAdjacentHTML('beforeend', '<div class="mapa-vazio">' + cercas.length + ' cerca(s) ativa(s) hoje · nenhum ponto com GPS registrado ainda.</div>');
      }

      this.map.on('load', () => {
        if (cercas.length) {
          const feats = cercas.map(c => Object.assign(circuloGeoJSON(c.lat, c.lng, c.raio),
            { properties: { equipe: rh.nomeEquipe(c.equipe_id), raio: c.raio, pessoas: c.pessoas } }));
          this.map.addSource('cercas', { type: 'geojson', data: { type: 'FeatureCollection', features: feats } });
          this.map.addLayer({ id: 'cercas-fill', type: 'fill', source: 'cercas',
            paint: { 'fill-color': '#1d4ed8', 'fill-opacity': 0.12 } });
          this.map.addLayer({ id: 'cercas-linha', type: 'line', source: 'cercas',
            paint: { 'line-color': '#1d4ed8', 'line-width': 2, 'line-dasharray': [2, 1] } });
          // Rótulo da equipe no centro da cerca — como elemento HTML: o estilo base é
          // raster sem `glyphs`, e a CSP não deixaria buscar fontes de um servidor externo.
          for (const c of cercas) {
            const el = document.createElement('div');
            el.className = 'mapa-rotulo';
            el.textContent = rh.nomeEquipe(c.equipe_id) + ' · ' + c.pessoas + ' pessoa(s) · ' + c.raio + ' m';
            new maplibregl.Marker({ element: el, anchor: 'top', offset: [0, 6] }).setLngLat([c.lng, c.lat]).addTo(this.map);
          }
        }
        // Pinos das marcações.
        for (const m of marcs) {
          const cor = m.dentro_cerca === false ? '#b42318' : '#12805c';
          const nome = rh.nomeDe(m.pessoa_id);
          const popup = new maplibregl.Popup({ offset: 18 }).setHTML(
            '<div style="font:13px system-ui;padding:2px 2px"><b>' + esc(nome) + '</b><br>' +
            (m.tipo === 'entrada' ? 'Entrada' : 'Saída') + ' ' + esc(hora(m.marcado_em)) +
            (m.dentro_cerca === false ? '<br><span style="color:#b42318">fora da cerca' +
              (m.distancia_cerca_m != null ? ' · ' + Math.round(m.distancia_cerca_m) + ' m' : '') + '</span>' : '') + '</div>');
          new maplibregl.Marker({ color: cor }).setLngLat([m.lng, m.lat]).setPopup(popup).addTo(this.map);
        }
      });
    } catch (e) {
      box.innerHTML = '<p style="padding:24px;text-align:center;color:#64748b">Não consegui carregar o mapa. Verifique a conexão.</p>';
    }
  }
};
