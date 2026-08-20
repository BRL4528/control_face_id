// Utilidades de tela compartilhadas pelas três áreas.
export const $ = id => document.getElementById(id);

export const esc = s => {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
};

// Acesso do RH (T-E3DBD4): fica de fora do rodízio exclusivo abaixo de
// propósito. É alcançável com o aparelho pendente OU aprovado — nunca durante
// fila/rh/loginRh/painelGestor, onde já teria alternativa própria (ou já é o
// próprio RH).
const ACESSO_RH_VISIVEL = new Set(['porta', 'aguardando']);

export function mostrar(tela) {
  ['porta', 'aguardando', 'fila', 'rh', 'loginRh', 'painelGestor'].forEach(t => {
    $(t).classList.toggle('hide', t !== tela);
  });
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
