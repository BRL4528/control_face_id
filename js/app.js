// Porta de entrada e roteamento.
//
// Duas portas separadas de propósito: o gestor com 20 pessoas na fila nunca vê
// as opções de administração, e o RH nunca precisa do aparelho do campo.
import { Store } from './store.js';
import { Api, ApiRh } from './api.js';
import { Face } from './face.js';
import { cargaValida } from './regras.js';
import { Fila } from './fila.js';
import { Rh } from './rh.js';
import { $, mostrar, toast } from './ui.js';

const cfg = () => window.EFRAT_CFG;
const S = { token: null, carga: null, deriva: 0, persistido: false };

/* ------------------------------------------------------------- porta */

function statusPorta(txt, classe) {
  $('portaStatus').textContent = txt || '';
  $('portaStatus').className = 'nota ' + (classe || '');
}

async function irParaPorta() {
  mostrar('porta');
  S.token = await Store.get('token');
  const pareado = !!S.token;
  $('btnPonto').disabled = !pareado || !Face.pronto;
  $('btnParear').textContent = pareado ? 'Trocar o pareamento deste aparelho' : 'Parear este aparelho';
  const fila = await Store.fila();
  if (!pareado) statusPorta('Aparelho ainda não pareado.', 'warnfg');
  else if (!Face.pronto) statusPorta('Carregando o reconhecimento…');
  else if (fila.length) statusPorta(fila.length + ' marcação(ões) esperando envio.', 'warnfg');
  else statusPorta('');
  if (pareado && navigator.onLine) sincronizarFundo();
}

async function sincronizarFundo() {
  const t = await Store.get('token');
  if (!t) return;
  await Api.sincronizar(t);
  const fila = await Store.fila();
  if (!$('porta').classList.contains('hide')) {
    statusPorta(fila.length ? fila.length + ' marcação(ões) esperando envio.' : '', fila.length ? 'warnfg' : '');
  }
}

/* ------------------------------------------------- registrar ponto */

async function abrirFila() {
  if (!S.token) { toast('Pareie o aparelho primeiro', 'warn'); return; }
  $('btnPonto').disabled = true;
  try {
    let carga = await Store.get('carga');
    let deriva = (await Store.get('deriva')) || 0;

    if (navigator.onLine) {
      const r = await Api.carga(S.token);
      if (r.ok) {
        carga = r.carga; deriva = r.deriva;
        await Store.set('carga', carga);
        await Store.set('deriva', deriva);
      } else if (!carga) {
        toast(r.erro || 'Não consegui carregar a equipe', 'bad');
        return;
      } else {
        toast('Sem rede — usando a carga de hoje', 'warn');
      }
    }

    if (!carga || !cargaValida(carga)) {
      toast('A carga de hoje ainda não foi baixada. Conecte à internet uma vez.', 'bad');
      return;
    }
    if (!(carga.pessoas || []).some(p => p.papel === 'gestor')) {
      toast('Nenhum gestor com biometria nesta unidade. O RH precisa cadastrar.', 'bad');
      return;
    }
    if (Math.abs(deriva) > 120000) {
      toast('Relógio do aparelho está ' + Math.round(deriva / 60000) + ' min fora', 'warn');
    }

    S.carga = carga; S.deriva = deriva;
    await Fila.abrir(S.token, carga, deriva, irParaPorta);
  } finally {
    $('btnPonto').disabled = false;
  }
}

/* -------------------------------------------------------- acesso RH */

function abrirLoginRh() {
  mostrar('loginRh');
  $('rhSenha').value = '';
  setTimeout(() => $('rhUsuario').focus(), 100);
}

async function entrarRh() {
  const u = $('rhUsuario').value.trim();
  const s = $('rhSenha').value;
  if (!u || !s) { toast('Informe usuário e senha', 'warn'); return; }
  $('btnEntrarRh').disabled = true;
  $('btnEntrarRh').textContent = 'Entrando…';
  try {
    const r = await Rh.entrar(u, s);
    if (!r.ok) { toast(r.erro, 'bad'); return; }
    Rh._tokenAparelho = S.token || (await Store.get('token'));
    Rh.abrir(irParaPorta);
  } finally {
    $('btnEntrarRh').disabled = false;
    $('btnEntrarRh').textContent = 'Entrar';
  }
}

/* ------------------------------------------------------- pareamento */

async function parear() {
  const t = $('tokenAparelho').value.trim();
  if (!t) { toast('Informe o token', 'warn'); return; }
  $('btnParearOk').disabled = true;
  try {
    const r = await Api.carga(t);
    if (!r.ok) { toast(r.erro || 'Token inválido', 'bad'); return; }
    await Store.set('token', t);
    await Store.set('carga', r.carga);
    await Store.set('deriva', r.deriva);
    await Store.registrar('pareamento', { gestor: r.carga.gestor && r.carga.gestor.nome });
    toast('Aparelho pareado', 'ok');
    $('tokenAparelho').value = '';
    await irParaPorta();
  } finally {
    $('btnParearOk').disabled = false;
  }
}

/* -------------------------------------------------------------- boot */

async function boot() {
  S.persistido = await Store.fixar();

  $('btnPonto').onclick = abrirFila;
  $('btnAcessar').onclick = abrirLoginRh;
  $('btnParear').onclick = () => { mostrar('pareamento'); setTimeout(() => $('tokenAparelho').focus(), 100); };
  $('btnParearOk').onclick = parear;
  $('btnParearVoltar').onclick = irParaPorta;
  $('btnVoltarPorta').onclick = irParaPorta;
  $('btnEntrarRh').onclick = entrarRh;
  $('rhSenha').addEventListener('keydown', e => { if (e.key === 'Enter') entrarRh(); });
  $('tokenAparelho').addEventListener('keydown', e => { if (e.key === 'Enter') parear(); });
  $('btnSairFila').onclick = () => Fila.sair();

  window.addEventListener('online', sincronizarFundo);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sincronizarFundo(); });
  setInterval(sincronizarFundo, cfg().syncIntervalMs);

  await irParaPorta();

  try {
    await Face.carregar('./models');
  } catch (e) {
    statusPorta('Falha ao carregar o reconhecimento.', 'badfg');
  }
  await irParaPorta();

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// Superfície de teste: o E2E dirige o app por aqui em vez de depender de
// tempo de câmera e de rosto real.
window.__EFRAT = { S, Store, Api, ApiRh, Face, Fila, Rh, irParaPorta, abrirFila, sincronizarFundo };

boot();
