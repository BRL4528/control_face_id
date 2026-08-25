// PORTÃO DE PRONTIDÃO — "existe rosto no banco para alguém ser reconhecido?"
//
// Achado do Designer (1e5e2eb3ea), virado em portão automático a pedido dele.
// É uma classe de falha diferente de todas as outras deste diretório: aqui o
// sistema faz TUDO CERTO e mesmo assim não há o que testar. Reconhecimento lê
// `carga.pessoas[].template.vetores`; se ninguém tem vetor, o RH libera o
// aparelho, o colaborador chega na frente da câmera e não é reconhecido por
// ninguém. As 8 rotas verdes, o teste morto no passo 3.
//
// POR QUE NENHUM TESTE PEGAVA ISSO: a semente padrão do servidor de teste dá
// rosto a TODO MUNDO (`vetores: [vetorDe(p.pessoa_id)]`, servidor-falso.js:214).
// Toda suíte nasce num mundo onde todos já são reconhecíveis — que é o único
// mundo que a produção nunca é no primeiro dia. O achado só apareceu quando
// alguém escreveu o passo a passo de verdade.
//
// O PORTÃO NÃO É "TODO MUNDO TEM VETOR", e essa distinção é a decisão do
// Orquestrador: a semente de amanhã NÃO leva rosto — a pessoa nasce sem
// biometria e o rosto entra AO VIVO pelo RH durante o teste (semear vetor de
// fixture seria pior: nenhum ser humano real casa com fixture, então daria
// verde e a pessoa de verdade não seria reconhecida).
//
// Então o que este portão mede é a TRANSIÇÃO, que é o que precisa funcionar:
//   pessoa sem rosto na carga  ->  RH cadastra pela câmera  ->  pessoa COM rosto
//
// Não usa banco, não usa Playwright, não usa navegador: a pergunta é de
// formato e caminho, não de concorrência, e para ela o adaptador em memória é
// oráculo legítimo (ver memoria-nao-mede.test.js para quando ele NÃO é).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { criarServidor, vetorDe } from '../e2e/servidor-falso.js';

const SEGREDO = 'segredo-prontidao';
const CHAVE_PUBLICA = crypto.createHash('sha256').update(SEGREDO).digest('base64url');
const SEM_ROSTO = 'p-sem-rosto';

let servidor, base;
const medido = {};

const chamar = (caminho, corpo, extras) =>
  fetch(base + caminho, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, extras || {}),
    body: JSON.stringify(corpo)
  }).then(async r => ({ status: r.status, json: await r.json().catch(() => null) }));

/** Vetores de uma pessoa na carga; [] quando ela não é reconhecível. */
const vetoresNaCarga = (carga, pessoaId) => {
  const p = (carga.json.pessoas || []).find(x => x.pessoa_id === pessoaId);
  return (p && p.template && p.template.vetores) || [];
};

/** Três capturas distintas mas coerentes — idênticas cairiam em FOTOS_IGUAIS. */
function capturas(semente) {
  const v = vetorDe(semente);
  const jitter = d => v.map((x, i) => x + (i % 2 === 0 ? d : -d));
  return [v, jitter(0.01), jitter(0.015)];
}

before(async () => {
  // Uma pessoa SEM rosto, que é o estado real de uma implantação nova e o que
  // o DevOps vai semear amanhã. `vetores: []` sobrescreve o padrão da semente.
  const pessoas = [
    { pessoa_id: SEM_ROSTO, nome: 'Pessoa Nova', matricula: '900', equipe_id: 'eq-1', papel: 'colaborador', vetores: [] }
  ];
  const criado = criarServidor({ pessoas });
  servidor = criado.servidor;
  await new Promise(r => servidor.listen(0, r));
  base = `http://127.0.0.1:${servidor.address().port}/webhook`;

  const reg = await chamar('/efrat/dispositivo/registrar', {
    dispositivo_id: 'disp-prontidao', credencial_publica: CHAVE_PUBLICA, apelido: 'Prontidao', ua: 'arnes'
  });
  await chamar('/efrat/rh/aparelho/aprovar', {
    usuario: 'rh', chave: 'CHAVE-DE-TESTE', codigo: reg.json.codigo_curto,
    equipes_ids: ['eq-1'], idempotency_key: 'idem-prontidao'
  });

  const comBearer = { Authorization: 'Bearer ' + SEGREDO };
  const carga = () => chamar('/efrat/carga', { dispositivo_id: 'disp-prontidao', modelo_id: 'modelo-arnes' }, comBearer);

  medido.antes = vetoresNaCarga(await carga(), SEM_ROSTO);

  // Câmera do PC: o RH está vendo a pessoa ali (§4.3, captura supervisionada).
  medido.cadastroCamera = await chamar('/efrat/rh/face/cadastrar', {
    usuario: 'rh', chave: 'CHAVE-DE-TESTE', pessoa_id: SEM_ROSTO, modelo_id: 'modelo-arnes',
    vetores: capturas(SEM_ROSTO), miniatura: '', origem: 'rh_camera', idempotency_key: 'idem-cam'
  });
  medido.depois = vetoresNaCarga(await carga(), SEM_ROSTO);

  // CALIBRAÇÃO pelo outro lado: upload NÃO torna ninguém reconhecível — vai
  // para a fila humana (§4.3, ninguém viu a captura). Sem esta metade, o
  // portão poderia estar apenas dizendo "qualquer cadastro serve".
  const outro = criarServidor({
    pessoas: [{ pessoa_id: SEM_ROSTO, nome: 'Pessoa Nova', matricula: '900', equipe_id: 'eq-1', papel: 'colaborador', vetores: [] }]
  });
  await new Promise(r => outro.servidor.listen(0, r));
  const base2 = `http://127.0.0.1:${outro.servidor.address().port}/webhook`;
  const baseOriginal = base;
  base = base2;
  const reg2 = await chamar('/efrat/dispositivo/registrar', {
    dispositivo_id: 'disp-prontidao', credencial_publica: CHAVE_PUBLICA, apelido: 'Prontidao', ua: 'arnes'
  });
  await chamar('/efrat/rh/aparelho/aprovar', {
    usuario: 'rh', chave: 'CHAVE-DE-TESTE', codigo: reg2.json.codigo_curto,
    equipes_ids: ['eq-1'], idempotency_key: 'idem-prontidao-2'
  });
  await chamar('/efrat/rh/face/cadastrar', {
    usuario: 'rh', chave: 'CHAVE-DE-TESTE', pessoa_id: SEM_ROSTO, modelo_id: 'modelo-arnes',
    vetores: capturas(SEM_ROSTO), miniatura: '', origem: 'rh_upload', idempotency_key: 'idem-upl'
  });
  medido.depoisUpload = vetoresNaCarga(
    await chamar('/efrat/carga', { dispositivo_id: 'disp-prontidao', modelo_id: 'modelo-arnes' }, comBearer), SEM_ROSTO);
  outro.servidor.close();
  base = baseOriginal;

  console.log(`\n[prontidao] vetores na carga para ${SEM_ROSTO}:`);
  console.log(`  antes do cadastro ............ ${medido.antes.length}`);
  console.log(`  depois de rh_camera .......... ${medido.depois.length}`);
  console.log(`  depois de rh_upload .......... ${medido.depoisUpload.length} (esperado 0: vai para a fila humana)`);
}, { timeout: 120000 });

after(async () => { if (servidor) servidor.close(); });

test('uma implantacao nova comeca SEM ninguem reconhecivel', () => {
  assert.equal(
    medido.antes.length, 0,
    'A pessoa ja tinha rosto antes de o RH cadastrar. Se isto falhar num teste, a ' +
    'semente esta dando rosto de graca — que e exatamente o que escondeu este furo ' +
    'ate alguem escrever o roteiro (servidor-falso.js:214 faz isso por padrao).'
  );
});

test('cadastro pela camera do RH torna a pessoa reconhecivel na carga', () => {
  assert.equal(medido.cadastroCamera.status, 200, JSON.stringify(medido.cadastroCamera.json));
  assert.equal(medido.cadastroCamera.json.estado, 'ativo', 'camera do PC grava direto, nao vai para fila');
  assert.ok(
    medido.depois.length > 0,
    'O RH cadastrou o rosto pela camera e a pessoa CONTINUA sem vetor na carga. ' +
    'E a falha que mata o teste no passo 3: aparelho liberado, colaborador na frente ' +
    'da camera, nao reconhecido por ninguem — com as 8 rotas respondendo 200.'
  );
});

test('upload NAO torna ninguem reconhecivel — a assimetria e intencional', () => {
  assert.equal(
    medido.depoisUpload.length, 0,
    'Upload passou a dar rosto direto. §4.3: ninguem do RH viu a captura acontecer, ' +
    'entao o template vai para a fila humana e NUNCA sobrescreve o vigente sozinho. ' +
    'Se isto ficar verde por acidente, o portao acima so estaria dizendo "qualquer ' +
    'cadastro serve" — e deixaria passar cadastro sem supervisao.'
  );
});
