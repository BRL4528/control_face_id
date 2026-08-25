// Tela de ponto. Uma ação só: olhar para a câmera e confirmar o nome.
//
// v3 (docs/adr-acesso-v3.md): não existe mais gestor abrindo fila — qualquer
// rosto conhecido pelo aparelho marca o próprio ponto direto. Reconhecimento
// de gestor não abre painel nenhum aqui: marca o ponto dele e mostra um link
// discreto "ver minha equipe" (gancho da T-8FB792, exige toque).
import { Store } from './store.js';
import { Api } from './api.js';
import { Face, DICA_ADORNO } from './face.js';
import { Gestor } from './gestor.js';
import {
  tipoDaVez, vereditoPorDistancia, ranquear, decisaoCooldown, agoraCorrigido,
  euclidiana, dia
} from './regras.js';
import { $, esc, mostrar, toast, hora } from './ui.js';

const cfg = () => window.EFRAT_CFG;

// Texto para o gestor no recadastro em campo (T-8ADD9C): o servidor agora
// recusa lote incoerente com 422 + código (docs/fase3-contrato.md § 4.2 / § 7),
// em vez de aceitar qualquer coisa. Aprovado com o Designer (750f40fef8) —
// COERENCIA_INSUFICIENTE aponta pra pessoa errada e escala pro RH se repetir;
// FOTOS_IGUAIS reusa o vocabulário de "mover a cabeça" (js/rh.js:459), porque
// o remédio é variar a pose, não a luz; VETORES_INVALIDOS (falha técnica de
// captura) usa o texto genérico.
const MENSAGENS_ERRO_CADASTRO = {
  COERENCIA_INSUFICIENTE: 'As 3 fotos não deram certo — pareceram de pessoas diferentes. Tire as 3 de novo com calma; se continuar assim, avise o RH.',
  FOTOS_IGUAIS: 'As 3 fotos ficaram iguais demais. Mova um pouco a cabeça entre as capturas e tente de novo.',
  VETORES_INVALIDOS: 'As fotos não ficaram boas pra usar. Tire as 3 de novo, com boa luz e o rosto bem visível.'
};

function mensagemErroCadastro(erro) {
  return (erro && MENSAGENS_ERRO_CADASTRO[erro.codigo])
    || (typeof erro === 'string' ? erro : null)
    || 'Falha ao enviar';
}

// Tempo que o comprovante fica na tela antes de reabrir a câmera sozinha
// (comprovante()). Gestor tem mais tempo por causa do link "ver minha equipe".
const COMPROVANTE_MS = { gestor: 6000, padrao: 3500 };

// Quanto tempo sem detectar rosto nenhum até considerar que a pessoa saiu de
// vista de verdade (rostoAusenteDesde, abaixo). Pequeno de propósito: existe
// só pra um frame perdido por ruído normal (piscar, virar o rosto um
// instante) não derrubar a continuidade à toa — não é uma janela de "acabou
// de marcar", é debounce de detecção.
const GRACA_AUSENCIA_ROSTO_MS = 1500;

export const Fila = {
  dispositivo: null,
  carga: null,
  deriva: 0,
  estado: 'parado',    // parado | aguardando | processando | confirmando | comprovante
  falhas: 0,
  doDia: [],
  pendentes: 0,
  cam: null,
  candidato: null,
  aoSair: null,
  // Sessão de gestor (T-8FB792): só o servidor emite, só vive em memória
  // aqui (docs/adr-acesso-v3.md § Sessão facial do gestor). Nunca IndexedDB.
  sessaoGestor: null,
  // Achado de produção: quem acabou de marcar e continua na frente da câmera
  // não pode ser tratado como uma chegada nova quando o comprovante reabre a
  // captura sozinha. `pessoaMarcouAquiId` guarda quem marcou por último AQUI
  // — fica valendo enquanto o rosto não sumir de vista de verdade.
  // `rostoAusenteDesde` é só o instante em que o rosto começou a sumir,
  // usado internamente pelo debounce em `onQualidade` (ver `ligarCamera`).
  pessoaMarcouAquiId: null,
  rostoAusenteDesde: null,

  galeria() {
    return (this.carga.pessoas || []).concat(this.carga.sem_cadastro || []);
  },

  /* ----------------------------------------------------------- ciclo */

  /** Abre a câmera já pronta para reconhecer qualquer rosto conhecido. */
  async abrir(dispositivo, carga, deriva, aoSair) {
    this.dispositivo = dispositivo; this.carga = carga; this.deriva = deriva || 0;
    this.aoSair = aoSair;
    this.falhas = 0;
    this.pessoaMarcouAquiId = null;
    this.rostoAusenteDesde = null;
    mostrar('fila');
    $('cartao').innerHTML = '';
    await this.recarregarDia();
    if (!(await this.ligarCamera())) { this.sair(); return; }
    this.estado = 'aguardando';
    $('dica').textContent = 'Olhe para a câmera';
  },

  async ligarCamera() {
    if (this.cam) return true;
    try {
      this.cam = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 960 } }, audio: false
      });
      const v = $('video');
      v.srcObject = this.cam;
      await v.play();
      $('camOff').classList.add('hide');
      Face.iniciar(v, $('overlay'), {
        onQualidade: q => {
          // Continuidade de presença (achado de produção — ver
          // `pessoaMarcouAquiId` acima): roda em TODO frame, mesmo durante
          // 'processando', porque é sobre o rosto na câmera, não sobre o
          // estado da fila.
          if (q.rosto) {
            this.rostoAusenteDesde = null;
          } else {
            if (this.rostoAusenteDesde == null) this.rostoAusenteDesde = Date.now();
            else if (Date.now() - this.rostoAusenteDesde >= GRACA_AUSENCIA_ROSTO_MS) {
              this.pessoaMarcouAquiId = null;
            }
          }
          if (this.estado === 'processando') return;
          const base = !q.rosto ? DICA_ADORNO : q.msg;
          $('dica').textContent = base + (Face.latencia ? ' · ' + Face.latencia + ' ms' : '');
          $('dica').style.color = q.ok ? '#28a745' : '#e0a800';
        },
        autoCaptura: () => this.estado === 'aguardando',
        onCaptura: c => this.aoCapturar(c)
      });
      return true;
    } catch (e) {
      toast('Sem acesso à câmera: ' + e.name, 'bad');
      return false;
    }
  },

  pararCamera() {
    Face.parar();
    if (this.cam) { this.cam.getTracks().forEach(t => t.stop()); this.cam = null; }
    clearTimeout(this._t);
  },

  sair() {
    this.pararCamera();
    $('cartao').innerHTML = '';
    this.candidato = null;
    this.estado = 'parado';
    if (this.aoSair) this.aoSair();
  },

  async recarregarDia() {
    const hoje = dia(agoraCorrigido(this.deriva).toISOString());
    this.doDia = await Store.doDia(hoje);
    this.pendentes = (await Store.fila()).length;
  },

  /* -------------------------------------------------- identificação */

  async aoCapturar(cap) {
    if (this.estado !== 'aguardando') return;
    this.estado = 'processando';
    $('dica').textContent = 'Identificando…';
    try {
      if (!cap || !cap.descritor) return this.falhou('Não consegui ler o rosto');
      const r = ranquear(cap.descritor, this.galeria(), euclidiana);
      const veredito = r.melhor ? vereditoPorDistancia(r.melhor.dist, cfg()) : 'rejeitado';
      if (veredito !== 'rejeitado') return this.confirmarCandidato(r.melhor.pessoa, r.melhor.dist, veredito, cap, false);
      await this.tentarIdentificarOnline(cap);
    } catch (e) {
      this.falhou('Erro ao identificar');
    }
  },

  /** Fallback 1:N on-line para quem não está na galeria offline do aparelho. */
  async tentarIdentificarOnline(cap) {
    if (!navigator.onLine) return this.falhou('Rosto não reconhecido', true);
    const r = await Api.identificar(this.dispositivo.dispositivo_id, this.dispositivo.credencial,
      cap.descritor, new Date().toISOString());
    if (!r.ok || r.resultado.resultado !== 'reconhecido') return this.falhou('Rosto não reconhecido', true);
    const p = r.resultado.pessoa;
    this.registrarSessaoGestor(r.resultado);
    this.confirmarCandidato(p, r.resultado.distancia, 'aceito', cap, true);
  },

  /**
   * Sessão de gestor (T-8FB792): só o servidor emite `sessao_gestor`, e só
   * depois de checar a distância do próprio descritor — nunca a partir do
   * veredito local (docs/adr-acesso-v3.md). O reconhecimento online já traz
   * a sessão pronta em `resultado.sessao_gestor`; guarda aqui.
   */
  registrarSessaoGestor(resultado) {
    if (resultado && resultado.sessao_gestor) {
      this.sessaoGestor = { token: resultado.sessao_gestor, expiraEm: resultado.sessao_expira_em };
    }
  },

  sessaoValida() {
    return !!(this.sessaoGestor && this.sessaoGestor.expiraEm && Date.parse(this.sessaoGestor.expiraEm) > Date.now());
  },

  /**
   * O reconhecimento local (galeria offline do aparelho) nunca passa pelo
   * servidor, então nunca ganha sessão sozinho. Quando o candidato local é
   * gestor, faz o mesmo round-trip online — melhor esforço, nunca bloqueia o
   * ponto se falhar ou estiver offline: sem sessão, o link simplesmente não
   * aparece no comprovante.
   */
  async obterSessaoGestor(cap) {
    const r = await Api.identificar(this.dispositivo.dispositivo_id, this.dispositivo.credencial,
      cap.descritor, new Date().toISOString(), 5000);
    if (r.ok && r.resultado.resultado === 'reconhecido') this.registrarSessaoGestor(r.resultado);
  },

  confirmarCandidato(pessoa, dist, veredito, cap, online) {
    const continuaAqui = this.pessoaMarcouAquiId === pessoa.pessoa_id;
    const decisao = decisaoCooldown(pessoa.pessoa_id, this.doDia, Date.now(), cfg().cooldownMs, continuaAqui);
    if (decisao === 'nada') {
      // Achado de produção: mesma pessoa que acabou de marcar aqui, ainda na
      // frente da câmera — o reabrir automático do comprovante reconheceu
      // ela de novo. Não é falha, e não repete a mensagem: só volta a
      // esperar um rosto diferente, em silêncio.
      this.estado = 'aguardando';
      return;
    }
    if (decisao === 'mensagem') {
      return this.falhou(pessoa.nome.split(' ')[0] + ' já marcou agora há pouco');
    }
    this.falhas = 0;
    this.candidato = { pessoa, dist, veredito, cap, online };
    this.estado = 'confirmando';
    this.pintarConfirmacao();
  },

  falhou(msg, manualImediato) {
    this.falhas++;
    this.estado = 'aguardando';
    const podeManual = manualImediato || this.falhas >= cfg().falhasParaManual;
    $('cartao').innerHTML =
      '<div class="cartao warn"><div class="tit">' + esc(msg) + '</div>' +
      '<div class="sub">Tentativa ' + this.falhas + '. O ponto nunca é negado — se não resolver, registre manualmente.</div>' +
      (podeManual ? '<button class="act" id="btnManual">Registrar manualmente</button>' : '') +
      '</div>';
    if (podeManual) $('btnManual').onclick = () => this.abrirLista(true);
  },

  pintarConfirmacao() {
    const c = this.candidato;
    const tipo = tipoDaVez(this.doDia.filter(m => m.pessoa_id === c.pessoa.pessoa_id));
    const cinza = c.veredito === 'revisar';
    $('cartao').innerHTML =
      '<div class="cartao ' + (cinza ? 'warn' : 'ok') + '">' +
        '<div class="linha">' +
          (c.pessoa.miniatura ? '<img class="face" src="' + c.pessoa.miniatura + '">' : '<div class="face"></div>') +
          '<div><div class="tit">' + esc(c.pessoa.nome) + '</div>' +
          '<div class="sub">' + (tipo === 'entrada' ? 'ENTRADA' : 'SAÍDA') +
          ' · dist <span class="mono">' + c.dist.toFixed(3) + '</span>' +
          (cinza ? ' · vai para conferência' : '') + '</div></div>' +
        '</div>' +
        '<button class="act big" id="btnConfirmar">CONFIRMAR ' + (tipo === 'entrada' ? 'ENTRADA' : 'SAÍDA') + '</button>' +
        '<button class="act ghost" id="btnOutro">Não é essa pessoa</button>' +
      '</div>';
    $('btnConfirmar').onclick = () => this.registrar(c.pessoa, c.cap, c.veredito, c.dist, c.online ? 'biometria_online' : 'biometria');
    $('btnOutro').onclick = () => this.abrirLista(false);
  },

  abrirLista(manual) {
    this.estado = 'confirmando';
    const gente = this.galeria().slice().sort((a, b) => a.nome.localeCompare(b.nome));
    $('cartao').innerHTML =
      '<div class="cartao">' +
        '<div class="tit">' + (manual ? 'Registro manual' : 'Quem é?') + '</div>' +
        (manual ? '<input type="text" id="motivoManual" placeholder="Motivo (obrigatório)" style="margin-top:10px">' : '') +
        '<div class="lista" id="listaPessoas">' +
          gente.map(p => '<button data-id="' + p.pessoa_id + '">' + esc(p.nome) +
            (p._sem ? ' <span class="tag">sem cadastro</span>' : '') + '</button>').join('') +
        '</div>' +
        (manual ? '' : '<button class="act ghost" id="btnRecad">Problema com essa pessoa — recadastrar</button>') +
        '<button class="act ghost" id="btnCancelar">Cancelar</button>' +
      '</div>';
    $('listaPessoas').querySelectorAll('button').forEach(b => {
      b.onclick = () => {
        const alvo = this.galeria().find(x => x.pessoa_id === b.dataset.id);
        if (!alvo) return;
        const motivo = manual ? ($('motivoManual').value || '').trim() : 'confirmado no aparelho';
        if (manual && !motivo) { toast('Informe o motivo', 'warn'); return; }
        this.registrar(alvo, manual ? null : (this.candidato && this.candidato.cap),
          manual ? 'manual' : 'revisar',
          manual ? null : (this.candidato && this.candidato.dist),
          manual ? 'manual' : 'biometria', motivo);
      };
    });
    if (!manual && $('btnRecad')) $('btnRecad').onclick = () => this.recadastrar();
    $('btnCancelar').onclick = () => { this.estado = 'aguardando'; $('cartao').innerHTML = ''; };
  },

  /** Recadastro em campo: entra como pendente e o RH decide. Nunca troca o rosto sozinho. */
  recadastrar() {
    const gente = this.galeria().slice().sort((a, b) => a.nome.localeCompare(b.nome));
    $('cartao').innerHTML =
      '<div class="cartao">' +
        '<div class="tit">Recadastrar</div>' +
        '<div class="sub">Vai para aprovação do RH. O rosto em uso não muda até lá.</div>' +
        '<div class="lista" id="listaRecad">' +
          gente.map(p => '<button data-id="' + p.pessoa_id + '">' + esc(p.nome) + '</button>').join('') +
        '</div>' +
        '<button class="act ghost" id="btnCancelar2">Cancelar</button>' +
      '</div>';
    $('listaRecad').querySelectorAll('button').forEach(b => {
      b.onclick = () => this.capturarRecadastro(b.dataset.id);
    });
    $('btnCancelar2').onclick = () => { this.estado = 'aguardando'; $('cartao').innerHTML = ''; };
  },

  async capturarRecadastro(pessoaId) {
    const alvo = (this.carga.pessoas || []).find(p => p.pessoa_id === pessoaId);
    if (!alvo) return;
    $('cartao').innerHTML = '<div class="cartao"><div class="tit">Recadastrando ' + esc(alvo.nome) + '</div>' +
      '<div class="sub">Peça para olhar de frente. Vou capturar 3 vezes.</div></div>';
    const capturas = [];
    for (let i = 0; i < 3; i++) {
      const r = await Face.capturar($('video'));
      if (!r || r.reprovado) { toast('Captura ' + (i + 1) + ' reprovada', 'warn'); this.estado = 'aguardando'; $('cartao').innerHTML = ''; return; }
      capturas.push(r);
      await new Promise(res => setTimeout(res, 600));
    }
    const env = await Api.cadastrar(this.dispositivo.dispositivo_id, this.dispositivo.credencial, {
      origem: 'gestor', pessoa_id: pessoaId, nome: alvo.nome, matricula: alvo.matricula,
      equipe_id: alvo.equipe_id, vetores: capturas.map(c => c.descritor),
      miniatura: capturas[0].thumb
    });
    this.estado = 'aguardando';
    $('cartao').innerHTML = '';
    toast(env.ok ? 'Enviado para aprovação do RH' : mensagemErroCadastro(env.erro), env.ok ? 'ok' : 'bad');
  },

  /* ------------------------------------------------------- marcação */

  posicao() {
    return new Promise(res => {
      if (!navigator.geolocation) return res(null);
      let feito = false;
      const t = setTimeout(() => { if (!feito) { feito = true; res(null); } }, cfg().geoTimeoutMs);
      navigator.geolocation.getCurrentPosition(
        p => { if (!feito) { feito = true; clearTimeout(t); res(p); } },
        () => { if (!feito) { feito = true; clearTimeout(t); res(null); } },
        { enableHighAccuracy: false, timeout: cfg().geoTimeoutMs, maximumAge: 60000 });
    });
  },

  async registrar(pessoa, cap, veredito, dist, origem, motivo) {
    this.estado = 'processando';
    // Achado de produção: a partir daqui, enquanto o rosto dela não sumir de
    // vista (onQualidade acima), um novo reconhecimento é a MESMA presença
    // continuando, não uma chegada nova — decisaoCooldown() lê isso.
    this.pessoaMarcouAquiId = pessoa.pessoa_id;
    const quando = agoraCorrigido(this.deriva);
    const tipo = tipoDaVez(this.doDia.filter(m => m.pessoa_id === pessoa.pessoa_id));
    const pos = await this.posicao();
    // Mesma regra do servidor. Marcação de gestor sempre é conferida.
    const revisar = veredito !== 'aceito' || origem === 'manual'
      || pessoa.papel === 'gestor' || Math.abs(this.deriva) > 120000;

    // Sem resquício entre pessoas: sessão de gestor não sobrevive à marcação
    // de outra pessoa no mesmo aparelho.
    if (pessoa.papel !== 'gestor') this.sessaoGestor = null;
    // `biometria_online` já capturou a sessão em tentarIdentificarOnline.
    // Reconhecimento manual (sem cap.descritor) não prova identidade o
    // suficiente para abrir sessão — o link simplesmente não aparece.
    const sessaoPendente = (pessoa.papel === 'gestor' && origem !== 'biometria_online'
      && !this.sessaoValida() && navigator.onLine && cap && cap.descritor)
      ? this.obterSessaoGestor(cap) : Promise.resolve();

    const m = {
      id_cliente: (crypto.randomUUID ? crypto.randomUUID()
        : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2)),
      pessoa_id: pessoa.pessoa_id,
      equipe_id: pessoa.equipe_id || '',
      tipo, origem: origem === 'biometria_online' ? 'biometria' : origem, veredito,
      score: dist == null ? null : Number(dist.toFixed(4)),
      motivo: motivo || '',
      marcado_em: quando.toISOString(),
      marcado_dia: dia(quando.toISOString()),
      deriva_relogio_ms: this.deriva,
      lat: pos ? pos.coords.latitude : null,
      lng: pos ? pos.coords.longitude : null,
      precisao_m: pos ? pos.coords.accuracy : null,
      foto_auditoria: revisar && cap ? cap.thumb : '',
      _nome: pessoa.nome
    };

    await Store.enfileirar(m);
    await Store.registrar('marcacao', { pessoa: pessoa.nome, tipo, veredito, origem });
    await this.recarregarDia();
    await sessaoPendente;   // só espera de verdade quando é gestor sem sessão ainda
    this.comprovante(m, pessoa);
    this.sincronizar();
  },

  /**
   * Comprovante. Regra de privacidade da tela compartilhada
   * (docs/plano-v3.md): primeiro estado pós-reconhecimento mostra só nome,
   * tipo e hora. Nada de saldo/histórico aqui. Gestor reconhecido ganha um
   * link discreto, que exige toque — nunca abre painel sozinho.
   */
  comprovante(m, pessoa) {
    this.estado = 'comprovante';
    const ehGestor = pessoa.papel === 'gestor';
    // Painel não abre automático (docs/plano-v3.md): o link só aparece
    // quando existe sessão de gestor válida, e mesmo assim exige o toque.
    const mostrarLink = ehGestor && this.sessaoValida();
    $('cartao').innerHTML =
      '<div class="cartao ok">' +
        '<div class="tit">✓ ' + (m.tipo === 'entrada' ? 'ENTRADA' : 'SAÍDA') + '</div>' +
        '<div class="horaGrande">' + hora(m.marcado_em) + '</div>' +
        '<div class="sub">' + esc(pessoa.nome) +
        ' · comprovante <b class="mono">' + m.id_cliente.slice(0, 8).toUpperCase() + '</b></div>' +
        (mostrarLink ? '<a href="#" class="verdados" id="linkVerEquipe">Ver minha equipe</a>' : '') +
      '</div>';
    if (mostrarLink) {
      $('linkVerEquipe').onclick = e => {
        e.preventDefault();
        const sessao = this.sessaoGestor;
        this.pararCamera();
        $('cartao').innerHTML = '';
        this.candidato = null;
        this.estado = 'parado';
        Gestor.abrir(sessao, this.aoSair);
      };
    }
    // O candidato já virou marcação — nada mais precisa dele. Solta a
    // referência agora, não só quando o comprovante some da tela.
    this.candidato = null;
    clearTimeout(this._t);
    // Critério de aceite (item 4): sem resquício entre pessoas. Apaga o DOM
    // e SÓ DEPOIS reabre a captura — nessa ordem, nunca ao contrário, senão
    // um rosto novo pode disparar antes do comprovante anterior sumir.
    this._t = setTimeout(() => {
      $('cartao').innerHTML = '';
      this.estado = 'aguardando';
    }, ehGestor ? COMPROVANTE_MS.gestor : COMPROVANTE_MS.padrao);
  },

  async sincronizar() {
    const r = await Api.sincronizar(this.dispositivo.dispositivo_id, this.dispositivo.credencial);
    if (r && r.resumo && r.resumo.rejeitadas > 0) {
      toast(r.resumo.rejeitadas + ' marcação(ões) rejeitada(s) pelo servidor', 'warn');
    }
    await this.recarregarDia();
  }
};
