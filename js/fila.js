// Tela do gestor. Uma ação só: olhar para a câmera e confirmar o nome.
//
// Tudo que é administração — cadastrar gente, criar equipe, ver indicador —
// mora no painel do RH. Quem está com 20 pessoas na frente não deve ver
// nenhuma dessas opções.
import { Store } from './store.js';
import { Api } from './api.js';
import { Face, DICA_ADORNO } from './face.js';
import {
  tipoDaVez, vereditoPorDistancia, ranquear, emCooldown, agoraCorrigido,
  euclidiana, dia, gestorDeveMarcar
} from './regras.js';
import { $, esc, mostrar, toast, hora } from './ui.js';

const cfg = () => window.EFRAT_CFG;

export const Fila = {
  token: null,
  carga: null,
  deriva: 0,
  gestor: null,
  estado: 'parado',    // parado | identificando | armado | processando | confirmando | comprovante
  falhas: 0,
  doDia: [],
  pendentes: 0,
  cam: null,
  candidato: null,
  escopo: 'equipe',
  aoSair: null,

  /* --------------------------------------------------------- galeria */

  gestores() {
    return (this.carga.pessoas || []).filter(p => p.papel === 'gestor');
  },

  equipesDoTurno() {
    return new Set((this.carga.equipes || []).filter(e => e.minha).map(e => e.equipe_id));
  },

  galeria() {
    if (this.escopo === 'unidade') return this.carga.pessoas || [];
    const meus = this.equipesDoTurno();
    return (this.carga.pessoas || []).filter(p => meus.has(p.equipe_id));
  },

  /* ----------------------------------------------------------- ciclo */

  /** Abre a câmera já procurando pelo gestor, sem passar por login. */
  async abrir(token, carga, deriva, aoSair) {
    this.token = token; this.carga = carga; this.deriva = deriva || 0;
    this.aoSair = aoSair;
    this.gestor = null; this.falhas = 0; this.escopo = 'equipe';
    mostrar('fila');
    $('filaGestor').textContent = 'Identificando…';
    $('filaEquipe').textContent = '';
    $('cartao').innerHTML = '';
    await this.recarregarDia();
    if (!(await this.ligarCamera())) { this.sair(); return; }
    this.estado = 'identificando';
    $('dica').textContent = 'Gestor, olhe para a câmera';
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
          if (this.estado === 'processando') return;
          const base = !q.rosto ? DICA_ADORNO
            : this.estado === 'identificando' ? 'Gestor, olhe para a câmera' : q.msg;
          $('dica').textContent = base + (Face.latencia ? ' · ' + Face.latencia + ' ms' : '');
          $('dica').style.color = q.ok ? '#3fb984' : '#e0a740';
        },
        autoCaptura: () => this.estado === 'identificando' || this.estado === 'armado',
        onCaptura: c => this.aoCapturar(c)
      });
      return true;
    } catch (e) {
      toast('Sem acesso à câmera: ' + e.name, 'bad');
      return false;
    }
  },

  sair() {
    Face.parar();
    if (this.cam) { this.cam.getTracks().forEach(t => t.stop()); this.cam = null; }
    this.estado = 'parado';
    if (this.aoSair) this.aoSair();
  },

  async recarregarDia() {
    const hoje = dia(agoraCorrigido(this.deriva).toISOString());
    this.doDia = await Store.doDia(hoje);
    this.pendentes = (await Store.fila()).length;
    this.pintarKpis();
  },

  pintarKpis() {
    const meus = this.equipesDoTurno();
    const equipe = (this.carga.pessoas || []).filter(p => meus.has(p.equipe_id));
    const semCad = (this.carga.sem_cadastro || []).filter(p => meus.has(p.equipe_id));
    const marcaram = new Set(this.doDia.map(m => m.pessoa_id));
    const total = equipe.length + semCad.length;
    const feitos = equipe.concat(semCad).filter(p => marcaram.has(p.pessoa_id)).length;
    $('kMarcaram').textContent = feitos + '/' + total;
    $('kFaltam').textContent = Math.max(0, total - feitos);
    $('kEnvio').textContent = this.pendentes;
    $('kEnvio').className = 'val ' + (this.pendentes > 0 ? 'warnfg' : '');
  },

  /* -------------------------------------------------- identificação */

  async aoCapturar(cap) {
    if (this.estado === 'identificando') return this.identificarGestor(cap);
    if (this.estado !== 'armado') return;
    this.estado = 'processando';
    $('dica').textContent = 'Identificando…';
    try {
      if (!cap || !cap.descritor) return this.falhou('Não consegui ler o rosto');
      const r = ranquear(cap.descritor, this.galeria(), euclidiana);
      if (!r.melhor) return this.falhou('Ninguém na galeria');
      const veredito = vereditoPorDistancia(r.melhor.dist, cfg());
      if (veredito === 'rejeitado') return this.falhou('Não reconhecido');
      const p = r.melhor.pessoa;
      if (emCooldown(p.pessoa_id, this.doDia, Date.now(), cfg().cooldownMs)) {
        return this.falhou(p.nome.split(' ')[0] + ' já marcou agora há pouco');
      }
      this.falhas = 0;
      this.candidato = { pessoa: p, dist: r.melhor.dist, margem: r.margem, veredito, cap };
      this.estado = 'confirmando';
      this.pintarConfirmacao();
    } catch (e) {
      this.falhou('Erro ao identificar');
    }
  },

  /**
   * Quem abriu a fila? A galeria aqui são os gestores — 2 ou 3 pessoas — então
   * a identificação é praticamente infalível, e o aparelho não precisa saber
   * de antemão qual gestor está com ele.
   */
  async identificarGestor(cap) {
    this.estado = 'processando';
    $('dica').textContent = 'Identificando…';
    if (!cap || !cap.descritor) { this.estado = 'identificando'; return; }
    const r = ranquear(cap.descritor, this.gestores(), euclidiana);
    if (!r.melhor || vereditoPorDistancia(r.melhor.dist, cfg()) === 'rejeitado') {
      this.falhas++;
      this.estado = 'identificando';
      if (this.falhas >= cfg().falhasParaManual) {
        $('cartao').innerHTML =
          '<div class="cartao warn"><div class="tit">Não reconheci o gestor</div>' +
          '<div class="sub">Confira a luz e tire boné ou óculos escuros. Se persistir, o RH precisa cadastrar ou recadastrar o seu rosto.</div></div>';
      }
      return;
    }

    this.gestor = r.melhor.pessoa;
    this.falhas = 0;
    $('filaGestor').textContent = this.gestor.nome;
    $('filaEquipe').textContent = (this.carga.equipes || [])
      .filter(e => e.minha).map(e => e.nome).join(' · ') || '—';

    // O ponto do gestor sai de brinde — mas só quando faz sentido. Abrir o app
    // três vezes no dia não pode virar três marcações.
    const meusHoje = this.doDia.filter(m => m.pessoa_id === this.gestor.pessoa_id);
    if (gestorDeveMarcar(meusHoje, Date.now(), cfg().cooldownMs)) {
      await this.registrar(this.gestor, cap, r.melhor.dist <= cfg().limiarAceite ? 'aceito' : 'revisar',
        r.melhor.dist, 'biometria', '', true);
    } else {
      this.estado = 'armado';
      $('cartao').innerHTML = '';
      toast('Fila aberta — ' + this.gestor.nome.split(' ')[0], 'ok');
    }
  },

  falhou(msg) {
    this.falhas++;
    this.estado = 'armado';
    const podeManual = this.falhas >= cfg().falhasParaManual;
    $('cartao').innerHTML =
      '<div class="cartao warn"><div class="tit">' + esc(msg) + '</div>' +
      '<div class="sub">Tentativa ' + this.falhas + '. O ponto nunca é negado — se não resolver, registre manualmente.</div>' +
      (podeManual ? '<button class="act" id="btnManual">Registrar manualmente</button>' +
                    '<button class="act ghost" id="btnUnidade">Procurar em toda a unidade</button>' : '') +
      '</div>';
    if (podeManual) {
      $('btnManual').onclick = () => this.abrirLista(true);
      $('btnUnidade').onclick = () => {
        this.escopo = 'unidade';
        this.estado = 'armado';
        $('cartao').innerHTML = '';
        toast('Procurando em toda a unidade', 'warn');
      };
    }
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
          ' · dist ' + c.dist.toFixed(3) +
          (cinza ? ' · vai para conferência' : '') + '</div></div>' +
        '</div>' +
        '<button class="act big" id="btnConfirmar">CONFIRMAR ' + (tipo === 'entrada' ? 'ENTRADA' : 'SAÍDA') + '</button>' +
        '<button class="act ghost" id="btnOutro">Não é essa pessoa</button>' +
      '</div>';
    $('btnConfirmar').onclick = () => this.registrar(c.pessoa, c.cap, c.veredito, c.dist, 'biometria');
    $('btnOutro').onclick = () => this.abrirLista(false);
  },

  abrirLista(manual) {
    this.estado = 'confirmando';
    const gente = this.galeria().slice()
      .concat((this.carga.sem_cadastro || []).map(p => Object.assign({ _sem: true }, p)))
      .sort((a, b) => a.nome.localeCompare(b.nome));
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
        const alvo = (this.carga.pessoas || []).concat(this.carga.sem_cadastro || [])
          .find(x => x.pessoa_id === b.dataset.id);
        if (!alvo) return;
        const motivo = manual ? ($('motivoManual').value || '').trim() : 'confirmado pelo gestor';
        if (manual && !motivo) { toast('Informe o motivo', 'warn'); return; }
        this.registrar(alvo, manual ? null : (this.candidato && this.candidato.cap),
          manual ? 'manual' : 'revisar',
          manual ? null : (this.candidato && this.candidato.dist),
          manual ? 'manual' : 'biometria', motivo);
      };
    });
    if (!manual && $('btnRecad')) $('btnRecad').onclick = () => this.recadastrar();
    $('btnCancelar').onclick = () => { this.estado = 'armado'; $('cartao').innerHTML = ''; };
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
    $('btnCancelar2').onclick = () => { this.estado = 'armado'; $('cartao').innerHTML = ''; };
  },

  async capturarRecadastro(pessoaId) {
    const alvo = (this.carga.pessoas || []).find(p => p.pessoa_id === pessoaId);
    if (!alvo) return;
    $('cartao').innerHTML = '<div class="cartao"><div class="tit">Recadastrando ' + esc(alvo.nome) + '</div>' +
      '<div class="sub">Peça para olhar de frente. Vou capturar 3 vezes.</div></div>';
    const capturas = [];
    for (let i = 0; i < 3; i++) {
      const r = await Face.capturar($('video'));
      if (!r || r.reprovado) { toast('Captura ' + (i + 1) + ' reprovada', 'warn'); this.estado = 'armado'; $('cartao').innerHTML = ''; return; }
      capturas.push(r);
      await new Promise(res => setTimeout(res, 600));
    }
    const env = await Api.cadastrar(this.token, {
      origem: 'gestor', pessoa_id: pessoaId, nome: alvo.nome, matricula: alvo.matricula,
      equipe_id: alvo.equipe_id, vetores: capturas.map(c => c.descritor),
      miniatura: capturas[0].thumb, coerencia: 0
    });
    this.estado = 'armado';
    $('cartao').innerHTML = '';
    toast(env.ok ? 'Enviado para aprovação do RH' : (env.erro || 'Falha ao enviar'), env.ok ? 'ok' : 'bad');
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

  async registrar(pessoa, cap, veredito, dist, origem, motivo, ehGestor) {
    this.estado = 'processando';
    const quando = agoraCorrigido(this.deriva);
    const tipo = tipoDaVez(this.doDia.filter(m => m.pessoa_id === pessoa.pessoa_id));
    const pos = await this.posicao();
    // Mesma regra do servidor. Marcação de gestor sempre é conferida.
    const revisar = veredito !== 'aceito' || origem === 'manual'
      || pessoa.papel === 'gestor' || Math.abs(this.deriva) > 120000;

    const m = {
      id_cliente: (crypto.randomUUID ? crypto.randomUUID()
        : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2)),
      pessoa_id: pessoa.pessoa_id,
      equipe_id: pessoa.equipe_id || '',
      tipo, origem, veredito,
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
    this.comprovante(m, pessoa, ehGestor);
    this.sincronizar();
  },

  comprovante(m, pessoa, ehGestor) {
    this.estado = 'comprovante';
    $('cartao').innerHTML =
      '<div class="cartao ok">' +
        '<div class="tit">✓ ' + (m.tipo === 'entrada' ? 'ENTRADA' : 'SAÍDA') + '</div>' +
        '<div class="sub">' + esc(pessoa.nome) + ' · ' + hora(m.marcado_em) +
        ' · comprovante <b>' + m.id_cliente.slice(0, 8).toUpperCase() + '</b></div>' +
        (ehGestor ? '<div class="sub okfg">Fila aberta. Pode chamar o primeiro.</div>' : '') +
      '</div>';
    clearTimeout(this._t);
    this._t = setTimeout(() => {
      this.estado = 'armado';
      $('cartao').innerHTML = '';
    }, ehGestor ? 2000 : 3500);
  },

  async sincronizar() {
    const r = await Api.sincronizar(this.token);
    if (r && r.resumo && r.resumo.rejeitadas > 0) {
      toast(r.resumo.rejeitadas + ' marcação(ões) rejeitada(s) pelo servidor', 'warn');
    }
    await this.recarregarDia();
  }
};
