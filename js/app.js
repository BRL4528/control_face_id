// Porta de entrada e roteamento — v4 (produto).
//
// O celular é do colaborador. No primeiro acesso ele PAREIA (informa a matrícula
// uma vez + captura a face que o RH já cadastrou) e gera a credencial de 256
// bits, guardada só no IndexedDB. Depois disso o app abre direto no ponto: olhar
// para a câmera, piscar, pronto. Zero senha no dia a dia.
//
// Duas portas continuam separadas: quem bate ponto nunca vê administração, e o
// RH entra por usuário+senha (independente do pareamento do aparelho).
import { Store } from './store.js';
import { Api, ApiRh } from './api.js';
import { Face } from './face.js';
import { Ponto } from './ponto.js';
import { Rh } from './rh.js';
import { $, mostrar, toast } from './ui.js';

const cfg = () => window.EFRAT_CFG;
const S = { dispositivo: null, carga: null };

/* --------------------------------------------- identidade do aparelho */

function base64Url(bytes) {
  let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function gerarCredencial() { return base64Url(crypto.getRandomValues(new Uint8Array(32))); }

/** Já pareado? Devolve { dispositivo_id, credencial, colaborador } ou null. */
async function identidadeSalva() {
  const id = await Store.get('dispositivo_id');
  const cred = await Store.get('credencial');
  const col = await Store.get('colaborador');
  if (id && cred && col) return { dispositivo_id: id, credencial: cred, colaborador: col };
  return null;
}

/* --------------------------------------------------------- porta */

function statusPorta(txt, classe) {
  $('portaStatus').textContent = txt || '';
  $('portaStatus').className = 'nota ' + (classe || '');
}

async function irParaPorta() {
  mostrar('porta');
  // Aviso de navegador embutido tem prioridade e persiste — sem câmera, nada
  // funciona, então essa mensagem não pode ser sobrescrita pelo status normal.
  if (S.navegadorEmbutido) { avisarNavegadorEmbutido(); $('btnPonto').disabled = false; return; }
  const pareado = !!S.dispositivo;
  $('btnPonto').textContent = pareado ? 'REGISTRAR PONTO' : 'ATIVAR MEU PONTO';
  // O botão NUNCA fica preso: sempre dá pra tocar. Se o reconhecimento ainda
  // não carregou, o próprio fluxo do toque espera/avisa — antes o botão morto
  // deixava a pessoa presa no celular quando o modelo demorava a baixar.
  $('btnPonto').disabled = false;
  let fila = [];
  try { fila = await Store.fila(); } catch (e) { /* storage bloqueado — segue */ }
  if (!Face.pronto) statusPorta('Preparando o reconhecimento… já pode tocar.');
  else if (!pareado) statusPorta('Primeira vez? Toque para ativar seu ponto.');
  else if (fila.length) statusPorta(fila.length + ' marcação(ões) esperando envio.', 'warnfg');
  else statusPorta('Olá, ' + S.dispositivo.colaborador.nome.split(' ')[0] + '.');
  if (pareado && navigator.onLine) sincronizarFundo();
}

async function sincronizarFundo() {
  if (!S.dispositivo) return;
  await Api.sincronizar(S.dispositivo.credencial);
  const fila = await Store.fila();
  if (!$('porta').classList.contains('hide')) {
    statusPorta(fila.length ? fila.length + ' marcação(ões) esperando envio.' : '', fila.length ? 'warnfg' : '');
  }
}

/* ------------------------------------------------- pareamento inicial */

function abrirPareamento() {
  mostrar('pareamento');
  setTimeout(() => $('pareEmpresa') && $('pareEmpresa').focus(), 100);
  $('btnParear').onclick = executarPareamento;
}

async function executarPareamento() {
  const empresa_id = ($('pareEmpresa').value || '').trim();
  const matricula = ($('pareMatricula').value || '').trim();
  if (!empresa_id || !matricula) { toast('Informe empresa e matrícula', 'warn'); return; }
  $('btnParear').disabled = true; $('btnParear').textContent = 'Ativando…';
  try {
    const dispositivo_id = crypto.randomUUID();
    const credencial = gerarCredencial();
    const r = await Api.parear({ empresa_id, matricula, dispositivo_id, credencial,
      apelido: 'Celular de ' + matricula, ua: navigator.userAgent });
    if (!r.ok) { toast(r.erro || 'Falha ao ativar', 'bad'); return; }
    await Store.set('dispositivo_id', dispositivo_id);
    await Store.set('credencial', credencial);
    await Store.set('empresa_id', empresa_id);
    await Store.set('colaborador', r.colaborador);
    S.dispositivo = { dispositivo_id, credencial, colaborador: r.colaborador };
    toast('Ponto ativado. Bem-vindo, ' + r.colaborador.nome.split(' ')[0] + '!', 'ok');
    await irParaPorta();
  } finally {
    $('btnParear').disabled = false; $('btnParear').textContent = 'Ativar';
  }
}

/* ------------------------------------------------- registrar ponto */

// Espera o reconhecimento ficar pronto, com teto de tempo. No celular o modelo
// (6 MB) pode demorar; em vez de um botão morto, mostramos progresso e só
// desistimos após o timeout, com mensagem clara.
async function esperarFace(timeoutMs) {
  if (Face.pronto) return true;
  const ate = Date.now() + (timeoutMs || 25000);
  while (!Face.pronto && Date.now() < ate) {
    if (Face.falhou) return false;
    await new Promise(r => setTimeout(r, 300));
  }
  return Face.pronto;
}

async function abrirPonto() {
  if (!S.dispositivo) return abrirPareamento();
  $('btnPonto').disabled = true;
  try {
    if (!Face.pronto) {
      statusPorta('Carregando o reconhecimento facial (pode levar alguns segundos no celular)…');
      const ok = await esperarFace(25000);
      if (!ok) {
        statusPorta('Não consegui carregar o reconhecimento. Verifique a conexão e toque de novo.', 'badfg');
        return;
      }
      statusPorta('');
    }
    let template = await Store.get('template');
    let alocacao = await Store.get('alocacao');
    let deriva = (await Store.get('deriva')) || 0;

    if (navigator.onLine) {
      const r = await Api.cargaDia(S.dispositivo.credencial);
      if (r.ok) {
        template = r.template; alocacao = r.alocacao; deriva = r.deriva;
        await Store.set('template', template);
        await Store.set('alocacao', alocacao);
        await Store.set('deriva', deriva);
      } else if (r.status === 401) {
        toast('Este aparelho foi desvinculado. Ative de novo.', 'warn');
        await desparear(); return abrirPareamento();
      } else if (!template) {
        toast(r.erro || 'Não consegui carregar seus dados', 'bad'); return;
      } else {
        toast('Sem rede — usando os dados salvos', 'warn');
      }
    }
    if (!template) { toast('Seu cadastro facial ainda não foi feito. Procure o RH.', 'bad'); return; }
    await Ponto.abrir(S.dispositivo, { template, alocacao, deriva }, irParaPorta);
  } finally {
    $('btnPonto').disabled = false;
  }
}

async function desparear() {
  await Store.set('dispositivo_id', null);
  await Store.set('credencial', null);
  await Store.set('colaborador', null);
  S.dispositivo = null;
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
  $('btnEntrarRh').disabled = true; $('btnEntrarRh').textContent = 'Entrando…';
  try {
    const r = await Rh.entrar(u, s);
    if (!r.ok) { toast(r.erro, 'bad'); return; }
    Rh.abrir(() => irParaPorta());
  } finally {
    $('btnEntrarRh').disabled = false; $('btnEntrarRh').textContent = 'Entrar';
  }
}

/* -------------------------------------------------------------- boot */

async function boot() {
  // ORDEM CRÍTICA: ligar os botões ANTES de qualquer await de storage. No
  // navegador embutido do WhatsApp/Instagram o IndexedDB pode estar bloqueado e
  // lançar — se isso acontecesse antes daqui, os botões ficavam sem onclick e a
  // tela travava (só o botão, sem reação ao toque). Nada de storage bloqueia a
  // interface agora.
  $('btnPonto').onclick = abrirPonto;
  $('btnAcessar').onclick = abrirLoginRh;
  $('btnAcessar').classList.remove('hide');
  $('btnEntrarRh').onclick = entrarRh;
  $('rhSenha').addEventListener('keydown', e => { if (e.key === 'Enter') entrarRh(); });
  $('btnVoltarPorta').onclick = () => irParaPorta();
  $('btnVoltarPortaRh').onclick = () => irParaPorta();
  $('btnSairFila').onclick = () => Ponto.sair();

  window.addEventListener('online', () => sincronizarFundo());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sincronizarFundo(); });

  // Storage é best-effort: se falhar, o app segue (não pareado) em vez de travar.
  try { await Store.fixar(); } catch (e) { /* persist bloqueado — segue */ }
  try { S.dispositivo = await identidadeSalva(); } catch (e) { S.dispositivo = null; }

  try { setInterval(() => sincronizarFundo(), cfg().syncIntervalMs); } catch (e) { /* ok */ }

  avisarNavegadorEmbutido();   // define S.navegadorEmbutido antes de pintar a porta
  await irParaPorta();
  if (!S.navegadorEmbutido) carregarFaceComRetry();   // sem câmera não adianta baixar modelo

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// O navegador embutido do WhatsApp/Instagram/Facebook bloqueia a câmera e o
// storage. Detecta e orienta a abrir no navegador de verdade (Safari/Chrome),
// porque sem câmera o ponto facial simplesmente não funciona.
function avisarNavegadorEmbutido() {
  const ua = navigator.userAgent || '';
  const embutido = /(FBAN|FBAV|Instagram|Line|WhatsApp|GSA)/i.test(ua) || /\bwv\b/.test(ua);
  S.navegadorEmbutido = embutido;
  if (embutido) {
    statusPorta('⚠ Abra no navegador (Safari/Chrome) para a câmera funcionar. Toque no botão de compartilhar/⋯ e escolha "Abrir no navegador".', 'badfg');
  }
}

// Rede de segurança final: se QUALQUER coisa no boot lançar, os botões básicos
// ainda respondem. Sem isso, um erro inesperado deixa a tela morta.
window.addEventListener('error', () => {
  const b = document.getElementById('btnPonto');
  if (b && !b.onclick) b.onclick = abrirPonto;
});

// Carrega o reconhecimento em segundo plano, com algumas tentativas. Uma falha
// (rede ruim no celular) não é permanente: tenta de novo, e o toque no botão
// espera via esperarFace(). Não derruba a tela.
async function carregarFaceComRetry() {
  for (let tentativa = 0; tentativa < 3 && !Face.pronto; tentativa++) {
    try { await Face.carregar('./models'); }
    catch (e) { Face.falhou = false; await new Promise(r => setTimeout(r, 1500 * (tentativa + 1))); }
  }
  await irParaPorta();
}

// Superfície de teste.
window.__EFRAT = { S, Store, Api, ApiRh, Face, Ponto, Rh, irParaPorta, abrirPonto };

boot();
