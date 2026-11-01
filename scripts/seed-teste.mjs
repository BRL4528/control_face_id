// Empresa de TESTE completa num banco LOCAL (nunca em produção): usuários do RH por
// perfil, jornadas por dia da semana, obras com cerca, colaboradores com aparelho
// e cadastro facial compatíveis com o rosto simulado dos testes
// (window.__EFRAT_FAKE_FACE = { pessoa: '<matrícula>' }) e um mês de batidas.
//
//   DATABASE_URL=postgres://postgres:teste@localhost:5433/ponto node scripts/seed-teste.mjs
//
// Imprime um JSON com ids, logins e credenciais dos aparelhos para os testes.
import bcrypt from 'bcryptjs';
import { pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { db, ehLocal } from '../api/_lib/db.js';
import { hashCredencial } from '../api/_lib/auth.js';

if (!ehLocal(process.env.DATABASE_URL || '')) { console.error('seed-teste só roda em banco local'); process.exit(1); }
const sql = db();
const ITER = 150000;
const id = () => randomUUID();
const chave = (senha, sal) => pbkdf2Sync(senha, Buffer.from(sal, 'hex'), ITER, 32, 'sha256').toString('hex');

// Mesmo descritor que js/face.js::_capturaFingida gera para a "pessoa" simulada.
function descritor(pessoa) {
  const s = String(pessoa), v = new Array(128);
  for (let i = 0; i < 128; i++) v[i] = ((s.charCodeAt(i % s.length) * (i + 7)) % 100) / 100;
  return v;
}

const nomeEmp = process.argv[2] || 'RT Teste ' + new Date().toISOString().slice(0, 16);
const empresa = id();
const linkToken = randomBytes(6).toString('base64url');
await sql`INSERT INTO empresa (id, nome, link_token) VALUES (${empresa}, ${nomeEmp}, ${linkToken})`;

// Usuários do painel (senha = login + '-teste-123').
const usuarios = {};
for (const [login, nome, perfil] of [['rh', 'RH Teste', null], ['gestor', 'Gestor Obra 574', 'gestor_obra'], ['almox', 'Almoxarife', 'almox'], ['sst', 'Técnico SST', 'sst'], ['leitura', 'Diretoria', 'leitura']]) {
  const sal = randomBytes(16).toString('hex'), uid = id();
  await sql`INSERT INTO usuario_rh (id, empresa_id, usuario, nome, sal, iteracoes, chave_hash)
            VALUES (${uid}, ${empresa}, ${login + '-' + empresa.slice(0, 6)}, ${nome}, ${sal}, ${ITER}, ${await bcrypt.hash(chave(login + '-teste-123', sal), 10)})`;
  usuarios[login] = { id: uid, usuario: login + '-' + empresa.slice(0, 6), senha: login + '-teste-123', perfil };
}

// Jornadas: OBRAS com segunda até 16:00; ESCRITORIO legado (seg a sex, 72 min).
const jObras = id(), jEsc = id();
await sql`INSERT INTO jornada (id, empresa_id, nome, entrada, saida, tolerancia_min, intervalo_min, dias) VALUES
  (${jObras}, ${empresa}, 'OBRAS', '07:00', '17:00', 10, 60,
   ${JSON.stringify({ 1: { entrada: '07:00', saida: '16:00' }, 2: { entrada: '07:00', saida: '17:00' }, 3: { entrada: '07:00', saida: '17:00' }, 4: { entrada: '07:00', saida: '17:00' }, 5: { entrada: '07:00', saida: '17:00' } })}::jsonb)`;
await sql`INSERT INTO jornada (id, empresa_id, nome, entrada, saida, tolerancia_min, intervalo_min) VALUES (${jEsc}, ${empresa}, 'ESCRITORIO', '07:00', '17:00', 10, 72)`;

// Locais e equipes (Campo Grande).
const lObra = id(), lEsc = id();
await sql`INSERT INTO local (id, empresa_id, nome, lat, lng, raio_m) VALUES (${lObra}, ${empresa}, 'Canteiro 574', -20.4697, -54.6201, 200), (${lEsc}, ${empresa}, 'Escritório', -20.4800, -54.6100, 100)`;
const eObra = id(), eEsc = id(), eInss = id(), eObra2 = id();
await sql`INSERT INTO equipe (id, empresa_id, nome, jornada_id, local_id) VALUES
  (${eObra}, ${empresa}, 'Obra 574 - Rio Verde (Elevatórias)', ${jObras}, ${lObra}),
  (${eObra2}, ${empresa}, 'Obra 562 - Três Lagoas (Reforma)', NULL, NULL),
  (${eEsc}, ${empresa}, 'Escritório Efrat', ${jEsc}, ${lEsc}),
  (${eInss}, ${empresa}, 'Afastado INSS', NULL, NULL)`;
await sql`UPDATE usuario_rh SET perfil='gestor_obra', obras=${JSON.stringify([eObra])}::jsonb WHERE id=${usuarios.gestor.id}`;
for (const k of ['almox', 'sst', 'leitura']) await sql`UPDATE usuario_rh SET perfil=${k} WHERE id=${usuarios[k].id}`;

// Papel personalizado (aparece na folha como função).
const pAjud = id();
await sql`INSERT INTO papel (id, empresa_id, nome) VALUES (${pAjud}, ${empresa}, 'Ajudante')`;

// Config: feriados de Campo Grande/MS, jornada padrão = OBRAS, razão social/CNPJ.
await sql`INSERT INTO config_empresa (empresa_id, dados) VALUES (${empresa}, ${JSON.stringify({
  jornadaPadraoId: jObras, razaoSocial: 'RT ENGENHARIA E CONSTRUÇÃO LTDA (TESTE)', cnpj: '50.808.134/0001-01',
  feriados: [{ dia: '2026-08-26', nome: 'Aniversário de Campo Grande' }, { dia: '2026-10-11', nome: 'Criação do Estado de MS' }]
})}::jsonb)`;

// Colaboradores, cada um com aparelho ativo e cadastro facial do rosto simulado.
const pessoas = {};
const desde = '2026-09-01';
for (const [mat, nome, equipe, papel] of [
  ['1001', 'JOÃO ARRUDA', eObra, pAjud], ['1002', 'MARIA ESCRITÓRIO', eEsc, 'colaborador'],
  ['1003', 'DIEGO LÍDER', eObra, 'lider'], ['1004', 'PEDRO AFASTADO', eInss, 'colaborador'],
  ['1005', 'ANA OBRA 562', eObra2, 'colaborador']
]) {
  const cid = id(), did = id(), cred = randomBytes(24).toString('base64url');
  await sql`INSERT INTO colaborador (id, empresa_id, nome, matricula, papel, equipe_padrao, criado_em) VALUES (${cid}, ${empresa}, ${nome}, ${mat}, ${papel}, ${equipe}, ${desde})`;
  await sql`INSERT INTO dispositivo (id, empresa_id, colaborador_id, credencial_hash, estado) VALUES (${did}, ${empresa}, ${cid}, ${hashCredencial(cred)}, 'ativo')`;
  await sql`INSERT INTO template_facial (id, colaborador_id, versao, vetores, estado) VALUES (${id()}, ${cid}, 1, ${JSON.stringify([descritor(mat)])}::jsonb, 'ativo')`;
  pessoas[mat] = { id: cid, nome, matricula: mat, equipe_id: equipe, dispositivo_id: did, credencial: cred };
}

// Outubro de batidas (aceitas) para João (obra) e Maria (escritório), com
// segunda até 16:00, uma falta (15/10), uma hora extra (22/10 até 18:30), um dia
// em que o celular gravou o tipo trocado (07/10) e nada no feriado 12/10.
const em = (dia, hhmm) => { const [h, m] = hhmm.split(':').map(Number); return `${dia}T${String(h + 4).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`; };
let n = 0;
for (let d = 1; d <= 30; d++) {
  const dia = '2026-10-' + String(d).padStart(2, '0'), w = new Date(dia + 'T12:00:00Z').getUTCDay();
  if (w === 0 || w === 6 || d === 12) continue;
  for (const [mat, eq] of [['1001', eObra], ['1002', eEsc]]) {
    if (mat === '1001' && d === 15) continue;
    const saida = mat === '1001' && w === 1 ? '16:00' : mat === '1001' && d === 22 ? '18:30' : '17:00';
    const tipos = d === 7 && mat === '1001' ? ['entrada', 'entrada', 'saida', 'entrada'] : ['entrada', 'saida', 'entrada', 'saida'];
    const horas = ['07:00', '11:00', '12:00', saida];
    for (let i = 0; i < 4; i++) {
      await sql`INSERT INTO marcacao (id_cliente, empresa_id, colaborador_id, dispositivo_id, equipe_id, tipo, origem, veredito, score, liveness_ok,
                  marcado_em, marcado_dia, dentro_cerca, requer_revisao)
                VALUES (${id()}, ${empresa}, ${pessoas[mat].id}, ${pessoas[mat].dispositivo_id}, ${eq}, ${tipos[i]}, 'biometria', 'aceito', 0.2, true,
                  ${em(dia, horas[i])}, ${dia}, true, false)`;
      n++;
    }
  }
}

console.log(JSON.stringify({ empresa, nome: nomeEmp, link_token: linkToken, usuarios, pessoas,
  equipes: { obra574: eObra, obra562: eObra2, escritorio: eEsc, inss: eInss }, jornadas: { obras: jObras, escritorio: jEsc }, batidas: n }, null, 1));
process.exit(0);
