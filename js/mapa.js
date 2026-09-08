// Mapa operacional do dia: todas as cercas ativas hoje + os pinos das marcações,
// verde (dentro da cerca) ou vermelho (fora). Reaproveita o carregador e o estilo
// do editor de alocação — não duplica a infra de mapa.
import { carregarMapLibre, ESTILO, circuloGeoJSON } from './alocacao.js';
import { $ } from './ui.js';

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
      const hoje = String(rh.dados.servidor_hora || '').slice(0, 10) ||
                   new Date().toISOString().slice(0, 10);
      const marcs = (rh.dados.marcacoes || []).filter(m =>
        m.marcado_dia === hoje && m.lat != null && m.lng != null);

      // Centro: média das cercas, senão primeira marcação, senão default MS.
      const pontos = alocs.map(a => [a.cerca_lng, a.cerca_lat])
        .concat(marcs.map(m => [m.lng, m.lat]));
      const centro = pontos.length
        ? [pontos.reduce((s, p) => s + p[0], 0) / pontos.length,
           pontos.reduce((s, p) => s + p[1], 0) / pontos.length]
        : [-54.6, -20.47];

      this.map = new maplibregl.Map({ container: 'mapaOp', style: ESTILO, center: centro, zoom: 13 });
      this.map.addControl(new maplibregl.NavigationControl(), 'top-right');

      this.map.on('load', () => {
        // Uma cerca por equipe (dedup: várias alocações da mesma equipe compartilham).
        const vistas = new Set();
        const feats = [];
        for (const a of alocs) {
          if (vistas.has(a.equipe_id)) continue;
          vistas.add(a.equipe_id);
          feats.push(circuloGeoJSON(a.cerca_lat, a.cerca_lng, a.cerca_raio_m));
        }
        if (feats.length) {
          this.map.addSource('cercas', { type: 'geojson', data: { type: 'FeatureCollection', features: feats } });
          this.map.addLayer({ id: 'cercas-fill', type: 'fill', source: 'cercas',
            paint: { 'fill-color': '#1d4ed8', 'fill-opacity': 0.10 } });
          this.map.addLayer({ id: 'cercas-linha', type: 'line', source: 'cercas',
            paint: { 'line-color': '#1d4ed8', 'line-width': 1.5, 'line-dasharray': [2, 1] } });
        }
        // Pinos das marcações.
        for (const m of marcs) {
          const cor = m.dentro_cerca === false ? '#b42318' : '#12805c';
          const pessoa = (rh.dados.pessoas || []).find(p => p.pessoa_id === m.pessoa_id);
          const nome = pessoa ? pessoa.nome : m.pessoa_id;
          const popup = new maplibregl.Popup({ offset: 18 }).setHTML(
            '<div style="font:13px system-ui;padding:2px 2px"><b>' + esc(nome) + '</b><br>' +
            (m.tipo === 'entrada' ? 'Entrada' : 'Saída') + ' ' + String(m.marcado_em).slice(11, 16) +
            (m.dentro_cerca === false ? '<br><span style="color:#b42318">fora da cerca</span>' : '') + '</div>');
          new maplibregl.Marker({ color: cor }).setLngLat([m.lng, m.lat]).setPopup(popup).addTo(this.map);
        }
      });
    } catch (e) {
      box.innerHTML = '<p style="padding:24px;text-align:center;color:#64748b">Não consegui carregar o mapa. Verifique a conexão.</p>';
    }
  }
};

// Escape local (o popup recebe nome do colaborador — sempre escapar).
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}
