// App de ponto — o colaborador no próprio celular. Uma tela, uma ação: olhar
// para a câmera. Diferente do piloto (gestor operando uma fila), aqui:
//
//   1. Face 1:1 — compara o rosto capturado com o template do PRÓPRIO usuário
//      (baixado na carga do dia). Confirma "é você", não descobre "quem é".
//   2. Liveness — pede para virar o rosto e voltar. Foto na tela não gira.
//   3. Cerca — o GPS precisa cair dentro do raio da alocação do dia.
//
// O ponto nunca é negado por falha técnica: sem cerca, fora da cerca ou sem
// liveness ele ainda grava, mas vai para revisão do RH. Offline-first: grava na
// fila local e confirma na tela; um processo de fundo esvazia quando há rede.
import { Store } from './store.js';
import { Api } from './api.js';
import { Face, DICA_ADORNO } from './face.js';
import { criarDetectorGiro } from './liveness.js';
import { tipoDaVez, pontosDoDia, vereditoPorDistancia, emCooldown, agoraCorrigido, euclidiana, dia } from './regras.js';
import { $, esc, mostrar, toast, hora, reduzirImagem } from './ui.js';

const cfg = () => window.EFRAT_CFG;

export const Ponto = {
  dispositivo: null,   // { dispositivo_id, credencial, colaborador }
  template: null,      // { versao, vetores } do próprio colaborador
  alocacao: null,      // { equipe_id, equipe_nome, cerca } ou null
  deriva: 0,
  estado: 'parado',    // parado | aguardando | liveness | processando | comprovante
  doDia: [],
  cam: null,
  giro: null,
  yawsDeFrente: [],    // giro dos últimos quadros enquadrando o rosto: linha de base da prova de vida
  aoSair: null,
  aoProvar: null,      // assinatura da folha: recebe a prova do rosto em vez de registrar batida
  falhasProva: 0,      // prova de vida reprovada na assinatura/ciência/EPI (reinicia ao abrir a câmera)
  provaSemVida: false, // enviada sem prova de vida: o fim avisa que o RH vai conferir

  async abrir(dispositivo, carga, aoSair) {
    this.dispositivo = dispositivo;
    this.template = carga.template;
    this.alocacao = carga.alocacao;
    this.deriva = carga.deriva || 0;
    this.aoSair = aoSair;
    mostrar('fila');
    $('cartao').innerHTML = '';
    // Modo cadastro: aparelho pendente (link da empresa) — sem colaborador nem template.
    this.modoCadastro = !dispositivo.colaborador;
    $('quemFila') && ($('quemFila').textContent = dispositivo.colaborador ? dispositivo.colaborador.nome.split(' ')[0] : 'primeiro acesso');
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

    if (!this.template && !this.modoCadastro) {
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

    const alocTxt = this.modoCadastro
      ? 'Seu cadastro ainda será confirmado pelo RH. Pode bater o ponto normalmente: ele vale depois da confirmação.'
      : this.alocacao
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
    this.falhasProva = 0;
    this.provaSemVida = false;
    $('painelDia').classList.add('hide');
    $('areaCamera').classList.remove('hide');
    if (!(await this.ligarCamera())) { this.fecharCamera(); return; }
    this.iniciarCiclo();
  },

  fecharCamera() {
    this.pararCamera();
    const aviso = $('cartaoProva'); if (aviso) aviso.remove();   // aviso de prova de vida reprovada
    this.provaSemVida = false;   // envio sem prova de vida que falhou não marca o próximo fim (contestação, atestado)
    $('areaCamera') && $('areaCamera').classList.add('hide');
    $('painelDia') && $('painelDia').classList.remove('hide');
    this.estado = 'parado';
  },

  iniciarCiclo() {
    this.estado = 'aguardando';
    this.giro = null;
    this.yawsDeFrente = [];
    this.textoPrivacidade();
    if (this.aoProvar) { $('dica').textContent = 'Confirmando que é você. Olhe para a câmera'; return; }
    const { slots, proximo } = pontosDoDia(this.doDia);
    const rot = proximo != null ? slots[proximo].rotulo : 'ponto';
    $('dica').textContent = 'Registrando ' + rot + '. Olhe para a câmera';
    if (!this.alocacao && !this.modoCadastro) toast('Sem alocação hoje — irá para conferência do RH', 'warn');
  },

  /** O que acontece com a foto do rosto, conforme o uso da câmera. */
  textoPrivacidade() {
    const el = $('privacidade'); if (!el) return;
    el.textContent = this.aoProvar
      ? 'Uma foto do seu rosto fica guardada como prova.'
      : this.modoCadastro
        ? 'Uma foto do seu rosto fica guardada para o RH confirmar o seu cadastro.'
        : 'A foto do rosto só é guardada quando a marcação vai para conferência do RH.';
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

  /** Cada quadro: mostra a dica e, na fase de liveness, alimenta o detector de giro. */
  aoQuadro(q) {
    if (this.estado === 'processando' || this.estado === 'comprovante') return;
    if (this.estado === 'aguardando' && q.rosto && Number.isFinite(q.yaw)) {
      this.yawsDeFrente.push(q.yaw);
      if (this.yawsDeFrente.length > 8) this.yawsDeFrente.shift();
    }
    if (this.estado === 'liveness') {
      $('dica').textContent = 'Vire o rosto devagar para um lado e volte';
      $('dica').style.color = '#2d6cdf';
      if (q.rosto && Number.isFinite(q.yaw) && this.giro && this.giro.alimentar(q.yaw)) {
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

    // Modo cadastro: não há com quem comparar. Exige quadro de boa qualidade (vai
    // virar o cadastro facial) e segue para a prova de vida; o RH confirma depois.
    if (this.modoCadastro) {
      if (cap.reprovado) {
        this.estado = 'aguardando';
        $('cartao').innerHTML = '<div class="cartao warn"><div class="tit">Preciso de uma foto melhor</div>' +
          '<div class="sub">De frente, com boa luz, sem boné ou óculos escuros.</div></div>';
        setTimeout(() => { if (this.estado === 'aguardando') $('cartao').innerHTML = ''; }, 2500);
        return;
      }
      this.capPendente = { cap, dist: null, veredito: 'revisar' };
      if (cfg().livenessAtivo) {
        this.estado = 'liveness';
        this.giro = criarDetectorGiro(this.yawsDeFrente);
        this._livenessTimer = setTimeout(() => this.aposLiveness(), cfg().livenessTimeoutMs);
      } else this.aposLiveness();
      return;
    }

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

    const pid = this.dispositivo.colaborador ? this.dispositivo.colaborador.id : null;
    if (!this.aoProvar && emCooldown(pid, this.doDia, Date.now(), cfg().cooldownMs)) {
      this.estado = 'aguardando';
      toast('Você já marcou agora há pouco', 'warn');
      return;
    }

    this.capPendente = { cap, dist, veredito };
    if (cfg().livenessAtivo) {
      this.estado = 'liveness';
      this.giro = criarDetectorGiro(this.yawsDeFrente);
      this._livenessInicio = Date.now();
      this._livenessTimer = setTimeout(() => this.aposLiveness(), cfg().livenessTimeoutMs);
    } else {
      this.aposLiveness();
    }
  },

  async aposLiveness() {
    if (this.estado !== 'liveness' && this.capPendente == null) return;
    clearTimeout(this._livenessTimer);
    const passou = this.giro ? this.giro.completo : true;
    this.estado = 'processando';
    if (this.aoProvar) {
      const pendente = this.capPendente;
      this.capPendente = null;
      // Assinatura, ciência e EPI não seguem com a prova de vida reprovada: a pessoa
      // tenta de novo. Depois de 2 falhas pode enviar mesmo assim, e o RH confere.
      if (!passou) { this.provaReprovada(pendente); return; }
      await this.entregarProva(pendente, true);
      return;
    }
    await this.registrar(this.capPendente, passou);
    this.capPendente = null;
  },

  /** Envia a prova do rosto para quem pediu (folha, ciência, EPI). */
  async entregarProva({ cap, dist }, livenessOk) {
    const fn = this.aoProvar;
    if (!fn) return;
    this.provaSemVida = !livenessOk;
    const aviso = $('cartaoProva'); if (aviso) aviso.remove();
    const pos = await this.posicao();
    this.pararCamera();
    $('areaCamera').classList.add('hide');
    await fn({ score: dist == null ? null : Number(dist.toFixed(4)), liveness_ok: livenessOk, foto: cap.thumb || null,
               lat: pos ? pos.coords.latitude : null, lng: pos ? pos.coords.longitude : null,
               precisao_m: pos ? pos.coords.accuracy : null, deriva_ms: this.deriva });
  },

  /** Prova de vida reprovada na assinatura: pede outra tentativa com a câmera aberta. */
  provaReprovada(pendente) {
    this.falhasProva++;
    this.giro = null;
    $('dica').textContent = '';
    const podeEnviar = this.falhasProva >= 2;
    $('cartao').innerHTML = '<div class="cartao warn" id="cartaoProva"><div class="tit">Não vi você virar o rosto. Vamos tentar de novo</div>' +
      '<div class="sub">Olhe para a câmera e, quando pedir, vire o rosto devagar para um lado e volte.</div>' +
      '<button class="act big" id="btnProvaDeNovo" style="margin-top:12px">Tentar de novo</button>' +
      (podeEnviar
        ? '<button class="act ghost" id="btnProvaMesmoAssim" style="margin-top:8px">Enviar mesmo assim</button>' +
          '<div class="sub" style="margin-top:6px">Se enviar assim, o RH vai conferir porque a prova de vida não passou.</div>'
        : '') +
      '</div>';
    $('btnProvaDeNovo').onclick = () => {
      $('cartao').innerHTML = '';
      this.iniciarCiclo();
    };
    if (podeEnviar) $('btnProvaMesmoAssim').onclick = () => {
      $('cartao').innerHTML = '';
      this.entregarProva(pendente, false);
    };
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
    const col = this.dispositivo.colaborador;   // null no modo cadastro
    const meuId = col ? col.id : null;
    const tipo = tipoDaVez(this.doDia.filter(m => (m.pessoa_id || null) === meuId));
    const pos = await this.posicao();

    const m = {
      id_cliente: crypto.randomUUID(),
      pessoa_id: meuId,
      equipe_id: (this.alocacao && this.alocacao.equipe_id) || '',
      tipo, origem: 'biometria', veredito,
      score: dist == null ? null : Number(dist.toFixed(4)),
      liveness_ok: livenessOk,
      marcado_em: quando.toISOString(),
      marcado_dia: dia(quando.toISOString(), await this.fuso()),
      deriva_ms: this.deriva,
      lat: pos ? pos.coords.latitude : null,
      lng: pos ? pos.coords.longitude : null,
      precisao_m: pos ? pos.coords.accuracy : null,
      // Foto de auditoria só quando pode ir para revisão — o servidor decide, mas
      // já mandamos quando há sinal de exceção (cinza, sem liveness, sem GPS).
      foto_url: (veredito === 'revisar' || !livenessOk || !pos) ? cap.thumb : '',
      // Prova de vida que falhou leva a medida do olho, para ajustar o detector com dado real.
      motivo: livenessOk ? undefined : this.diagnosticoLiveness(),
      _nome: col ? col.nome : ''
    };
    // Aparelho pendente: a 1ª marcação leva o cadastro facial (descritor + miniatura)
    // que vira template quando o RH identificar a pessoa. O servidor guarda só uma vez.
    if (this.modoCadastro) m.cadastro = { vetores: [cap.descritor], miniatura: cap.thumb };

    await Store.enfileirar(m);
    await Store.registrar('marcacao', { tipo, veredito, liveness: livenessOk });
    await this.recarregarDia();
    this.comprovante(m);
    Api.sincronizar(this.dispositivo.credencial);
  },

  diagnosticoLiveness() {
    const d = this.giro ? this.giro.diagnostico : null;
    const f = v => v == null ? '-' : v.toFixed(3).replace('.', ',');
    return d ? 'prova de vida (giro): base ' + f(d.base) + ', maior desvio ' + f(d.maior_desvio) + ', ' + d.quadros + ' quadros' : 'prova de vida: sem leitura do rosto';
  },

  comprovante(m) {
    this.estado = 'comprovante';
    // Desliga a câmera na hora — o ponto já foi capturado, não precisa mais dela.
    this.pararCamera();
    $('areaCamera').classList.add('hide');
    const col = this.dispositivo.colaborador;
    if (this.modoCadastro) {
      // Primeiro ponto sem cadastro: confirma, explica em uma linha e oferece a
      // matrícula como atalho OPCIONAL para o RH — nunca como barreira.
      $('cartao').innerHTML =
        '<div class="cartao ok">' +
          '<div class="tit">✓ ' + (m.tipo === 'entrada' ? 'ENTRADA' : 'SAÍDA') + ' registrada</div>' +
          '<div class="horaGrande">' + hora(m.marcado_em) + '</div>' +
          '<div class="sub">O RH vai confirmar seu cadastro. Este ponto já conta.</div>' +
          (this.dispositivo.matricula_informada ? '' :
            '<div class="sub" style="margin-top:12px">Sabe sua matrícula? Informe para o RH liberar mais rápido (opcional).</div>' +
            '<div class="row2" style="margin-top:6px"><input type="text" id="cadMatricula" class="inp" placeholder="matrícula" inputmode="numeric" style="margin:0">' +
            '<button class="act" id="cadEnviarMat" style="margin:0">Enviar</button></div>') +
          '<button class="act ghost" id="cadOk" style="margin-top:12px">Voltar</button>' +
        '</div>';
      const voltar = () => { $('cartao').innerHTML = ''; $('painelDia').classList.remove('hide'); this.pintarPainelDia(); };
      $('cadOk').onclick = voltar;
      const env = $('cadEnviarMat');
      if (env) env.onclick = async () => {
        const mat = ($('cadMatricula').value || '').trim();
        if (!mat) { voltar(); return; }
        env.disabled = true;
        const r = await Api.informarMatricula(this.dispositivo.credencial, mat);
        if (r.ok) { this.dispositivo.matricula_informada = mat; await Store.set('matricula_informada', mat); toast('Matrícula enviada ao RH', 'ok'); }
        else toast('Não consegui enviar agora. Tudo bem, o RH identifica pela foto.', 'warn');
        voltar();
      };
      return;
    }
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
    const hoje = dia(agoraCorrigido(this.deriva).toISOString(), await this.fuso());
    this.doDia = await Store.doDia(hoje);
  },

  /** Fuso da empresa (vem da carga do dia); sem ele, o do próprio aparelho. */
  async fuso() {
    return (await Store.get('fuso')) || Intl.DateTimeFormat().resolvedOptions().timeZone;
  },

  pararCamera() {
    Face.parar();
    if (this.cam) { this.cam.getTracks().forEach(t => t.stop()); this.cam = null; }
    clearTimeout(this._t); clearTimeout(this._livenessTimer);
  },

  /* ------------------------------------------- ciência de advertência/notificação */

  /** Mostra o documento e colhe a ciência pelo rosto. Ciência não é concordância. */
  async darCiencia(dispositivo, carga, ev, termo, aoSair) {
    this.dispositivo = dispositivo;
    this.template = carga.template;
    this.alocacao = null;
    this.deriva = carga.deriva || 0;
    this.aoSair = aoSair;
    this.modoCadastro = false;
    this.aoProvar = null;
    mostrar('fila');
    $('cartao').innerHTML = '';
    $('quemFila') && ($('quemFila').textContent = dispositivo.colaborador.nome.split(' ')[0]);
    $('btnFecharCamera').onclick = () => this.fecharCamera();
    await this.recarregarDia();
    this.fecharCamera();
    const dm = s => s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4);
    const rot = ev.tipo === 'advertencia' ? 'Advertência' : 'Notificação';
    $('painelDia').innerHTML =
      '<div class="card diacard">' +
        '<div class="dia-topo"><span class="lb">' + rot + ' de ' + dm(ev.data) + '</span></div>' +
        (ev.obra ? '<p class="nota" style="text-align:left;margin:0 0 6px">Obra: ' + esc(ev.obra) + '</p>' : '') +
        '<p style="text-align:left;white-space:pre-wrap;font-size:14px;line-height:1.5;margin:6px 0">' + esc(ev.descricao) + '</p>' +
        (ev.anexo ? '<img src="' + ev.anexo + '" alt="Documento" style="width:100%;border-radius:10px;border:1px solid var(--linha);margin:6px 0">' : '') +
        '<label class="folha-termo"><input type="checkbox" id="cienAceite"><span>' + esc(termo) + '</span></label>' +
        '<button class="act big" id="btnCiente" disabled>Dar ciência com o rosto</button>' +
      '</div>';
    $('cienAceite').onchange = () => { $('btnCiente').disabled = !$('cienAceite').checked; };
    $('btnCiente').onclick = () => {
      this.aoProvar = async prova => {
        $('painelDia').classList.remove('hide');
        $('cartao').innerHTML = '<div class="cartao"><div class="tit">Enviando…</div></div>';
        const r = await Api.evento(this.dispositivo.credencial, { acao: 'ciente', id: ev.id, prova });
        if (!r.ok) { $('cartao').innerHTML = ''; toast(r.erro || 'Não consegui enviar. Tente com sinal.', 'bad'); this.aoProvar = null; return; }
        this.fimFolha('Ciência registrada.', 'ok', r.em);
      };
      this.abrirCamera();
    };
  },

  /* ------------------------------------------- recebimento de EPI e ferramentas */

  /** Lista o que foi entregue e colhe a confirmação pelo rosto (ficha de EPI da NR-6). */
  async confirmarEntregas(dispositivo, carga, entregas, termo, aoSair) {
    this.dispositivo = dispositivo;
    this.template = carga.template;
    this.alocacao = null;
    this.deriva = carga.deriva || 0;
    this.aoSair = aoSair;
    this.modoCadastro = false;
    this.aoProvar = null;
    mostrar('fila');
    $('cartao').innerHTML = '';
    $('quemFila') && ($('quemFila').textContent = dispositivo.colaborador.nome.split(' ')[0]);
    $('btnFecharCamera').onclick = () => this.fecharCamera();
    await this.recarregarDia();
    this.fecharCamera();
    const dm = s => s ? s.slice(8, 10) + '/' + s.slice(5, 7) : '';
    $('painelDia').innerHTML =
      '<div class="card diacard">' +
        '<div class="dia-topo"><span class="lb">Itens recebidos</span></div>' +
        '<table class="folha-mini"><tbody>' + entregas.map(e =>
          '<tr><td>' + esc(e.nome) + (e.ca ? '<br><span class="nota" style="margin:0">CA ' + esc(e.ca) + '</span>' : '') +
            (e.devolver_ate ? '<br><span class="nota" style="margin:0">devolver até ' + dm(e.devolver_ate) + '</span>' : '') + '</td>' +
          '<td>' + e.quantidade + ' un. · ' + dm(e.entregue_em) + '</td></tr>').join('') + '</tbody></table>' +
        '<label class="folha-termo"><input type="checkbox" id="epiAceite"><span>' + esc(termo) + '</span></label>' +
        '<button class="act big" id="btnEpiOk" disabled>Confirmar com o rosto</button>' +
        '<p class="nota">Se algo não confere, não confirme e fale com o almoxarifado.</p>' +
      '</div>';
    $('epiAceite').onchange = () => { $('btnEpiOk').disabled = !$('epiAceite').checked; };
    $('btnEpiOk').onclick = () => {
      this.aoProvar = async prova => {
        $('painelDia').classList.remove('hide');
        $('cartao').innerHTML = '<div class="cartao"><div class="tit">Enviando…</div></div>';
        const r = await Api.almox(this.dispositivo.credencial, { acao: 'confirmar', ids: entregas.map(e => e.id), prova });
        if (!r.ok) { $('cartao').innerHTML = ''; toast(r.erro || 'Não consegui enviar. Tente com sinal.', 'bad'); this.aoProvar = null; return; }
        this.fimFolha('Recebimento confirmado.', 'ok', r.em);
      };
      this.abrirCamera();
    };
  },

  /* ------------------------------------------------ atestado pelo app */

  /** Foto do atestado + data + dias. Vai para o RH aprovar; só então abona os dias. */
  async enviarAtestado(dispositivo, aoSair) {
    this.dispositivo = dispositivo;
    this.aoSair = aoSair;
    this.aoProvar = null;
    mostrar('fila');
    this.fecharCamera();
    $('cartao').innerHTML = '';
    $('quemFila') && ($('quemFila').textContent = dispositivo.colaborador.nome.split(' ')[0]);
    const hoje = dia(agoraCorrigido(this.deriva || 0).toISOString(), await this.fuso());
    $('painelDia').innerHTML =
      '<div class="card diacard">' +
        '<div class="dia-topo"><span class="lb">Enviar atestado médico</span></div>' +
        '<label class="lb2">Foto do atestado</label>' +
        '<input class="inp" type="file" accept="image/*" capture="environment" id="atFoto">' +
        '<img id="atPrev" class="hide" alt="" style="width:100%;border-radius:10px;margin:6px 0;border:1px solid var(--linha)">' +
        '<label class="lb2">Primeiro dia do atestado</label><input class="inp" type="date" id="atInicio" value="' + hoje + '">' +
        '<label class="lb2">Quantos dias</label><input class="inp" type="number" min="1" max="365" id="atDias" value="1" inputmode="numeric">' +
        '<label class="lb2">Observação (opcional)</label><input class="inp" id="atObs" placeholder="Ex.: consulta pela manhã">' +
        '<p class="nota" style="text-align:left">O RH confere a foto e aprova. O CID não é obrigatório.</p>' +
        '<button class="act big" id="atEnviar">Enviar ao RH</button>' +
      '</div>';
    let foto = null;
    $('atFoto').onchange = async () => {
      const f = $('atFoto').files && $('atFoto').files[0];
      if (!f) return;
      try { foto = await reduzirImagem(f); $('atPrev').src = foto; $('atPrev').classList.remove('hide'); }
      catch (e) { toast(e.message, 'bad'); }
    };
    $('atEnviar').onclick = async () => {
      if (!foto) { toast('Tire a foto do atestado', 'warn'); return; }
      $('atEnviar').disabled = true;
      const r = await Api.ocorrencia(this.dispositivo.credencial, { acao: 'enviar', inicio: $('atInicio').value,
        dias: Number($('atDias').value) || 1, anexo: foto, observacao: $('atObs').value.trim() });
      if (!r.ok) { $('atEnviar').disabled = false; toast(r.erro || 'Não consegui enviar. Tente com sinal.', 'bad'); return; }
      this.fimFolha('Atestado enviado. O RH vai conferir.', 'ok');
    };
  },

  /* ------------------------------------------- assinatura da folha de ponto */

  /**
   * Conferir e assinar a folha do mês. Mesma câmera, 1:1 e prova de vida da batida;
   * no fim, em vez de registrar ponto, manda a prova para api/folha. `folha`: linha
   * de folha_assinatura (conteudo = folhaDoMes). `termo`: texto do aceite.
   */
  async assinarFolha(dispositivo, carga, folha, termo, aoSair) {
    this.dispositivo = dispositivo;
    this.template = carga.template;
    this.alocacao = null;
    this.deriva = carga.deriva || 0;
    this.aoSair = aoSair;
    this.modoCadastro = false;
    this.aoProvar = null;
    mostrar('fila');
    $('cartao').innerHTML = '';
    $('quemFila') && ($('quemFila').textContent = dispositivo.colaborador.nome.split(' ')[0]);
    $('btnFecharCamera').onclick = () => this.fecharCamera();
    await this.recarregarDia();
    this.pintarFolha(folha, termo);
  },

  pintarFolha(folha, termo) {
    this.fecharCamera();
    const c = folha.conteudo || {}, t = c.totais || {};
    const hm = m => { const n = Math.round(Number(m) || 0); return Math.floor(n / 60) + 'h' + String(n % 60).padStart(2, '0'); };
    const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    const [ano, mes] = String(folha.mes).split('-').map(Number);
    const dias = (c.dias || []).filter(d => d.batidas.some(Boolean) || d.ocorrencia);
    $('painelDia').innerHTML =
      '<div class="card diacard">' +
        '<div class="dia-topo"><span class="lb">Folha de ' + MESES[mes - 1] + ' de ' + ano + '</span></div>' +
        '<table class="folha-mini"><tbody>' +
          '<tr><td>Dias trabalhados</td><td><b>' + (t.dias_trabalhados || 0) + '</b></td></tr>' +
          '<tr><td>Horas trabalhadas</td><td><b>' + hm(t.trabalhado) + '</b></td></tr>' +
          '<tr><td>Horas extras 50%</td><td><b>' + hm(t.extra50 != null ? t.extra50 : t.extra) + '</b></td></tr>' +
          (t.extra100 ? '<tr><td>Horas extras 100%</td><td><b>' + hm(t.extra100) + '</b></td></tr>' : '') +
          '<tr><td>Faltas</td><td><b>' + (t.faltas || 0) + '</b></td></tr>' +
        '</tbody></table>' +
        ((c.rateio || []).length ? '<p class="nota" style="text-align:left">' + c.rateio.map(r => esc(r.obra) + ': ' + r.dias + ' dia(s)').join('<br>') + '</p>' : '') +
        '<details class="folha-dias"><summary>Ver dia a dia (' + dias.length + ')</summary><table class="folha-mini"><tbody>' +
          dias.map(d => '<tr><td>' + String(d.num).padStart(2, '0') + ' ' + d.semana.slice(0, 3).toLowerCase() + '</td>' +
            '<td class="mono">' + d.batidas.filter(Boolean).join(' ') + '</td>' +
            '<td>' + (d.ocorrencia ? '<b>' + esc(d.ocorrencia.toLowerCase()) + '</b>' : hm(d.trabalhado) + (d.extra ? ' +' + hm(d.extra) : '')) + '</td></tr>').join('') +
        '</tbody></table></details>' +
        '<label class="folha-termo"><input type="checkbox" id="folhaAceite"><span>' + esc(termo) + '</span></label>' +
        '<button class="act big" id="btnAssinarFolha" disabled>Assinar com o rosto</button>' +
        '<button class="act ghost" id="btnContestarFolha" style="margin-top:8px">Não concordo</button>' +
      '</div>';
    $('folhaAceite').onchange = () => { $('btnAssinarFolha').disabled = !$('folhaAceite').checked; };
    $('btnAssinarFolha').onclick = () => {
      this.aoProvar = prova => this.enviarAssinatura(folha, termo, prova);
      this.abrirCamera();
    };
    $('btnContestarFolha').onclick = () => this.pintarContestacao(folha, termo);
  },

  pintarContestacao(folha, termo) {
    $('painelDia').innerHTML =
      '<div class="card diacard"><div class="dia-topo"><span class="lb">O que não confere?</span></div>' +
        '<textarea class="inp" id="folhaMotivo" rows="4" placeholder="Ex.: dia 15 eu trabalhei na obra 574 e aparece falta"></textarea>' +
        '<button class="act big" id="btnEnviarContestacao">Enviar ao RH</button>' +
        '<button class="act ghost" id="btnVoltarFolha" style="margin-top:8px">Voltar</button></div>';
    $('btnVoltarFolha').onclick = () => this.pintarFolha(folha, termo);
    $('btnEnviarContestacao').onclick = async () => {
      const motivo = $('folhaMotivo').value.trim();
      if (!motivo) { toast('Escreva o que não confere', 'warn'); return; }
      $('btnEnviarContestacao').disabled = true;
      const r = await Api.folha(this.dispositivo.credencial, { acao: 'contestar', id: folha.id, hash: folha.hash, motivo });
      if (!r.ok && this.folhaMudou(r)) { await this.recarregarFolha(folha, termo, r.codigo); return; }
      if (!r.ok) { $('btnEnviarContestacao').disabled = false; toast(r.erro || 'Não consegui enviar. Tente com sinal.', 'bad'); return; }
      this.fimFolha('O RH recebeu sua contestação e vai corrigir a folha.', 'warn');
    };
  },

  async enviarAssinatura(folha, termo, prova) {
    $('painelDia').classList.remove('hide');
    $('cartao').innerHTML = '<div class="cartao"><div class="tit">Enviando assinatura…</div></div>';
    const r = await Api.folha(this.dispositivo.credencial, { acao: 'assinar', id: folha.id, hash: folha.hash, prova });
    if (!r.ok) {
      $('cartao').innerHTML = '';
      // Folha refeita pelo RH (ou já respondida): reenviar o hash velho daria 409 de novo.
      if (this.folhaMudou(r)) { await this.recarregarFolha(folha, termo, r.codigo); return; }
      toast(r.erro || 'Não consegui enviar. Tente com sinal.', 'bad');
      this.pintarFolha(folha, termo);
      return;
    }
    this.fimFolha('Folha assinada. Obrigado!', 'ok', r.em);
  },

  /** A resposta diz que a folha que está na tela não é mais a do servidor? */
  folhaMudou(r) {
    return r && (r.codigo === 'FOLHA_ALTERADA' || r.codigo === 'JA_ASSINADA' || r.codigo === 'FOLHA_NAO_ENCONTRADA');
  },

  /**
   * Busca a folha de novo e repinta a conferência com o conteúdo atual (aceite
   * desmarcado). Sem folha aguardando, ou sem rede, encerra com aviso.
   */
  async recarregarFolha(folha, termo, codigo) {
    this.aoProvar = null;
    if (codigo === 'JA_ASSINADA') { this.fimFolha('Esta folha já foi assinada.', 'ok'); return; }
    const r = await Api.folha(this.dispositivo.credencial, { acao: 'listar' });
    if (!r.ok) { this.fimFolha('O RH atualizou a folha. Abra de novo para conferir.', 'warn'); return; }
    const fs = r.folhas || [];
    const nova = fs.find(f => f.id === folha.id && f.estado === 'aguardando') || fs.find(f => f.estado === 'aguardando');
    if (!nova) { this.fimFolha('Não há folha aguardando assinatura agora.', 'warn'); return; }
    this.pintarFolha(nova, r.termo || termo);
    toast('O RH atualizou a folha. Confira de novo antes de assinar.', 'warn');
  },

  fimFolha(msg, tipo, em) {
    this.aoProvar = null;
    const semVida = this.provaSemVida;
    this.provaSemVida = false;
    $('painelDia').innerHTML = '';
    $('cartao').innerHTML = '<div class="cartao ' + (semVida && tipo === 'ok' ? 'warn' : tipo) + '"><div class="tit">' + esc(msg) + '</div>' +
      (em ? '<div class="sub">Registrado às ' + hora(em) + '</div>' : '') +
      (semVida ? '<div class="sub">Enviado sem prova de vida: o RH vai conferir.</div>' : '') +
      '<button class="act ghost" id="btnFimFolha" style="margin-top:12px">Voltar</button></div>';
    $('btnFimFolha').onclick = () => this.sair();
  },

  sair() {
    this.pararCamera();
    this.aoProvar = null;
    $('cartao').innerHTML = '';
    this.estado = 'parado';
    this.capPendente = null;
    if (this.aoSair) this.aoSair();
  }
};
