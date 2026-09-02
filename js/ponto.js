// App de ponto — o colaborador no próprio celular. Uma tela, uma ação: olhar
// para a câmera. Diferente do piloto (gestor operando uma fila), aqui:
//
//   1. Face 1:1 — compara o rosto capturado com o template do PRÓPRIO usuário
//      (baixado na carga do dia). Confirma "é você", não descobre "quem é".
//   2. Liveness — pede uma piscada antes de aceitar. Foto na tela não pisca.
//   3. Cerca — o GPS precisa cair dentro do raio da alocação do dia.
//
// O ponto nunca é negado por falha técnica: sem cerca, fora da cerca ou sem
// liveness ele ainda grava, mas vai para revisão do RH. Offline-first: grava na
// fila local e confirma na tela; um processo de fundo esvazia quando há rede.
import { Store } from './store.js';
import { Api } from './api.js';
import { Face, DICA_ADORNO } from './face.js';
import { criarDetectorPiscada } from './liveness.js';
import { tipoDaVez, pontosDoDia, vereditoPorDistancia, emCooldown, agoraCorrigido, euclidiana, dia } from './regras.js';
import { $, esc, mostrar, toast, hora } from './ui.js';

const cfg = () => window.EFRAT_CFG;

export const Ponto = {
  dispositivo: null,   // { dispositivo_id, credencial, colaborador }
  template: null,      // { versao, vetores } do próprio colaborador
  alocacao: null,      // { equipe_id, equipe_nome, cerca } ou null
  deriva: 0,
  estado: 'parado',    // parado | aguardando | liveness | processando | comprovante
  doDia: [],
  cam: null,
  piscada: null,
  aoSair: null,

  async abrir(dispositivo, carga, aoSair) {
    this.dispositivo = dispositivo;
    this.template = carga.template;
    this.alocacao = carga.alocacao;
    this.deriva = carga.deriva || 0;
    this.aoSair = aoSair;
    mostrar('fila');
    $('cartao').innerHTML = '';
    $('quemFila') && ($('quemFila').textContent = dispositivo.colaborador.nome.split(' ')[0]);
    $('btnFecharCamera').onclick = () => this.fecharCamera();
    await this.recarregarDia();
    this.pintarPainelDia();   // começa no PAINEL DO DIA, câmera fechada
  },

  /* --------------------------------------------------- painel do dia */

  /**
   * Tela inicial: os 4 pontos padrão (manhã E/S, tarde E/S). A câmera fica
   * fechada; só abre quando a pessoa toca em "bater o próximo ponto".
   */
  pintarPainelDia() {
    this.fecharCamera();   // garante câmera desligada
    $('cartao').innerHTML = '';
    const { slots, proximo, completo } = pontosDoDia(this.doDia);

    if (!this.template) {
      $('painelDia').innerHTML =
        '<div class="card"><div class="tit">Cadastro facial pendente</div>' +
        '<p class="nota">O RH ainda não cadastrou seu rosto. Procure o RH.</p></div>';
      return;
    }

    const linhas = slots.map((s, i) => {
      const ativo = i === proximo;
      const h = s.batido ? hora(s.marcacao.marcado_em) : '';
      return '<div class="slot ' + (s.batido ? 'batido' : ativo ? 'ativo' : 'pendente') + '">' +
        '<div class="slot-ic">' + (s.batido ? '✓' : ativo ? '➜' : '') + '</div>' +
        '<div class="slot-tx"><div class="slot-rot">' + s.rotulo + '</div>' +
          '<div class="slot-sub">' + (s.batido ? 'às ' + h : ativo ? 'próximo a bater' : 'aguardando') + '</div></div>' +
        (s.batido ? '<div class="slot-h mono">' + h + '</div>' : '') +
      '</div>';
    }).join('');

    const alocTxt = this.alocacao
      ? 'Local de hoje: ' + esc(this.alocacao.equipe_nome || 'sua equipe')
      : '⚠ Sem alocação hoje — o ponto irá para conferência do RH';

    $('painelDia').innerHTML =
      '<div class="card diacard">' +
        '<div class="dia-topo"><span class="lb">Hoje</span>' +
          '<span class="dia-prog mono">' + slots.filter(s => s.batido).length + '/4</span></div>' +
        '<div class="slots-dia">' + linhas + '</div>' +
        '<p class="nota aloc-nota">' + alocTxt + '</p>' +
        (completo
          ? '<div class="dia-ok">✓ Dia completo. Todos os pontos registrados.</div>'
          : '<button class="act big" id="btnBater">Bater ' + slots[proximo].rotulo.toLowerCase() + '</button>') +
      '</div>';

    if (!completo) $('btnBater').onclick = () => this.abrirCamera();
  },

  /* ------------------------------------------------------- câmera */

  async abrirCamera() {
    $('painelDia').classList.add('hide');
    $('areaCamera').classList.remove('hide');
    if (!(await this.ligarCamera())) { this.fecharCamera(); return; }
    this.iniciarCiclo();
  },

  fecharCamera() {
    this.pararCamera();
    $('areaCamera') && $('areaCamera').classList.add('hide');
    $('painelDia') && $('painelDia').classList.remove('hide');
    this.estado = 'parado';
  },

  iniciarCiclo() {
    this.estado = 'aguardando';
    this.piscada = null;
    const { slots, proximo } = pontosDoDia(this.doDia);
    const rot = proximo != null ? slots[proximo].rotulo : 'ponto';
    $('dica').textContent = 'Registrando: ' + rot + ' — olhe para a câmera';
    if (!this.alocacao) toast('Sem alocação hoje — irá para conferência do RH', 'warn');
  },

  async ligarCamera() {
    if (this.cam) return true;
    try {
      this.cam = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 960 } }, audio: false
      });
      const v = $('video');
      v.srcObject = this.cam; await v.play();
      $('camOff').classList.add('hide');
      Face.iniciar(v, $('overlay'), {
        onQualidade: q => this.aoQuadro(q),
        autoCaptura: () => this.estado === 'aguardando',
        onCaptura: c => this.aoCapturar(c)
      });
      return true;
    } catch (e) { toast('Sem acesso à câmera: ' + e.name, 'bad'); return false; }
  },

  /** Cada quadro: mostra a dica e, na fase de liveness, alimenta o detector de piscada. */
  aoQuadro(q) {
    if (this.estado === 'processando' || this.estado === 'comprovante') return;
    if (this.estado === 'liveness') {
      $('dica').textContent = 'Pisque os olhos';
      $('dica').style.color = '#2d6cdf';
      if (q.rosto && q.ear != null && this.piscada && this.piscada.alimentar(q.ear)) {
        this.aposLiveness();
      }
      return;
    }
    const base = !q.rosto ? DICA_ADORNO : q.msg;
    $('dica').textContent = base + (Face.latencia ? ' · ' + Face.latencia + ' ms' : '');
    $('dica').style.color = q.ok ? '#28a745' : '#e0a800';
  },

  /** Capturou um quadro bom: confere 1:1 e, se bater, entra na fase de liveness. */
  async aoCapturar(cap) {
    if (this.estado !== 'aguardando') return;
    if (!cap || !cap.descritor) return;
    this.estado = 'processando';
    $('dica').textContent = 'Conferindo…';

    // 1:1 — menor distância entre o capturado e os vetores do próprio template.
    const dists = (this.template.vetores || []).map(v => euclidiana(cap.descritor, v));
    const dist = dists.length ? Math.min.apply(null, dists) : Infinity;
    const veredito = vereditoPorDistancia(dist, cfg());

    if (veredito === 'rejeitado') {
      this.estado = 'aguardando';
      $('cartao').innerHTML = '<div class="cartao warn"><div class="tit">Não reconheci você</div>' +
        '<div class="sub">Tire óculos escuros/máscara e tente de novo, de frente.</div></div>';
      setTimeout(() => { if (this.estado === 'aguardando') $('cartao').innerHTML = ''; }, 2500);
      return;
    }

    const pid = this.dispositivo.colaborador.id;
    if (emCooldown(pid, this.doDia, Date.now(), cfg().cooldownMs)) {
      this.estado = 'aguardando';
      toast('Você já marcou agora há pouco', 'warn');
      return;
    }

    this.capPendente = { cap, dist, veredito };
    if (cfg().livenessAtivo) {
      this.estado = 'liveness';
      this.piscada = criarDetectorPiscada();
      this._livenessInicio = Date.now();
      this._livenessTimer = setTimeout(() => this.aposLiveness(), cfg().livenessTimeoutMs);
    } else {
      this.aposLiveness();
    }
  },

  async aposLiveness() {
    if (this.estado !== 'liveness' && this.capPendente == null) return;
    clearTimeout(this._livenessTimer);
    const passou = this.piscada ? this.piscada.completo : true;
    this.estado = 'processando';
    await this.registrar(this.capPendente, passou);
    this.capPendente = null;
  },

  /* -------------------------------------------------------- geo + marcação */

  posicao() {
    return new Promise(res => {
      if (!navigator.geolocation) return res(null);
      let feito = false;
      const t = setTimeout(() => { if (!feito) { feito = true; res(null); } }, cfg().geoTimeoutMs);
      navigator.geolocation.getCurrentPosition(
        p => { if (!feito) { feito = true; clearTimeout(t); res(p); } },
        () => { if (!feito) { feito = true; clearTimeout(t); res(null); } },
        { enableHighAccuracy: true, timeout: cfg().geoTimeoutMs, maximumAge: 30000 });
    });
  },

  async registrar({ cap, dist, veredito }, livenessOk) {
    const quando = agoraCorrigido(this.deriva);
    const tipo = tipoDaVez(this.doDia.filter(m => m.pessoa_id === this.dispositivo.colaborador.id));
    const pos = await this.posicao();
    const col = this.dispositivo.colaborador;

    const m = {
      id_cliente: crypto.randomUUID(),
      pessoa_id: col.id,
      equipe_id: (this.alocacao && this.alocacao.equipe_id) || '',
      tipo, origem: 'biometria', veredito,
      score: Number(dist.toFixed(4)),
      liveness_ok: livenessOk,
      marcado_em: quando.toISOString(),
      marcado_dia: dia(quando.toISOString()),
      deriva_ms: this.deriva,
      lat: pos ? pos.coords.latitude : null,
      lng: pos ? pos.coords.longitude : null,
      precisao_m: pos ? pos.coords.accuracy : null,
      // Foto de auditoria só quando pode ir para revisão — o servidor decide, mas
      // já mandamos quando há sinal de exceção (cinza, sem liveness, sem GPS).
      foto_url: (veredito === 'revisar' || !livenessOk || !pos) ? cap.thumb : '',
      _nome: col.nome
    };

    await Store.enfileirar(m);
    await Store.registrar('marcacao', { tipo, veredito, liveness: livenessOk });
    await this.recarregarDia();
    this.comprovante(m);
    Api.sincronizar(this.dispositivo.credencial);
  },

  comprovante(m) {
    this.estado = 'comprovante';
    // Desliga a câmera na hora — o ponto já foi capturado, não precisa mais dela.
    this.pararCamera();
    $('areaCamera').classList.add('hide');
    const col = this.dispositivo.colaborador;
    $('cartao').innerHTML =
      '<div class="cartao ok">' +
        '<div class="tit">✓ ' + (m.tipo === 'entrada' ? 'ENTRADA' : 'SAÍDA') + ' registrada</div>' +
        '<div class="horaGrande">' + hora(m.marcado_em) + '</div>' +
        '<div class="sub">' + esc(col.nome) + ' · comprovante <b class="mono">' +
          m.id_cliente.slice(0, 8).toUpperCase() + '</b></div>' +
      '</div>';
    // Depois do comprovante, volta ao PAINEL DO DIA (mostra os registros), não
    // reabre a câmera — é o que o usuário pediu: só mostra a câmera se tocar.
    clearTimeout(this._t);
    this._t = setTimeout(() => {
      $('cartao').innerHTML = '';
      $('painelDia').classList.remove('hide');
      this.pintarPainelDia();
    }, 3000);
  },

  async recarregarDia() {
    const hoje = dia(agoraCorrigido(this.deriva).toISOString());
    this.doDia = await Store.doDia(hoje);
  },

  pararCamera() {
    Face.parar();
    if (this.cam) { this.cam.getTracks().forEach(t => t.stop()); this.cam = null; }
    clearTimeout(this._t); clearTimeout(this._livenessTimer);
  },

  sair() {
    this.pararCamera();
    $('cartao').innerHTML = '';
    this.estado = 'parado';
    this.capPendente = null;
    if (this.aoSair) this.aoSair();
  }
};
