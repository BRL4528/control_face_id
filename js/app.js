// Porta de entrada e roteamento.
//
// v3 (docs/adr-acesso-v3.md): o aparelho não pede token. No primeiro acesso
// ele gera sua própria identidade (UUID + credencial de 256 bits) e pede
// liberação ao RH; a credencial nunca aparece na tela. Duas portas separadas
// continuam de propósito: quem bate ponto nunca vê administração, e o RH
// nunca precisa do aparelho do campo.
import { Store } from './store.js';
import { Api, ApiRh, ApiGestor } from './api.js';
import { Face } from './face.js';
import { Fila } from './fila.js';
import { Rh } from './rh.js';
import { Gestor } from './gestor.js';
import { $, mostrar, toast } from './ui.js';

const cfg = () => window.EFRAT_CFG;
// `emRh` (T-E3DBD4): true do momento em que "Acessar RH" é tocado até sair —
// suspende o poll de fundo de verificarDispositivo() pra ele não arrancar a
// tela do RH debaixo do usuário no meio do login/painel.
const S = { dispositivo: null, deriva: 0, persistido: false, pollTimer: null, emRh: false };

/* --------------------------------------------- identidade do aparelho */

// UUID + credencial de 256 bits, gerados uma vez e guardados no IndexedDB
// (docs/adr-acesso-v3.md). A credencial é segredo de máquina — nunca aparece
// na interface, só viaja como Authorization: Bearer. `hashCredencial` tem
// que produzir exatamente o que `crypto.createHash('sha256').update(String(v))
// .digest('base64url')` produz no Node, senão a comparação do servidor nunca bate.
// Não fica em js/cripto.js de propósito: aquele arquivo é só a derivação de
// senha do RH e ninguém mexe nele nesta rodada.
function base64Url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function gerarDispositivoId() { return crypto.randomUUID(); }
function gerarCredencial() { return base64Url(crypto.getRandomValues(new Uint8Array(32))); }
async function hashCredencial(credencial) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(credencial));
  return base64Url(new Uint8Array(digest));
}

/* ------------------------------------------------------------- porta */

function statusPorta(txt, classe) {
  $('portaStatus').textContent = txt || '';
  $('portaStatus').className = 'nota ' + (classe || '');
}

async function irParaPorta() {
  mostrar('porta');
  limparCodigoAguardando();
  $('btnPonto').disabled = !Face.pronto;
  const fila = await Store.fila();
  if (!Face.pronto) statusPorta('Carregando o reconhecimento…');
  else if (fila.length) statusPorta(fila.length + ' marcação(ões) esperando envio.', 'warnfg');
  else statusPorta('');
  if (navigator.onLine) sincronizarFundo();
}

async function sincronizarFundo() {
  if (!S.dispositivo) return;
  await Api.sincronizar(S.dispositivo.dispositivo_id, S.dispositivo.credencial);
  const fila = await Store.fila();
  if (!$('porta').classList.contains('hide')) {
    statusPorta(fila.length ? fila.length + ' marcação(ões) esperando envio.' : '', fila.length ? 'warnfg' : '');
  }
}

/* --------------------------------------------------- identidade v3 */

/**
 * Garante que o aparelho tem UUID + credencial no IndexedDB, cadastrando no
 * servidor se ainda não tiver. Migra um token legado (v2) uma única vez,
 * conforme docs/adr-acesso-v3.md — sem perder marcação ainda não enviada se
 * a migração falhar.
 */
async function assegurarIdentidade() {
  const idExistente = await Store.get('dispositivo_id');
  const credencialExistente = await Store.get('credencial');
  if (idExistente && credencialExistente) {
    return { dispositivo_id: idExistente, credencial: credencialExistente };
  }

  const dispositivoId = gerarDispositivoId();
  const credencial = gerarCredencial();
  const dados = {
    dispositivo_id: dispositivoId,
    credencial_publica: await hashCredencial(credencial),
    apelido: 'Aparelho ' + dispositivoId.slice(0, 8),
    ua: navigator.userAgent
  };

  const tokenLegado = await Store.get('token');
  let r = await Api.registrarDispositivo(dados, tokenLegado || undefined);

  const codigoErro = r.json && r.json.erro && r.json.erro.codigo;
  const migracaoFalhou = tokenLegado &&
    ['TOKEN_LEGADO_INVALIDO', 'TOKEN_LEGADO_CONSUMIDO', 'JANELA_MIGRACAO_ENCERRADA'].includes(codigoErro);
  if (migracaoFalhou) {
    if (codigoErro === 'TOKEN_LEGADO_CONSUMIDO') {
      toast('Este token já foi migrado em outro aparelho. Aguardando nova liberação do RH.', 'warn');
    }
    await Store.set('token', null);
    r = await Api.registrarDispositivo(dados, undefined);
  }

  if (!r.json || !r.json.ok) return null;   // sem rede ou falha — tenta de novo depois

  await Store.set('dispositivo_id', dispositivoId);
  await Store.set('credencial', credencial);

  if (r.json.migrado) {
    // só apaga o token legado depois de confirmar que a credencial nova
    // já carrega de verdade — falha aqui e o próximo boot tenta migrar de novo.
    const c = await Api.carga(dispositivoId, credencial);
    if (c.ok) await Store.set('token', null);
  }

  return { dispositivo_id: dispositivoId, credencial };
}

// O código curto nasce nesta tela — critério de aceite do Revisor
// (docs/plano-v3.md § Critérios de aceite da tela do colaborador, item 3):
// só pode existir no textContent do elemento visível, nunca em log,
// querystring ou atributo fora dele. Por isso ele é limpo do DOM em toda
// transição de estado, mesmo quando a tela vira `.hide` — hide não apaga.
function limparCodigoAguardando() {
  $('aguardandoCodigo').textContent = '';
  $('aguardandoCodigo').classList.add('hide');
}

function mostrarAguardando(codigo) {
  mostrar('aguardando');
  if (codigo) {
    $('aguardandoCodigo').textContent = codigo;
    $('aguardandoCodigo').classList.remove('hide');
  } else {
    limparCodigoAguardando();
  }
  $('aguardandoTexto').textContent = codigo
    ? 'Mostre este código para quem cuida do RH — é só isso, você não precisa fazer mais nada agora.'
    : 'Quem cuida do RH ainda não liberou este aparelho.';
}

function mostrarBloqueado(msg) {
  mostrar('aguardando');
  limparCodigoAguardando();
  $('aguardandoTexto').textContent = msg;
}

/**
 * Máquina de estado do cadastro do aparelho. Faz polling de
 * /efrat/dispositivo/estado no intervalo que o SERVIDOR manda
 * (`consultar_apos_s`), nunca num intervalo fixo escolhido aqui. A porta
 * fica bloqueada até o estado virar "ativo".
 *
 * Critério de aceite (item 5): offline e pendente falham FECHADO. Sem rede
 * não vira sinônimo de aprovado — só reaproveita a carga em cache se este
 * aparelho já tiver sido confirmado `ativo` alguma vez (persistido em
 * `ultimo_estado`); sem esse registro, sem rede mantém bloqueado.
 *
 * `forcado` (T-E3DBD4): quem sai do RH chama assim, de propósito, pra
 * reativar o poll e redescobrir a tela certa sem presumir #porta — o
 * aparelho pode ter continuado pendente o tempo todo. Sem `forcado`, uma
 * consulta agendada de antes de entrar no RH (`S.emRh`) não arranca a tela
 * do usuário no meio do login/painel; ela só reagenda, silenciosa, e quem
 * sai do RH retoma o poll de verdade.
 */
async function verificarDispositivo(forcado) {
  clearTimeout(S.pollTimer);
  if (forcado) S.emRh = false;
  if (S.emRh) return;

  const ident = S.dispositivo || await assegurarIdentidade();
  if (!ident) {
    mostrarBloqueado('Sem conexão para cadastrar este aparelho.');
    S.pollTimer = setTimeout(verificarDispositivo, 8000);
    return;
  }
  S.dispositivo = ident;

  const r = await Api.estadoDispositivo(ident.dispositivo_id, ident.credencial);
  if (!r.ok || !r.json || !r.json.ok) {
    const ultimoEstado = await Store.get('ultimo_estado');
    if (ultimoEstado === 'ativo') {
      S.dispositivo.info = await Store.get('dispositivo_info');
      await irParaPorta();
    } else {
      mostrarBloqueado('Sem conexão para confirmar a liberação deste aparelho.');
    }
    S.pollTimer = setTimeout(verificarDispositivo, 15000);
    return;
  }

  const info = r.json;
  await Store.set('ultimo_estado', info.estado);

  if (info.estado === 'ativo') {
    await Store.set('dispositivo_info', info.dispositivo);
    S.dispositivo.info = info.dispositivo;
    await irParaPorta();
    return;
  }
  if (info.estado === 'pendente') {
    mostrarAguardando(info.codigo_curto);
    S.pollTimer = setTimeout(verificarDispositivo, (info.consultar_apos_s || 15) * 1000);
    return;
  }
  // 'negado' (T-87615C: RH ganhou o botão "Recusar" e este ramo virou
  // alcançável de verdade) precisa de mensagem própria — "ainda não liberou"
  // seria enganoso pra quem já foi recusado, não só esquecido na fila.
  mostrarBloqueado(
    info.estado === 'revogado' ? 'Este aparelho teve o acesso revogado. Fale com quem cuida do RH.' :
    info.estado === 'negado' ? 'Este aparelho não foi liberado. Fale com quem cuida do RH.' :
    'Quem cuida do RH ainda não liberou este aparelho.');
  S.pollTimer = setTimeout(verificarDispositivo, 30000);
}

/* ------------------------------------------------- registrar ponto */

async function abrirFila() {
  if (!S.dispositivo) { toast('Aparelho ainda não liberado', 'warn'); return; }
  $('btnPonto').disabled = true;
  try {
    // Checagem antes de liberar a câmera (critério de aceite item 5): havendo
    // rede, reconfirma o estado agora — nunca abre com base só no que a
    // sessão lembrava de antes. Sem rede, segue com a confiança já
    // estabelecida no boot (offline-first é o requisito do produto).
    if (navigator.onLine) {
      const re = await Api.estadoDispositivo(S.dispositivo.dispositivo_id, S.dispositivo.credencial);
      if (re.ok && re.json && re.json.ok && re.json.estado !== 'ativo') {
        await verificarDispositivo();
        return;
      }
    }

    let carga = await Store.get('carga');
    let deriva = (await Store.get('deriva')) || 0;

    if (navigator.onLine) {
      const r = await Api.carga(S.dispositivo.dispositivo_id, S.dispositivo.credencial);
      if (r.ok) {
        carga = r.carga; deriva = r.deriva;
        await Store.set('carga', carga);
        await Store.set('deriva', deriva);
      } else if (!carga) {
        toast(r.erro || 'Não consegui carregar a equipe', 'bad');
        return;
      } else {
        toast('Sem rede — usando a carga salva', 'warn');
      }
    }

    if (!carga || !(carga.pessoas || []).length) {
      toast('Ninguém cadastrado ainda. Conecte à internet uma vez.', 'bad');
      return;
    }
    if (Math.abs(deriva) > 120000) {
      toast('Relógio do aparelho está ' + Math.round(deriva / 60000) + ' min fora', 'warn');
    }

    await Fila.abrir(S.dispositivo, carga, deriva, irParaPorta);
  } finally {
    $('btnPonto').disabled = false;
  }
}

/* -------------------------------------------------------- acesso RH */

function abrirLoginRh() {
  // T-E3DBD4: alcançável com o aparelho pendente. Suspende o poll de fundo
  // até sair — ver o comentário de verificarDispositivo().
  S.emRh = true;
  // T-87615C: o código só prova posse física enquanto ninguém além de quem
  // está vendo a tela do aparelho pode lê-lo — inclusive se essa mesma tela
  // apertar "Sou do RH". #aguardando fica escondido daqui pra frente, mas
  // hide não apaga: sem isso o código continuaria no HTML da página.
  limparCodigoAguardando();
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
    Rh._dispositivo = S.dispositivo;
    // Sair do RH não presume #porta (T-E3DBD4) — redescobre a tela certa,
    // porque o aparelho pode ter continuado pendente o tempo todo.
    Rh.abrir(() => verificarDispositivo(true));
  } finally {
    $('btnEntrarRh').disabled = false;
    $('btnEntrarRh').textContent = 'Entrar';
  }
}

/* -------------------------------------------------------------- boot */

async function boot() {
  S.persistido = await Store.fixar();

  $('btnPonto').onclick = abrirFila;
  $('btnAcessar').onclick = abrirLoginRh;
  $('btnEntrarRh').onclick = entrarRh;
  $('rhSenha').addEventListener('keydown', e => { if (e.key === 'Enter') entrarRh(); });
  // Idem: cancelar o login não presume #porta (T-E3DBD4).
  $('btnVoltarPorta').onclick = () => verificarDispositivo(true);
  $('btnSairFila').onclick = () => Fila.sair();

  window.addEventListener('online', () => { S.dispositivo ? sincronizarFundo() : verificarDispositivo(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    S.dispositivo ? sincronizarFundo() : verificarDispositivo();
  });
  setInterval(() => sincronizarFundo(), cfg().syncIntervalMs);

  // #porta não nasce mais visível (era a única das seis telas que nascia —
  // achado do QA sobre offline.spec.js): sem este catch, uma exceção aqui
  // (assegurarIdentidade()/Api.estadoDispositivo() fora do que
  // verificarDispositivo() já trata) deixaria a tela em branco em vez da
  // porta falsamente utilizável de antes — os dois erram fechado, mas só um
  // diz ao usuário o que fazer.
  let falhouIniciar = false;
  try {
    await verificarDispositivo();
  } catch (e) {
    mostrar('falhaBoot');
    falhouIniciar = true;
  }

  if (!falhouIniciar) {
    try {
      await Face.carregar('./models');
    } catch (e) {
      statusPorta('Falha ao carregar o reconhecimento.', 'badfg');
    }
    if (S.dispositivo && S.dispositivo.info) await irParaPorta();
  }

  // Registra mesmo se o boot falhou: é o que dá à próxima visita (depois de
  // "feche e abra de novo") uma chance melhor de funcionar offline.
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// Superfície de teste: o E2E dirige o app por aqui em vez de depender de
// tempo de câmera e de rosto real.
window.__EFRAT = {
  S, Store, Api, ApiRh, ApiGestor, Face, Fila, Rh, Gestor,
  irParaPorta, abrirFila, sincronizarFundo, verificarDispositivo
};

boot();
