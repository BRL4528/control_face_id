// Utilidades de tela compartilhadas pelas três áreas.
export const $ = id => document.getElementById(id);

export const esc = s => {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
};

// Acesso do RH: fica fora do rodízio exclusivo abaixo. Só aparece na porta —
// nas outras telas ou já é o próprio RH, ou é o colaborador no meio do ponto.
const ACESSO_RH_VISIVEL = new Set(['porta']);
const TELAS = ['porta', 'pareamento', 'fila', 'rh', 'loginRh'];

export function mostrar(tela) {
  TELAS.forEach(t => { const el = $(t); if (el) el.classList.toggle('hide', t !== tela); });
  $('btnAcessar').classList.toggle('hide', !ACESSO_RH_VISIVEL.has(tela));
}

let tid = null;
export function toast(msg, tipo) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast ' + (tipo || '');
  clearTimeout(tid);
  tid = setTimeout(() => t.classList.add('hide'), 3400);
}

export const hora = iso => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
export const data = iso => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
