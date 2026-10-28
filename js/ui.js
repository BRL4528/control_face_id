// Utilidades de tela compartilhadas pelas três áreas.
import { horaNoFuso } from './regras.js';

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

// Hora sempre no relógio da empresa: o RH pode estar em outro fuso (ex.: Brasília
// olhando Campo Grande) e a batida tem de aparecer como o colaborador viu no celular.
let fusoEmpresa = null;
export const definirFuso = fuso => { fusoEmpresa = fuso || null; };
export const hora = iso => horaNoFuso(iso, fusoEmpresa);
export const data = iso => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
