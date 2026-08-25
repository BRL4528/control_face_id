// Fumaca manual das 8 rotas do primeiro turno de teste em producao
// (registrar, estado, rh/sal, rh/aparelhos, rh/aparelho/aprovar,
// rh/face/cadastrar, carga, marcacoes) -- direto por HTTP contra o servidor
// falso, sem playwright, sem navegador, nao disputa a pista.
//
// O QUE ISTO PROVA: as 8 rotas existem, respondem no formato do contrato, e
// o caminho feliz encadeado funciona (aparelho registra -> RH aprova -> app
// baixa carga -> RH cadastra rosto -> aparelho bate ponto -> dedup segura
// reenvio). Roda contra nucleo/memoria.js.
//
// O QUE ISTO NAO PROVA: nada sobre concorrencia/atomicidade. Contra um
// adaptador em memoria (thread unica do Node, sem await entre checar e
// escrever dentro de um metodo sincrono) um teste de corrida NAO CONSEGUE
// reprovar -- daria verde ate com a pior implementacao possivel
// (if-existe/senao-grava). Medicao que nao pode falhar nao carrega
// informacao. Isso so tem resposta real contra o adaptador Postgres de
// API-3 (achado do QA, Revisor QA/Security cfb62f5154, 2026-08-25).
//
// Uso: node tests/fumaca-primeiro-turno.mjs
import crypto from 'node:crypto';
import { criarServidor, vetorDe } from './e2e/servidor-falso.js';

const { servidor } = criarServidor({});
await new Promise(r => servidor.listen(0, r));
const porta = servidor.address().port;
const base = `http://127.0.0.1:${porta}/webhook`;

// credencial_hash guardado na linha e comparado contra sha256(bearer) -- o
// cliente manda a CHAVE PUBLICA (o hash) no registro e o SEGREDO no Bearer
// depois, igual ao app real faz.
const SEGREDO_APARELHO = 'segredo-smoke-1';
const CHAVE_PUBLICA = crypto.createHash('sha256').update(SEGREDO_APARELHO).digest('base64url');

let falhas = 0;
async function chamar(metodo, caminho, corpo, extras) {
  const r = await fetch(base + caminho, {
    method: metodo, headers: Object.assign({ 'Content-Type': 'application/json' }, extras || {}),
    body: corpo ? JSON.stringify(corpo) : undefined
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, json };
}
function conferir(nome, condicao, detalhe) {
  if (condicao) { console.log('OK  ', nome); }
  else { console.log('FAIL', nome, JSON.stringify(detalhe)); falhas++; }
}

// 1. registrar
const reg = await chamar('POST', '/efrat/dispositivo/registrar', {
  dispositivo_id: 'disp-smoke-1', credencial_publica: CHAVE_PUBLICA, apelido: 'Smoke', ua: 'smoke-agent'
});
conferir('registrar -> 202 pendente', reg.status === 202 && reg.json.estado === 'pendente' && reg.json.codigo_curto, reg);
const codigo = reg.json && reg.json.codigo_curto;

// 2. estado (pendente)
const est1 = await chamar('POST', '/efrat/dispositivo/estado', { dispositivo_id: 'disp-smoke-1' },
  { Authorization: 'Bearer ' + SEGREDO_APARELHO });
conferir('estado pendente -> mesmo codigo', est1.status === 200 && est1.json.estado === 'pendente' && est1.json.codigo_curto === codigo, est1);

// 3. rh/sal
const sal = await chamar('POST', '/efrat/rh/sal', { usuario: 'rh' });
conferir('rh/sal -> 200', sal.status === 200 && sal.json.sal, sal);

// 4. rh/aparelhos (ve o pendente)
const lista1 = await chamar('POST', '/efrat/rh/aparelhos', { usuario: 'rh', chave: 'CHAVE-DE-TESTE' });
conferir('rh/aparelhos ve pendente', lista1.status === 200 && lista1.json.pendentes.some(p => p.pendente_id), lista1);

// 5. rh/aparelho/aprovar
const aprovar = await chamar('POST', '/efrat/rh/aparelho/aprovar', {
  usuario: 'rh', chave: 'CHAVE-DE-TESTE', codigo, equipes_ids: ['eq-1'], idempotency_key: 'idem-aprovar-1'
});
conferir('aprovar -> 200 ativo', aprovar.status === 200 && aprovar.json.ok === true, aprovar);

// idempotencia do aprovar: mesma chave, mesmo corpo, deve repetir 200 sem erro
const aprovarDeNovo = await chamar('POST', '/efrat/rh/aparelho/aprovar', {
  usuario: 'rh', chave: 'CHAVE-DE-TESTE', codigo, equipes_ids: ['eq-1'], idempotency_key: 'idem-aprovar-1'
});
conferir('aprovar idempotente repete 200', aprovarDeNovo.status === 200 && aprovarDeNovo.json.dispositivo_id === aprovar.json.dispositivo_id, aprovarDeNovo);

// 6. estado (agora ativo)
const est2 = await chamar('POST', '/efrat/dispositivo/estado', { dispositivo_id: 'disp-smoke-1' },
  { Authorization: 'Bearer ' + SEGREDO_APARELHO });
conferir('estado ativo', est2.status === 200 && est2.json.estado === 'ativo' && Array.isArray(est2.json.dispositivo.equipes_ids), est2);

// 7. carga
const carga = await chamar('POST', '/efrat/carga', { dispositivo_id: 'disp-smoke-1', modelo_id: 'modelo-smoke' },
  { Authorization: 'Bearer ' + SEGREDO_APARELHO });
conferir('carga -> 200 com pessoas da eq-1', carga.status === 200 && Array.isArray(carga.json.pessoas) && carga.json.pessoas.length > 0, carga);

// 8. rh/face/cadastrar (camera do PC, grava direto). Tres capturas distintas
// mas coerentes (jitter pequeno) -- identicas cai em FOTOS_IGUAIS de proposito.
const base128 = vetorDe('p-ana');
const jitter = (v, delta) => v.map((x, i) => x + (i % 2 === 0 ? delta : -delta));
const vetores3 = [base128, jitter(base128, 0.01), jitter(base128, 0.015)];
const cadastro = await chamar('POST', '/efrat/rh/face/cadastrar', {
  usuario: 'rh', chave: 'CHAVE-DE-TESTE', pessoa_id: 'p-ana', modelo_id: 'modelo-smoke',
  vetores: vetores3, miniatura: '', origem: 'rh_camera', idempotency_key: 'idem-cadastro-1'
});
conferir('face/cadastrar -> 200 ativo', cadastro.status === 200 && cadastro.json.estado === 'ativo', cadastro);

// 9. marcacoes (o teste-fim: bater ponto pra quem acabou de ser cadastrado)
const marc = await chamar('POST', '/efrat/marcacoes', {
  dispositivo_id: 'disp-smoke-1',
  marcacoes: [{ id_cliente: 'cli-smoke-1', pessoa_id: 'p-ana', marcado_em: new Date().toISOString(), tipo: 'entrada', veredito: 'aceito' }]
}, { Authorization: 'Bearer ' + SEGREDO_APARELHO });
conferir('marcacoes -> aceita', marc.status === 200 && marc.json.resumo.aceitas === 1, marc);

// dedup: reenviar o mesmo id_cliente tem que voltar duplicado, nao aceitar de novo
const marc2 = await chamar('POST', '/efrat/marcacoes', {
  dispositivo_id: 'disp-smoke-1',
  marcacoes: [{ id_cliente: 'cli-smoke-1', pessoa_id: 'p-ana', marcado_em: new Date().toISOString(), tipo: 'entrada', veredito: 'aceito' }]
}, { Authorization: 'Bearer ' + SEGREDO_APARELHO });
conferir('marcacoes dedup -> duplicado', marc2.status === 200 && marc2.json.resumo.duplicadas === 1, marc2);

servidor.close();
console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
