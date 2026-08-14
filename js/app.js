import { Store } from './store.js';
import { Api } from './api.js';
import { Face, DICA_ADORNO } from './face.js';
import {
  tipoDaVez, vereditoPorDistancia, ranquear, precisaRevisao,
  emCooldown, agoraCorrigido, cargaValida, euclidiana, dia
} from './regras.js';

const $ = id => document.getElementById(id);
const cfg = () => window.EFRAT_CFG;
const esc = s => { const d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; };

const S = {
  token: null,
  carga: null,
  deriva: 0,
  estado: 'parado',     // parado | armado | processando | confirmando | comprovante
  falhas: 0,
  doDia: [],
  pendentes: 0,
  cam: null,
  candidato: null,
  escopo: 'equipe'      // equipe | unidade
};

/* ---------------------------------------------------------------- telas */

function ir(aba) {
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.aba === aba));
  ['fila', 'equipe', 'cadastro', 'ajustes'].forEach(t => $('aba-' + t).classList.toggle('hide', t !== aba));
  if (aba === 'equipe') pintarEquipe();
  if (aba === 'cadastro') pintarCadastro();
  if (aba === 'ajustes') pintarAjustes();
  if (aba !== 'fila') pararCamera();
}

function mostrarLogin(mostrar) {
  $('login').classList.toggle('hide', !mostrar);
  $('app').classList.toggle('hide', mostrar);
}

function toast(msg, tipo) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast ' + (tipo || '');
  t.classList.remove('hide');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hide'), 3200);
}

/* ---------------------------------------------------------------- sessão */

async function entrar(token) {
  $('btnEntrar').disabled = true;
  $('btnEntrar').textContent = 'Entrando…';
  try {
    const r = await Api.carga(token);
    if (!r.ok) {
      const local = await Store.get('carga');
      if (local && cargaValida(local) && (await Store.get('token')) === token) {
        toast('Sem rede — usando a carga de hoje', 'warn');
        await abrirSessao(token, local, (await Store.get('deriva')) || 0);
        return;
      }
      toast(r.erro || 'Não consegui entrar', 'bad');
      return;
    }
    await Store.set('token', token);
    await Store.set('carga', r.carga);
    await Store.set('deriva', r.deriva);
    await Store.registrar('login', { gestor: r.carga.gestor && r.carga.gestor.nome, deriva: r.deriva });
    await abrirSessao(token, r.carga, r.deriva);
  } finally {
    $('btnEntrar').disabled = false;
    $('btnEntrar').textContent = 'Entrar';
  }
}

async function abrirSessao(token, carga, deriva) {
  S.token = token; S.carga = carga; S.deriva = deriva || 0;
  $('gestorNome').textContent = (carga.gestor && carga.gestor.nome) || '—';
  $('equipeNome').textContent = minhasEquipes().map(e => e.nome).join(' · ') || '—';
  if (Math.abs(S.deriva) > 120000) {
    toast('Relógio do aparelho está ' + Math.round(S.deriva / 60000) + ' min fora', 'warn');
  }
  mostrarLogin(false);
  await recarregarDia();
  ir('fila');
  sincronizar();
}

function minhasEquipes() { return (S.carga.equipes || []).filter(e => e.minha); }
function idsMinhaEquipe() { return new Set(minhasEquipes().map(e => e.equipe_id)); }

function galeria() {
  const meus = idsMinhaEquipe();
  return (S.carga.pessoas || []).filter(p => S.escopo === 'unidade' || meus.has(p.equipe_id));
}

async function recarregarDia() {
  const hoje = dia(agoraCorrigido(S.deriva).toISOString());
  S.doDia = await Store.doDia(hoje);
  S.pendentes = (await Store.fila()).length;
  pintarPainel();
}

/* ------------------------------------------------------------- câmera */

async function ligarCamera() {
  if (S.cam) return true;
  try {
    S.cam = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 960 } }, audio: false
    });
    const v = $('video');
    v.srcObject = S.cam;
    await v.play();
    $('camOff').classList.add('hide');
    Face.iniciar(v, $('overlay'), {
      onQualidade: q => {
        const semRosto = !q.rosto;
        $('dica').textContent = (semRosto ? DICA_ADORNO : q.msg) + (Face.latencia ? ' · ' + Face.latencia + ' ms' : '');
        $('dica').style.color = q.ok ? '#3fb984' : '#e0a740';
      },
      autoCaptura: () => S.estado === 'armado',
      onCaptura: aoCapturar
    });
    return true;
  } catch (e) {
    toast('Sem acesso à câmera: ' + e.name, 'bad');
    return false;
  }
}

function pararCamera() {
  Face.parar();
  if (S.cam) { S.cam.getTracks().forEach(t => t.stop()); S.cam = null; }
  $('camOff').classList.remove('hide');
  S.estado = 'parado';
  pintarBotaoFila();
}

async function alternarFila() {
  if (S.estado === 'parado') {
    if (!(await ligarCamera())) return;
    S.estado = 'armado';
    S.falhas = 0;
    $('cartao').innerHTML = '';
  } else {
    pararCamera();
  }
  pintarBotaoFila();
}

function pintarBotaoFila() {
  const b = $('btnFila');
  const rodando = S.estado !== 'parado';
  b.textContent = rodando ? 'PARAR' : 'INICIAR FILA';
  b.className = 'act big ' + (rodando ? 'ghost' : '');
}

/* --------------------------------------------------------- identificação */

async function aoCapturar(cap) {
  if (S.estado !== 'armado') return;
  S.estado = 'processando';
  $('dica').textContent = 'Identificando…';
  try {
    if (!cap || !cap.descritor) { falhou('Não consegui ler o rosto'); return; }

    const r = ranquear(cap.descritor, galeria(), euclidiana);
    if (!r.melhor) { falhou('Ninguém na galeria'); return; }

    const veredito = vereditoPorDistancia(r.melhor.dist, cfg());
    if (veredito === 'rejeitado') { falhou('Não reconhecido'); return; }

    const p = r.melhor.pessoa;
    if (emCooldown(p.pessoa_id, S.doDia, Date.now(), cfg().cooldownMs)) {
      falhou(p.nome.split(' ')[0] + ' já marcou agora há pouco');
      return;
    }

    S.falhas = 0;
    S.candidato = { pessoa: p, dist: r.melhor.dist, margem: r.margem, veredito, cap };
    S.estado = 'confirmando';
    pintarConfirmacao();
  } catch (e) {
    falhou('Erro ao identificar');
  }
}

function falhou(msg) {
  S.falhas++;
  S.estado = 'armado';
  const podeManual = S.falhas >= cfg().falhasParaManual;
  $('cartao').innerHTML =
    '<div class="cartao warn"><div class="tit">' + esc(msg) + '</div>' +
    '<div class="sub">Tentativa ' + S.falhas + '. O ponto nunca é negado — se não resolver, registre manualmente.</div>' +
    (podeManual ? '<button class="act" id="btnManual">Registrar manualmente</button>' : '') +
    '</div>';
  if (podeManual) $('btnManual').onclick = () => abrirLista(true);
}

function pintarConfirmacao() {
  const c = S.candidato;
  const tipo = tipoDaVez(S.doDia.filter(m => m.pessoa_id === c.pessoa.pessoa_id));
  const cinza = c.veredito === 'revisar';
  $('cartao').innerHTML =
    '<div class="cartao ' + (cinza ? 'warn' : 'ok') + '">' +
      '<div class="linha">' +
        (c.pessoa.miniatura ? '<img class="face" src="' + c.pessoa.miniatura + '">' : '<div class="face"></div>') +
        '<div><div class="tit">' + esc(c.pessoa.nome) + '</div>' +
        '<div class="sub">' + (tipo === 'entrada' ? 'ENTRADA' : 'SAÍDA') +
        ' · dist ' + c.dist.toFixed(3) +
        (c.margem != null ? ' · margem ' + c.margem.toFixed(3) : '') +
        (cinza ? ' · será revisado pelo RH' : '') + '</div></div>' +
      '</div>' +
      '<button class="act grande" id="btnConfirmar">CONFIRMAR ' + (tipo === 'entrada' ? 'ENTRADA' : 'SAÍDA') + '</button>' +
      '<button class="act ghost" id="btnOutro">Não é essa pessoa</button>' +
    '</div>';
  $('btnConfirmar').onclick = () => registrar(c.pessoa, c.cap, c.veredito, c.dist, 'biometria');
  $('btnOutro').onclick = () => abrirLista(false);
}

function abrirLista(manual) {
  S.estado = 'confirmando';
  const lista = galeria().slice().sort((a, b) => a.nome.localeCompare(b.nome));
  const semCad = (S.carga.sem_cadastro || []);
  $('cartao').innerHTML =
    '<div class="cartao">' +
      '<div class="tit">' + (manual ? 'Registro manual' : 'Quem é?') + '</div>' +
      (manual ? '<input type="text" id="motivoManual" placeholder="Motivo (obrigatório)">' : '') +
      '<div class="lista" id="listaPessoas">' +
        lista.concat(semCad.map(p => Object.assign({ _sem: true }, p)))
          .map(p => '<button data-id="' + p.pessoa_id + '">' + esc(p.nome) +
                    (p._sem ? ' <span class="tag">sem cadastro</span>' : '') + '</button>').join('') +
      '</div>' +
      '<button class="act ghost" id="btnCancelar">Cancelar</button>' +
    '</div>';
  $('listaPessoas').querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      const alvo = (S.carga.pessoas || []).concat(S.carga.sem_cadastro || [])
        .find(x => x.pessoa_id === b.dataset.id);
      if (!alvo) return;
      const motivo = manual ? ($('motivoManual').value || '').trim() : 'confirmado pelo gestor';
      if (manual && !motivo) { toast('Informe o motivo', 'warn'); return; }
      registrar(alvo, manual ? null : (S.candidato && S.candidato.cap), manual ? 'manual' : 'revisar',
        manual ? null : (S.candidato && S.candidato.dist), manual ? 'manual' : 'biometria', motivo);
    };
  });
  $('btnCancelar').onclick = () => { S.estado = 'armado'; $('cartao').innerHTML = ''; };
}

/* ------------------------------------------------------------ marcação */

function posicao() {
  return new Promise(res => {
    if (!navigator.geolocation) return res(null);
    let feito = false;
    const t = setTimeout(() => { if (!feito) { feito = true; res(null); } }, cfg().geoTimeoutMs);
    navigator.geolocation.getCurrentPosition(
      p => { if (!feito) { feito = true; clearTimeout(t); res(p); } },
      () => { if (!feito) { feito = true; clearTimeout(t); res(null); } },
      { enableHighAccuracy: false, timeout: cfg().geoTimeoutMs, maximumAge: 60000 }
    );
  });
}

async function registrar(pessoa, cap, veredito, dist, origem, motivo) {
  S.estado = 'processando';
  const quando = agoraCorrigido(S.deriva);
  const tipo = tipoDaVez(S.doDia.filter(m => m.pessoa_id === pessoa.pessoa_id));
  const pos = await posicao();
  const revisar = precisaRevisao(
    { veredito, origem, deriva_relogio_ms: S.deriva }, pessoa.papel, cfg());

  const m = {
    id_cliente: (crypto.randomUUID ? crypto.randomUUID()
      : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2)),
    pessoa_id: pessoa.pessoa_id,
    equipe_id: pessoa.equipe_id || '',
    tipo,
    origem,
    veredito,
    score: dist == null ? null : Number(dist.toFixed(4)),
    motivo: motivo || '',
    marcado_em: quando.toISOString(),
    marcado_dia: dia(quando.toISOString()),
    deriva_relogio_ms: S.deriva,
    lat: pos ? pos.coords.latitude : null,
    lng: pos ? pos.coords.longitude : null,
    precisao_m: pos ? pos.coords.accuracy : null,
    // Foto só quando vai para a mesa do RH. Nas aceitas ela não agrega e
    // encheria o armazenamento de base64.
    foto_auditoria: revisar && cap ? cap.thumb : '',
    _nome: pessoa.nome
  };

  await Store.enfileirar(m);
  await Store.registrar('marcacao', { pessoa: pessoa.nome, tipo, veredito, origem });
  await recarregarDia();
  comprovante(m, pessoa);
  sincronizar();
}

function comprovante(m, pessoa) {
  S.estado = 'comprovante';
  $('cartao').innerHTML =
    '<div class="cartao ok">' +
      '<div class="tit">✓ ' + (m.tipo === 'entrada' ? 'ENTRADA' : 'SAÍDA') + ' registrada</div>' +
      '<div class="sub">' + esc(pessoa.nome) + ' · ' +
        new Date(m.marcado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) +
        ' · comprovante <b>' + m.id_cliente.slice(0, 8).toUpperCase() + '</b></div>' +
      (m.veredito !== 'aceito' ? '<div class="sub warnfg">Vai para conferência do RH</div>' : '') +
      '<button class="act grande" id="btnProximo">PRÓXIMO</button>' +
    '</div>';
  const seguir = () => { S.estado = 'armado'; $('cartao').innerHTML = ''; clearTimeout(comprovante._t); };
  $('btnProximo').onclick = seguir;
  comprovante._t = setTimeout(seguir, 4000);
}

/* -------------------------------------------------------------- painéis */

function pintarPainel() {
  const meus = idsMinhaEquipe();
  const equipe = (S.carga ? S.carga.pessoas || [] : []).filter(p => meus.has(p.equipe_id));
  const semCad = (S.carga ? S.carga.sem_cadastro || [] : []).filter(p => meus.has(p.equipe_id));
  const marcaram = new Set(S.doDia.map(m => m.pessoa_id));
  const total = equipe.length + semCad.length;
  const feitos = equipe.concat(semCad).filter(p => marcaram.has(p.pessoa_id)).length;
  $('kpiMarcaram').textContent = feitos + '/' + total;
  $('kpiFaltam').textContent = Math.max(0, total - feitos);
  $('kpiFila').textContent = S.pendentes;
  $('kpiFila').className = 'val ' + (S.pendentes > 0 ? 'warnfg' : '');
  $('offline').classList.toggle('hide', navigator.onLine);
}

function pintarEquipe() {
  const meus = idsMinhaEquipe();
  const marcaram = {};
  S.doDia.forEach(m => { (marcaram[m.pessoa_id] = marcaram[m.pessoa_id] || []).push(m); });
  const pessoas = (S.carga.pessoas || []).filter(p => meus.has(p.equipe_id))
    .concat((S.carga.sem_cadastro || []).filter(p => meus.has(p.equipe_id)).map(p => Object.assign({ _sem: true }, p)))
    .sort((a, b) => a.nome.localeCompare(b.nome));
  $('listaEquipe').innerHTML = pessoas.map(p => {
    const ms = marcaram[p.pessoa_id] || [];
    const cor = ms.length === 0 ? 'bad' : (ms.length % 2 === 1 ? 'ok' : 'muted');
    const txt = ms.length === 0 ? 'sem marcação'
      : ms.map(m => (m.tipo === 'entrada' ? 'E' : 'S') + ' ' +
          new Date(m.marcado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })).join(' · ');
    return '<div class="pessoa"><span class="ponto ' + cor + '"></span>' +
      '<div><div class="nm">' + esc(p.nome) + (p._sem ? ' <span class="tag">sem cadastro</span>' : '') + '</div>' +
      '<div class="mt">' + txt + '</div></div></div>';
  }).join('') || '<p class="nota">Ninguém na equipe.</p>';
}

/* ------------------------------------------------------------- cadastro */

const capturas = [];

function pintarCadastro() {
  const opts = (S.carga.equipes || []).map(e =>
    '<option value="' + e.equipe_id + '">' + esc(e.nome) + '</option>').join('');
  if ($('cadEquipe').innerHTML !== opts) $('cadEquipe').innerHTML = opts;
  pintarCapturas();
}

function pintarCapturas() {
  $('cadShots').innerHTML = [0, 1, 2].map(i =>
    capturas[i] ? '<div><img src="' + capturas[i].thumb + '"></div>' : '<div>' + (i + 1) + '</div>').join('');
  $('btnSalvarCad').disabled = capturas.length < 3 || !$('cadNome').value.trim() || !$('cadMat').value.trim();
}

async function capturarCadastro() {
  if (!(await ligarCameraCadastro())) return;
  $('btnCapturarCad').disabled = true;
  $('btnCapturarCad').textContent = '…';
  try {
    const r = await Face.capturar($('videoCad'));
    if (!r) { toast(DICA_ADORNO, 'warn'); return; }
    if (r.reprovado) { toast('Qualidade insuficiente: ' + r.qualidade.msg, 'warn'); return; }
    capturas.push(r);
    pintarCapturas();
  } finally {
    $('btnCapturarCad').disabled = false;
    $('btnCapturarCad').textContent = 'Capturar ' + (capturas.length < 3 ? (capturas.length + 1) + '/3' : '');
  }
}

let camCad = null;
async function ligarCameraCadastro() {
  if (camCad) return true;
  try {
    camCad = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
    $('videoCad').srcObject = camCad;
    await $('videoCad').play();
    $('camOffCad').classList.add('hide');
    return true;
  } catch (e) { toast('Sem acesso à câmera', 'bad'); return false; }
}

async function salvarCadastro() {
  const coer = Math.max(
    euclidiana(capturas[0].descritor, capturas[1].descritor),
    euclidiana(capturas[0].descritor, capturas[2].descritor),
    euclidiana(capturas[1].descritor, capturas[2].descritor));
  if (coer > 0.55 && !confirm('As 3 capturas estão pouco parecidas entre si (' + coer.toFixed(3) +
      ').\n\nIsso costuma virar falso negativo depois. Salvar assim mesmo?')) return;

  $('btnSalvarCad').disabled = true;
  const r = await Api.cadastrar(S.token, {
    origem: $('cadOrigem').value,
    matricula: $('cadMat').value.trim(),
    nome: $('cadNome').value.trim(),
    equipe_id: $('cadEquipe').value,
    vetores: capturas.map(c => c.descritor),
    miniatura: capturas[0].thumb,
    coerencia: Number(coer.toFixed(4))
  });
  $('btnSalvarCad').disabled = false;
  if (!r.ok) { toast(r.erro || 'Falha ao cadastrar', 'bad'); return; }
  toast(r.resultado.status === 'pendente'
    ? 'Enviado — aguardando aprovação do RH'
    : 'Cadastrado (coerência ' + coer.toFixed(3) + ')', 'ok');
  capturas.length = 0;
  $('cadNome').value = ''; $('cadMat').value = '';
  pintarCapturas();
  const nova = await Api.carga(S.token);
  if (nova.ok) { S.carga = nova.carga; await Store.set('carga', nova.carga); await recarregarDia(); }
}

/* -------------------------------------------------------------- ajustes */

async function pintarAjustes() {
  const fila = await Store.fila();
  $('diagBackend').textContent = Face.backend || '—';
  $('diagCarga').textContent = S.carga && S.carga.pessoas ? S.carga.pessoas.length : 0;
  $('diagDeriva').textContent = Math.round(S.deriva / 1000) + ' s';
  $('diagPersist').textContent = S._persistido ? 'sim' : 'não';
  $('diagFila').textContent = fila.length;
  $('listaFila').innerHTML = fila.length
    ? fila.map(m => '<div class="pessoa"><span class="ponto ' + (m._erro ? 'bad' : 'muted') + '"></span>' +
        '<div><div class="nm">' + esc(m._nome || m.pessoa_id) + '</div>' +
        '<div class="mt">' + new Date(m.marcado_em).toLocaleString('pt-BR') +
        (m._erro ? ' · ' + esc(m._erro) : '') + '</div></div></div>').join('')
    : '<p class="nota">Fila vazia — tudo enviado.</p>';
}

/* ----------------------------------------------------------- sincronismo */

let sincronizando = false;
async function sincronizar() {
  if (!S.token || sincronizando) return;
  sincronizando = true;
  try {
    const r = await Api.sincronizar(S.token);
    if (r && r.resumo && r.resumo.rejeitadas > 0) {
      toast(r.resumo.rejeitadas + ' marcação(ões) rejeitada(s) — veja em Ajustes', 'warn');
    }
    await recarregarDia();
  } finally {
    sincronizando = false;
  }
}

/* ---------------------------------------------------------------- boot */

async function boot() {
  S._persistido = await Store.fixar();

  document.querySelectorAll('nav button').forEach(b => { b.onclick = () => ir(b.dataset.aba); });
  $('btnEntrar').onclick = () => {
    const t = $('token').value.trim();
    if (!t) { toast('Informe o token do aparelho', 'warn'); return; }
    entrar(t);
  };
  $('token').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnEntrar').click(); });
  $('btnFila').onclick = alternarFila;
  $('escopo').onchange = e => { S.escopo = e.target.value; };
  $('btnCapturarCad').onclick = capturarCadastro;
  $('btnSalvarCad').onclick = salvarCadastro;
  $('cadNome').oninput = pintarCapturas;
  $('cadMat').oninput = pintarCapturas;
  $('btnSync').onclick = () => { sincronizar(); toast('Enviando…'); };
  $('btnSair').onclick = async () => {
    const fila = await Store.fila();
    if (fila.length && !confirm('Há ' + fila.length + ' marcação(ões) ainda não enviada(s). Sair mesmo assim?')) return;
    await Store.set('token', null);
    location.reload();
  };

  window.addEventListener('online', () => { pintarPainel(); sincronizar(); });
  window.addEventListener('offline', pintarPainel);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sincronizar(); });
  setInterval(sincronizar, cfg().syncIntervalMs);

  try {
    await Face.carregar('./models');
    $('statusModelos').textContent = 'pronto · ' + Face.backend;
    $('statusModelos').className = 'pill ok';
  } catch (e) {
    $('statusModelos').textContent = 'erro nos modelos';
    $('statusModelos').className = 'pill bad';
  }

  const token = await Store.get('token');
  const carga = await Store.get('carga');
  if (token && carga && cargaValida(carga)) {
    await abrirSessao(token, carga, (await Store.get('deriva')) || 0);
    if (navigator.onLine) {
      const nova = await Api.carga(token);
      if (nova.ok) {
        S.carga = nova.carga; S.deriva = nova.deriva;
        await Store.set('carga', nova.carga); await Store.set('deriva', nova.deriva);
        await recarregarDia();
      }
    }
  } else {
    if (token) $('token').value = token;
    mostrarLogin(true);
  }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// Superfície de teste: o E2E dirige o app por aqui em vez de depender de
// tempo de câmera e de rosto real.
window.__EFRAT = { S, Store, Api, Face, sincronizar, recarregarDia, aoCapturar, registrar, entrar };

boot();
