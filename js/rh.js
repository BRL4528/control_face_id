// Painel do RH. Tudo que é administração vive aqui e em lugar nenhum mais.
import { ApiRh } from './api.js';
import { Face } from './face.js';
import { derivar } from './cripto.js';
import { indicadores, espelho, euclidiana } from './regras.js';
import { $, esc, mostrar, toast, hora, data } from './ui.js';

export const Rh = {
  cred: null,
  dados: null,
  aba: 'painel',
  aoSair: null,
  capturas: [],
  alvoCadastro: null,

  async entrar(usuario, senha) {
    const s = await ApiRh.sal(usuario);
    if (!s.ok) return { ok: false, erro: s.erro || 'servidor indisponível' };
    const chave = await derivar(senha, s.dados.sal, s.dados.iteracoes);
    const cred = { usuario, chave };
    const d = await ApiRh.dados(cred, 30);
    if (!d.ok) return { ok: false, erro: d.erro || 'usuário ou senha inválidos' };
    this.cred = cred;
    this.dados = d.dados;
    return { ok: true };
  },

  async recarregar() {
    const d = await ApiRh.dados(this.cred, 30);
    if (d.ok) this.dados = d.dados;
    this.pintar();
  },

  abrir(aoSair) {
    this.aoSair = aoSair;
    mostrar('rh');
    $('rhNome').textContent = this.dados.usuario.nome || 'RH';
    $('rhPeriodo').textContent = 'últimos ' + this.dados.periodo_dias + ' dias';
    document.querySelectorAll('#rh nav button').forEach(b => {
      b.onclick = () => { this.aba = b.dataset.aba; this.pintar(); };
    });
    $('btnSairRh').onclick = () => { this.cred = null; this.dados = null; this.aoSair(); };
    this.pintar();
  },

  pintar() {
    document.querySelectorAll('#rh nav button').forEach(b => b.classList.toggle('on', b.dataset.aba === this.aba));
    ['painel', 'pendencias', 'pessoas', 'equipes', 'registros'].forEach(a =>
      $('rh-' + a).classList.toggle('hide', a !== this.aba));
    if (this.aba === 'painel') this.pintarPainel();
    if (this.aba === 'pendencias') this.pintarPendencias();
    if (this.aba === 'pessoas') this.pintarPessoas();
    if (this.aba === 'equipes') this.pintarEquipes();
    if (this.aba === 'registros') this.pintarRegistros();
  },

  nomeDe(id) {
    const p = (this.dados.pessoas || []).find(x => x.pessoa_id === id);
    return p ? p.nome : id;
  },
  nomeEquipe(id) {
    const e = (this.dados.equipes || []).find(x => x.equipe_id === id);
    return e ? e.nome : '—';
  },

  /* --------------------------------------------------------- painel */

  pintarPainel() {
    const ind = indicadores(this.dados.marcacoes, this.dados.pessoas, this.dados.equipes);
    const alerta = ind.equipes.filter(e => e.taxa_manual >= 20 && e.marcacoes > 0);
    $('rh-painel').innerHTML =
      '<div class="grid">' +
        '<div class="stat"><div class="lab">Marcações</div><div class="val">' + ind.total + '</div></div>' +
        '<div class="stat"><div class="lab">Pendências</div><div class="val ' + (ind.pendentes ? 'warnfg' : '') + '">' + ind.pendentes + '</div></div>' +
        '<div class="stat"><div class="lab">Taxa manual</div><div class="val ' + (ind.taxaManual >= 20 ? 'badfg' : '') + '">' + ind.taxaManual + '%</div></div>' +
        '<div class="stat"><div class="lab">Sem biometria</div><div class="val ' + (ind.semBiometria ? 'warnfg' : '') + '">' + ind.semBiometria + '</div></div>' +
      '</div>' +
      (alerta.length
        ? '<div class="card" style="border-color:var(--bad)"><h2 class="badfg">Atenção</h2>' +
          alerta.map(e => '<div class="linha-item"><span class="ponto bad"></span><div><div class="nm">' +
            esc(e.nome) + '</div><div class="mt">' + e.taxa_manual + '% de registro manual</div></div></div>').join('') +
          '<p class="nota" style="margin-top:10px">Taxa alta de registro manual significa que a biometria parou de funcionar nessa equipe, ou que alguém está contornando ela.</p></div>'
        : '') +
      '<div class="card"><h2>Por equipe</h2>' +
        (ind.equipes.length ? ind.equipes.map(e =>
          '<div class="linha-item"><div style="flex:1">' +
            '<div class="nm">' + esc(e.nome) + '</div>' +
            '<div class="mt">' + e.pessoas + ' pessoas · ' + e.marcacoes + ' marcações · ' +
              e.manuais + ' manuais</div>' +
            '<div class="barra"><i style="width:' + Math.min(100, e.taxa_manual) + '%"></i></div>' +
          '</div><div class="dir">' + e.taxa_manual + '%</div></div>').join('')
          : '<p class="nota">Nenhuma equipe cadastrada.</p>') +
      '</div>';
  },

  /* ----------------------------------------------------- pendências */

  pintarPendencias() {
    const ms = (this.dados.marcacoes || []).filter(m => m.pendente)
      .sort((a, b) => String(b.marcado_em).localeCompare(String(a.marcado_em)));
    const rc = this.dados.recadastros || [];
    const el = $('rh-pendencias');
    if (!ms.length && !rc.length) {
      el.innerHTML = '<div class="card"><p class="nota">Nada esperando decisão. 🎉</p></div>';
      return;
    }
    el.innerHTML =
      rc.map(t => {
        const p = (this.dados.pessoas || []).find(x => x.pessoa_id === t.pessoa_id) || {};
        return '<div class="pend"><div class="top"><div style="flex:1">' +
          '<div class="nm"><b>Recadastro</b> · ' + esc(p.nome || t.pessoa_id) + '</div>' +
          '<div class="mt">versão ' + t.versao + ' · coerência ' + (t.coerencia == null ? '—' : Number(t.coerencia).toFixed(3)) + '</div>' +
          '</div></div>' +
          '<div class="fotos">' +
            (p.miniatura ? '<img src="' + p.miniatura + '">' : '<div class="vazio">atual</div>') +
            (t.miniatura ? '<img src="' + t.miniatura + '">' : '<div class="vazio">novo</div>') +
          '</div>' +
          '<div class="row2"><button class="act" data-tipo="template" data-id="' + t.template_id + '" data-acao="aprovar">Aprovar</button>' +
          '<button class="act danger" data-tipo="template" data-id="' + t.template_id + '" data-acao="rejeitar">Rejeitar</button></div></div>';
      }).join('') +
      ms.map(m => {
        const p = (this.dados.pessoas || []).find(x => x.pessoa_id === m.pessoa_id) || {};
        const motivos = [];
        if (m.origem === 'manual') motivos.push('registro manual');
        if (m.veredito === 'revisar') motivos.push('zona cinzenta');
        if (p.papel === 'gestor') motivos.push('ponto do próprio gestor');
        if (Math.abs(Number(m.deriva_relogio_ms) || 0) > 120000) motivos.push('relógio divergente');
        return '<div class="pend"><div class="top"><div style="flex:1">' +
          '<div class="nm"><b>' + esc(p.nome || m.pessoa_id) + '</b> · ' +
            (m.tipo === 'entrada' ? 'entrada' : 'saída') + ' ' + hora(m.marcado_em) + '</div>' +
          '<div class="mt">' + esc(this.nomeEquipe(m.equipe_id)) + ' · ' + motivos.join(' · ') +
            (m.motivo ? ' · "' + esc(m.motivo) + '"' : '') + '</div>' +
          '</div></div>' +
          '<div class="fotos">' +
            (p.miniatura ? '<img src="' + p.miniatura + '">' : '<div class="vazio">cadastro</div>') +
            (m.foto_auditoria ? '<img src="' + m.foto_auditoria + '">' : '<div class="vazio">sem foto</div>') +
          '</div>' +
          '<div class="row2"><button class="act" data-tipo="marcacao" data-id="' + m.id_cliente + '" data-acao="aprovar">Aprovar</button>' +
          '<button class="act danger" data-tipo="marcacao" data-id="' + m.id_cliente + '" data-acao="rejeitar">Rejeitar</button></div></div>';
      }).join('');

    el.querySelectorAll('button[data-acao]').forEach(b => {
      b.onclick = async () => {
        b.disabled = true;
        const r = await ApiRh.decidir(this.cred, {
          tipo: b.dataset.tipo, id: b.dataset.id, acao: b.dataset.acao, motivo: ''
        });
        if (!r.ok) { toast(r.erro || 'Falha', 'bad'); b.disabled = false; return; }
        toast('Decidido', 'ok');
        await this.recarregar();
      };
    });
  },

  /* ---------------------------------------------------- colaboradores */

  pintarPessoas() {
    const eqs = this.dados.equipes || [];
    const lista = (this.dados.pessoas || []).slice().sort((a, b) => a.nome.localeCompare(b.nome));
    $('rh-pessoas').innerHTML =
      '<div class="card"><h2>Novo colaborador</h2>' +
        '<label class="lb">Nome</label><input type="text" id="pNome">' +
        '<label class="lb">Matrícula</label><input type="text" id="pMat">' +
        '<label class="lb">Equipe</label><select id="pEquipe">' +
          eqs.map(e => '<option value="' + e.equipe_id + '">' + esc(e.nome) + '</option>').join('') + '</select>' +
        '<label class="lb">Papel</label><select id="pPapel">' +
          '<option value="colaborador">Colaborador</option><option value="gestor">Gestor</option></select>' +
        '<button class="act" id="btnNovaPessoa">Salvar</button></div>' +
      '<div class="card"><h2>Cadastrados <span class="nota">— ' + lista.length + '</span></h2>' +
        lista.map(p =>
          '<div class="linha-item">' +
          (p.miniatura ? '<img src="' + p.miniatura + '">' : '<span class="ponto ' + (p.ativo ? 'muted' : 'bad') + '"></span>') +
          '<div style="flex:1"><div class="nm">' + esc(p.nome) +
            (p.papel === 'gestor' ? ' <span class="tag">gestor</span>' : '') +
            (p.ativo ? '' : ' <span class="tag">inativo</span>') + '</div>' +
          '<div class="mt">' + esc(p.matricula) + ' · ' + esc(this.nomeEquipe(p.equipe_id)) +
            (p.tem_biometria ? '' : ' · <span class="warnfg">sem biometria</span>') + '</div></div>' +
          '<button class="act ghost" style="width:auto;margin:0;padding:9px 12px;font-size:12px" data-bio="' + p.pessoa_id + '">' +
            (p.tem_biometria ? 'Refazer' : 'Biometria') + '</button>' +
          '</div>').join('') +
      '</div>' +
      '<div id="areaBio"></div>';

    $('btnNovaPessoa').onclick = async () => {
      const r = await ApiRh.colaborador(this.cred, {
        nome: $('pNome').value.trim(), matricula: $('pMat').value.trim(),
        equipe_id: $('pEquipe').value, papel: $('pPapel').value
      });
      if (!r.ok) { toast(r.erro || 'Falha', 'bad'); return; }
      toast('Colaborador salvo', 'ok');
      await this.recarregar();
    };
    $('rh-pessoas').querySelectorAll('button[data-bio]').forEach(b => {
      b.onclick = () => this.abrirBiometria(b.dataset.bio);
    });
  },

  async abrirBiometria(pessoaId) {
    const p = (this.dados.pessoas || []).find(x => x.pessoa_id === pessoaId);
    if (!p) return;
    this.alvoCadastro = p;
    this.capturas = [];
    $('areaBio').innerHTML =
      '<div class="card"><h2>Biometria de ' + esc(p.nome) + '</h2>' +
        '<div class="camwrap" style="aspect-ratio:1/1">' +
          '<video id="videoCad" playsinline muted autoplay></video>' +
          '<div class="camoff" id="camOffCad">A câmera liga na primeira captura</div>' +
        '</div>' +
        '<div class="shots" id="cadShots"></div>' +
        '<button class="act ghost" id="btnCapCad">Capturar 1/3</button>' +
        '<button class="act" id="btnSalvarBio" disabled>Salvar biometria</button>' +
        '<button class="act ghost" id="btnFecharBio">Fechar</button>' +
        '<p class="nota" style="margin-top:10px">Sem boné, óculos escuros ou máscara. Mova um pouco a cabeça entre as capturas.</p>' +
      '</div>';
    this.pintarShots();
    $('btnCapCad').onclick = () => this.capturarCadastro();
    $('btnSalvarBio').onclick = () => this.salvarBiometria();
    $('btnFecharBio').onclick = () => { this.pararCamCad(); $('areaBio').innerHTML = ''; };
    $('areaBio').scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  pintarShots() {
    $('cadShots').innerHTML = [0, 1, 2].map(i =>
      this.capturas[i] ? '<div><img src="' + this.capturas[i].thumb + '"></div>' : '<div>' + (i + 1) + '</div>').join('');
    $('btnSalvarBio').disabled = this.capturas.length < 3;
    $('btnCapCad').textContent = this.capturas.length < 3 ? 'Capturar ' + (this.capturas.length + 1) + '/3' : 'Completo';
  },

  async ligarCamCad() {
    if (this._camCad) return true;
    try {
      this._camCad = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      $('videoCad').srcObject = this._camCad;
      await $('videoCad').play();
      $('camOffCad').classList.add('hide');
      return true;
    } catch (e) { toast('Sem acesso à câmera', 'bad'); return false; }
  },

  pararCamCad() {
    if (this._camCad) { this._camCad.getTracks().forEach(t => t.stop()); this._camCad = null; }
  },

  async capturarCadastro() {
    if (!(await this.ligarCamCad())) return;
    $('btnCapCad').disabled = true;
    try {
      const r = await Face.capturar($('videoCad'));
      if (!r) { toast('Nenhum rosto — tire óculos escuros ou máscara', 'warn'); return; }
      if (r.reprovado) { toast('Qualidade insuficiente: ' + r.qualidade.msg, 'warn'); return; }
      this.capturas.push(r);
      this.pintarShots();
    } finally { $('btnCapCad').disabled = false; }
  },

  async salvarBiometria() {
    const c = this.capturas;
    const coer = Math.max(
      euclidiana(c[0].descritor, c[1].descritor),
      euclidiana(c[0].descritor, c[2].descritor),
      euclidiana(c[1].descritor, c[2].descritor));
    if (coer > 0.55 && !confirm('As 3 capturas estão pouco parecidas entre si (' + coer.toFixed(3) +
      ').\n\nIsso costuma virar falso negativo depois. Salvar assim mesmo?')) return;
    $('btnSalvarBio').disabled = true;
    const p = this.alvoCadastro;
    const r = await ApiRh.colaborador(this.cred, {
      pessoa_id: p.pessoa_id, nome: p.nome, matricula: p.matricula,
      equipe_id: p.equipe_id, papel: p.papel
    });
    if (!r.ok) { toast(r.erro || 'Falha', 'bad'); $('btnSalvarBio').disabled = false; return; }
    const bio = await fetch(window.EFRAT_CFG.apiBase + '/efrat/cadastro', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: this._tokenAparelho, origem: 'rh', pessoa_id: p.pessoa_id,
        nome: p.nome, matricula: p.matricula, equipe_id: p.equipe_id,
        vetores: c.map(x => x.descritor), miniatura: c[0].thumb, coerencia: Number(coer.toFixed(4))
      })
    }).then(x => x.json()).catch(() => null);
    $('btnSalvarBio').disabled = false;
    if (!bio || !bio.ok) { toast((bio && bio.erro) || 'Falha ao gravar biometria', 'bad'); return; }
    toast('Biometria salva (coerência ' + coer.toFixed(3) + ')', 'ok');
    this.pararCamCad();
    $('areaBio').innerHTML = '';
    await this.recarregar();
  },

  /* --------------------------------------------------------- equipes */

  pintarEquipes() {
    const eqs = (this.dados.equipes || []).slice().sort((a, b) => a.nome.localeCompare(b.nome));
    const cont = {};
    for (const p of (this.dados.pessoas || [])) if (p.ativo) cont[p.equipe_id] = (cont[p.equipe_id] || 0) + 1;
    $('rh-equipes').innerHTML =
      '<div class="card"><h2>Nova equipe</h2>' +
        '<label class="lb">Nome</label><input type="text" id="eNome">' +
        '<label class="lb">Unidade</label><input type="text" id="eUnidade" value="Unidade Piloto">' +
        '<button class="act" id="btnNovaEquipe">Criar equipe</button>' +
        '<p class="nota" style="margin-top:8px">Equipes da mesma unidade compartilham a carga — é isso que permite marcar um colaborador remanejado sem cair em registro manual.</p></div>' +
      '<div class="card"><h2>Equipes</h2>' +
        (eqs.length ? eqs.map(e =>
          '<div class="linha-item"><span class="ponto ' + (e.ativo ? 'ok' : 'bad') + '"></span>' +
          '<div style="flex:1"><div class="nm">' + esc(e.nome) + '</div>' +
          '<div class="mt">' + esc(e.unidade) + ' · ' + (cont[e.equipe_id] || 0) + ' pessoas</div></div></div>').join('')
          : '<p class="nota">Nenhuma equipe.</p>') +
      '</div>';
    $('btnNovaEquipe').onclick = async () => {
      const r = await ApiRh.equipe(this.cred, {
        nome: $('eNome').value.trim(), unidade: $('eUnidade').value.trim()
      });
      if (!r.ok) { toast(r.erro || 'Falha', 'bad'); return; }
      toast('Equipe criada', 'ok');
      await this.recarregar();
    };
  },

  /* ------------------------------------------------------- registros */

  pintarRegistros() {
    const pessoas = (this.dados.pessoas || []).slice().sort((a, b) => a.nome.localeCompare(b.nome));
    $('rh-registros').innerHTML =
      '<div class="card"><h2>Espelho de ponto</h2>' +
        '<label class="lb">Colaborador</label><select id="regPessoa">' +
          pessoas.map(p => '<option value="' + p.pessoa_id + '">' + esc(p.nome) + '</option>').join('') +
        '</select><div id="regSaida"></div></div>';
    const desenhar = () => {
      const id = $('regPessoa').value;
      const linhas = espelho(this.dados.marcacoes, id);
      $('regSaida').innerHTML = linhas.length
        ? linhas.map(l => '<div class="esp"><span class="d">' + data(l.dia) + '</span><span>' +
            l.marcacoes.map(m => (m.tipo === 'entrada' ? 'E ' : 'S ') + hora(m.marcado_em) +
              (m.origem === 'manual' ? ' <span class="tag">manual</span>' : '') +
              (m.pendente ? ' <span class="tag">pendente</span>' : '')).join(' · ') +
            '</span></div>').join('')
        : '<p class="nota" style="margin-top:10px">Sem marcações no período.</p>';
    };
    $('regPessoa').onchange = desenhar;
    if (pessoas.length) desenhar();
  }
};
