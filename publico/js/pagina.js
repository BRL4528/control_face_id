// Orquestração da página pública de cadastro de face (T-D30529,
// docs/fase3-contrato.md § 4.4/4.5). Fecho de import fechado (§ 4.6): só
// js/api-face.js, js/face.js (que só importa js/regras.js) e { $, esc, toast }
// de js/ui.js — nunca js/store.js, js/api.js, js/rh.js, js/app.js,
// js/fila.js, js/gestor.js, js/cripto.js, nem `mostrar` de js/ui.js (é a
// função que aponta pro painel do RH — não tem lugar aqui).
import { $, esc, toast } from './ui.js';
import { Face } from './face.js';
import { ApiFace } from './api-face.js';

const cfg = () => window.EFRAT_CFG;

// Token no FRAGMENTO, nunca na requisição HTTP (§4.4): lido e removido da URL
// ANTES de qualquer await — não sobrevive no histórico nem em print de tela.
const m = /#c=([^&]+)/.exec(location.hash);
const token = m ? decodeURIComponent(m[1]) : null;
history.replaceState(null, '', location.pathname);

function tela(html) { $('tela').innerHTML = html; }

function telaLinkMorto(msg) {
  tela('<h1>Link indisponível</h1><p>' + esc(msg || 'Este link não vale mais. Peça um novo ao RH.') + '</p>');
}

function telaJaRecebido() {
  tela('<h1>Já recebido</h1><p>Já recebemos suas fotos. O RH vai conferir — você já pode fechar esta página.</p>');
}

const MENSAGENS_FOTO = {
  sem_rosto: 'Não encontrei um rosto nesta foto. Tire o capacete, os óculos escuros ou a máscara e tire de novo, com boa luz.',
  multiplos_rostos: 'Tem mais de uma pessoa na foto. Tire sozinho(a), só o seu rosto aparecendo.',
  qualidade: 'Essa foto ficou com o rosto tampado ou embaçado. Tire de novo, sem boné, óculos escuros ou máscara, com boa luz.'
};
function mensagemErroFoto(motivo) {
  return MENSAGENS_FOTO[motivo] || 'Essa foto não pôde ser usada. Tire de novo, com boa luz e o rosto bem visível.';
}

// §4.4: recusa por coerência/fotos-iguais NÃO consome o link — o texto
// convida a tentar de nova NA MESMA sessão, nunca manda pedir link novo.
const MENSAGENS_LOTE = {
  COERENCIA_INSUFICIENTE: 'As 3 fotos ficaram muito diferentes entre si, então não deu pra usar esse cadastro. Tire as 3 de novo, com calma, uma de cada vez.',
  FOTOS_IGUAIS: 'As 3 fotos ficaram iguais demais, então não deu pra usar esse cadastro. Tire as 3 de novo, mexendo um pouco a cabeça entre elas.'
};

let capturas = []; // { descritor, thumb }

function pintarSlotsHtml() {
  return '<div class="shots">' + [0, 1, 2].map(i =>
    capturas[i] ? '<div><img src="' + capturas[i].thumb + '"></div>' : '<div>' + (i + 1) + '</div>'
  ).join('') + '</div>';
}

let stream = null;
async function ligarCamera() {
  if (stream) return true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
    $('video').srcObject = stream;
    await $('video').play();
    return true;
  } catch (e) {
    toast('Sem acesso à câmera', 'bad');
    return false;
  }
}
function pararCamera() {
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  $('camwrap').classList.add('hide');
}

function telaCaptura(erro) {
  // #camwrap é persistente (fora de #tela, ver index.html) — só troca de
  // visibilidade, nunca é recriado, senão o <video> morreria na próxima
  // repintura de #tela e a foto seguinte ficaria muda.
  $('camwrap').classList.remove('hide');
  tela(
    '<h1>Vamos tirar 3 fotos do seu rosto</h1>' +
    '<p>Fique num lugar com boa luz, sem óculos escuros, boné, capacete ou máscara — o sistema reconhece ' +
      'pelo formato do rosto, e se estiver coberto, ele simplesmente não encontra.</p>' +
    '<p>Tire uma foto de cada vez, mexendo um pouco a cabeça entre elas.</p>' +
    pintarSlotsHtml() +
    (erro ? '<p class="erro">' + esc(erro) + '</p>' : '') +
    '<button class="act" id="btnTirar">Tirar foto ' + (capturas.length + 1) + ' de 3</button>'
  );
  $('btnTirar').onclick = tirarFoto;
}

// Guarda contra clique duplo: `#btnTirar` é recriado a cada repintura de
// `#tela`, então `disabled` no botão não sobrevive entre repinturas — sem
// este guard, um segundo toque (comum em celular, rede lenta) dispara duas
// capturas sobrepostas antes da primeira terminar.
let capturando = false;
async function tirarFoto() {
  if (capturando) return;
  capturando = true;
  try {
    if (!(await ligarCamera())) return;
    const r = await Face.capturarUnico($('video'));
    if (!r.ok) { telaCaptura(mensagemErroFoto(r.motivo)); return; }
    capturas.push(r);
    if (capturas.length < 3) { telaCaptura(); return; }
    await enviar();
  } finally {
    capturando = false;
  }
}

function novaIdempotencyKey() {
  return crypto.randomUUID ? crypto.randomUUID() : 'idem-' + Date.now() + '-' + Math.random().toString(36).slice(2);
}

async function enviar() {
  pararCamera();
  tela('<p class="nota">Enviando…</p>');
  const r = await ApiFace.enviar(token, {
    vetores: capturas.map(c => c.descritor),
    miniatura: capturas[0].thumb,
    modelo_id: Face.modeloId,
    capturado_em: new Date().toISOString()
  }, novaIdempotencyKey());

  if (r.ok && r.json && r.json.ok) {
    tela('<h1>Pronto</h1><p>Recebemos suas fotos. O RH vai conferir. Você já pode fechar esta página.</p>');
    return;
  }

  const codigo = r.json && r.json.erro && r.json.erro.codigo;
  if (codigo === 'CONVITE_BLOQUEADO') {
    tela('<h1>Link bloqueado</h1><p>Foram muitas tentativas sem dar certo. Este link não serve mais — peça um novo ao RH.</p>');
    return;
  }
  if (codigo === 'CONVITE_CONSUMIDO') { telaJaRecebido(); return; }
  if (codigo === 'CONVITE_INVALIDO') { telaLinkMorto(); return; }
  if (MENSAGENS_LOTE[codigo]) {
    // §4.4: recusa não consome — o link continua vivo, refaz as 3 capturas.
    capturas = [];
    telaCaptura(MENSAGENS_LOTE[codigo]);
    return;
  }
  // Rede ou erro técnico não catalogado: link não foi consumido, retry cabe.
  capturas = [];
  telaCaptura('Não deu pra enviar agora. Verifique sua internet e tire as 3 fotos de novo.');
}

function telaSaudacao(primeiroNome) {
  tela(
    '<h1>Oi, ' + esc(primeiroNome) + '!</h1>' +
    '<p>Aqui é o cadastro de rosto da ' + esc(cfg().empresa) + '.</p>' +
    '<button class="act" id="btnComecar">Tirar as 3 fotos</button>'
  );
  $('btnComecar').onclick = () => telaCaptura();
}

async function iniciar() {
  if (!token) { telaLinkMorto(); return; }
  tela('<p class="nota">Carregando…</p>');
  await Face.carregar('./models');
  const r = await ApiFace.abrir(token);
  if (!r.ok || !r.json || !r.json.ok) {
    telaLinkMorto(r.json && r.json.erro && r.json.erro.mensagem);
    return;
  }
  if (r.json.estado === 'consumido') { telaJaRecebido(); return; }
  telaSaudacao(r.json.primeiro_nome);
}

iniciar();
