// Popula uma empresa com dados de DEMONSTRAÇÃO realistas para analisar as regras
// do painel: equipes, locais, jornadas, escalas, colaboradores (com/sem biometria,
// sem equipe, desligado), 10 dias úteis de batidas com os casos que o sistema
// trata (normal, fora da cerca, zona cinzenta, registro manual, sem prova de
// vida, relógio fora, sem entrada, saída esquecida), decisões do RH já tomadas
// e um aparelho pendente do link da empresa.
//
//   DATABASE_URL=... node scripts/popular-demo.js [link_token|empresa_id] [AVATARES_JSON=caminho]
//
// Idempotente por matrícula (D001…): rodar de novo não duplica pessoas nem
// escalas; marcações são imutáveis e só são inseridas se ainda não houver
// nenhuma da pessoa naquele dia. Biometria é FAKE (vetores aleatórios): serve
// para as telas, não para reconhecer rosto de verdade.
import { neon } from '@neondatabase/serverless';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';

const url = process.env.DATABASE_URL;
if (!url) { console.error('Defina DATABASE_URL'); process.exit(1); }
const sql = neon(url);
const q = async (s, p) => { const r = await sql.query(s, p); return r.rows ?? r; };
const alvo = process.argv[2] || null;
const avatares = process.env.AVATARES_JSON && existsSync(process.env.AVATARES_JSON) ? JSON.parse(readFileSync(process.env.AVATARES_JSON, 'utf8')) : {};

const FUSO_OFFSET_H = 4;   // America/Campo_Grande = UTC-4 (sem horário de verão)
const hojeLocal = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Campo_Grande', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
function isoDia(ms) { return new Date(ms).toISOString().slice(0, 10); }
function diaMais(dia, n) { return isoDia(Date.parse(dia + 'T00:00:00Z') + n * 86400000); }
function dow(dia) { const d = new Date(dia + 'T12:00:00Z').getUTCDay(); return d === 0 ? 7 : d; }   // ISO 1..7
function emLocal(dia, hh, mm) { const [y, m, d] = dia.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, hh + FUSO_OFFSET_H, mm)); }
let seed = 42; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const entre = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const vetor = () => { const v = Array.from({ length: 128 }, () => rnd() * 2 - 1); const n = Math.hypot(...v); return v.map(x => Number((x / n).toFixed(5))); };
const hash = s => createHash('sha256').update(String(s)).digest('base64url');
// ponto aleatório a até `raio` metros do centro
function perto(lat, lng, raio) { const r = rnd() * raio, a = rnd() * 2 * Math.PI; return { lat: lat + (r * Math.cos(a)) / 111320, lng: lng + (r * Math.sin(a)) / (111320 * Math.cos(lat * Math.PI / 180)) }; }

async function main() {
  const emp = alvo
    ? (await q('SELECT id, nome FROM empresa WHERE link_token=$1 OR id=$1 LIMIT 1', [alvo]))[0]
    : (await q('SELECT id, nome FROM empresa ORDER BY criada_em LIMIT 1'))[0];
  if (!emp) { console.error('empresa não encontrada'); process.exit(1); }
  const rh = (await q('SELECT id FROM usuario_rh WHERE empresa_id=$1 AND ativo ORDER BY criado_em LIMIT 1', [emp.id]))[0];
  console.log('Empresa:', emp.nome, '· hoje (fuso):', hojeLocal);

  // ---------- locais ----------
  const LOCAIS = [
    { nome: 'Escritório Efrat', lat: -20.4697, lng: -54.6201, raio: 150 },
    { nome: 'Obra 504 - PPD São Gabriel', lat: -19.3925, lng: -54.5647, raio: 300 },
    { nome: 'Obra 547 - Imburussu', lat: -20.5210, lng: -54.6300, raio: 250 }
  ];
  const local = {};
  for (const l of LOCAIS) {
    let r = (await q('SELECT id FROM local WHERE empresa_id=$1 AND nome=$2', [emp.id, l.nome]))[0];
    if (!r) { r = { id: randomUUID() }; await q('INSERT INTO local (id, empresa_id, nome, lat, lng, raio_m) VALUES ($1,$2,$3,$4,$5,$6)', [r.id, emp.id, l.nome, l.lat, l.lng, l.raio]); }
    local[l.nome] = Object.assign({ id: r.id }, l);
  }

  // ---------- jornadas ----------
  const JORN = [{ nome: 'Obra 07–17', entrada: '07:00', saida: '17:00', tol: 10 }, { nome: 'Escritório 08–18', entrada: '08:00', saida: '18:00', tol: 15 }];
  const jornada = {};
  for (const j of JORN) {
    let r = (await q('SELECT id FROM jornada WHERE empresa_id=$1 AND nome=$2', [emp.id, j.nome]))[0];
    if (!r) { r = { id: randomUUID() }; await q('INSERT INTO jornada (id, empresa_id, nome, entrada, saida, tolerancia_min) VALUES ($1,$2,$3,$4,$5,$6)', [r.id, emp.id, j.nome, j.entrada, j.saida, j.tol]); }
    jornada[j.nome] = Object.assign({ id: r.id }, j);
  }

  // ---------- equipes ----------
  const EQUIPES = [
    { nome: 'Obra 504 - PPD São Gabriel', jornada: 'Obra 07–17', local: 'Obra 504 - PPD São Gabriel', dias: [1, 2, 3, 4, 5], fim: null },
    { nome: 'Obra 547 - Imburussu', jornada: 'Obra 07–17', local: 'Obra 547 - Imburussu', dias: [1, 2, 3, 4, 5, 6], fim: diaMais(hojeLocal, 2) },   // vencendo
    { nome: 'Escritório Efrat', jornada: 'Escritório 08–18', local: 'Escritório Efrat', dias: [1, 2, 3, 4, 5], fim: null }
  ];
  const equipe = {};
  for (const e of EQUIPES) {
    let r = (await q('SELECT id FROM equipe WHERE empresa_id=$1 AND lower(nome)=lower($2)', [emp.id, e.nome]))[0];
    if (!r) { r = { id: randomUUID() }; await q('INSERT INTO equipe (id, empresa_id, nome) VALUES ($1,$2,$3)', [r.id, emp.id, e.nome]); }
    await q('UPDATE equipe SET jornada_id=$2, ativo=true WHERE id=$1', [r.id, jornada[e.jornada].id]);
    equipe[e.nome] = Object.assign({ id: r.id }, e);
  }

  // ---------- colaboradores ----------
  // perfil: normal | fora_cerca | cinzenta | manual | sem_liveness | deriva | sem_entrada_hoje | saida_esquecida | atrasado
  const PESSOAS = [
    { mat: 'D001', nome: 'Marcos Coenga', eq: 'Obra 504 - PPD São Gabriel', papel: 'gestor', bio: true, perfil: 'normal', supervisor: true },
    { mat: 'D002', nome: 'Ailton Nascimento', eq: 'Obra 504 - PPD São Gabriel', bio: true, perfil: 'fora_cerca' },
    { mat: 'D003', nome: 'Alex Arguelho', eq: 'Obra 504 - PPD São Gabriel', bio: true, perfil: 'deriva' },
    { mat: 'D004', nome: 'Alcinei Souza', eq: 'Obra 504 - PPD São Gabriel', bio: true, perfil: 'sem_entrada_hoje' },
    { mat: 'D005', nome: 'Allison Lima', eq: 'Obra 504 - PPD São Gabriel', bio: false, perfil: 'sem_bio' },
    { mat: 'D006', nome: 'João Batista', eq: 'Obra 504 - PPD São Gabriel', bio: true, perfil: 'sem_liveness' },
    { mat: 'D007', nome: 'Thiago Fagundes', eq: 'Obra 547 - Imburussu', papel: 'gestor', bio: true, perfil: 'normal', supervisor: true },
    { mat: 'D008', nome: 'Alex Garcia', eq: 'Obra 547 - Imburussu', bio: true, perfil: 'cinzenta' },
    { mat: 'D009', nome: 'Carlos Eduardo', eq: 'Obra 547 - Imburussu', bio: true, perfil: 'manual' },
    { mat: 'D010', nome: 'Ana Paula Ferreira', eq: 'Obra 547 - Imburussu', bio: true, perfil: 'atrasado' },
    { mat: 'D011', nome: 'Agatha Caldeira', eq: 'Escritório Efrat', bio: true, perfil: 'normal' },
    { mat: 'D012', nome: 'Rafael Vasconcelos', eq: 'Escritório Efrat', bio: true, perfil: 'saida_esquecida' },
    { mat: 'D013', nome: 'Juliana Martins', eq: 'Escritório Efrat', bio: false, perfil: 'sem_bio' },
    { mat: 'D014', nome: 'Ezequias Santos', eq: null, bio: true, perfil: 'sem_equipe' },
    { mat: 'D015', nome: 'Daniel dos Santos', eq: 'Obra 504 - PPD São Gabriel', bio: true, perfil: 'desligado', ativo: false }
  ];
  const pessoa = {};
  for (const p of PESSOAS) {
    let r = (await q('SELECT id FROM colaborador WHERE empresa_id=$1 AND matricula=$2', [emp.id, p.mat]))[0];
    const eqId = p.eq ? equipe[p.eq].id : null;
    if (!r) { r = { id: randomUUID() }; await q('INSERT INTO colaborador (id, empresa_id, nome, matricula, papel, equipe_padrao, ativo) VALUES ($1,$2,$3,$4,$5,$6,$7)', [r.id, emp.id, p.nome, p.mat, p.papel || 'colaborador', eqId, p.ativo !== false]); }
    else await q('UPDATE colaborador SET nome=$2, papel=$3, equipe_padrao=$4, ativo=$5 WHERE id=$1', [r.id, p.nome, p.papel || 'colaborador', eqId, p.ativo !== false]);
    pessoa[p.mat] = Object.assign({ id: r.id }, p);
    if (p.supervisor && eqId) await q('UPDATE equipe SET supervisor_id=$2 WHERE id=$1', [eqId, r.id]);
    // biometria fake + aparelho
    if (p.bio) {
      const tem = (await q("SELECT 1 FROM template_facial WHERE colaborador_id=$1 AND estado='ativo'", [r.id]))[0];
      if (!tem) await q("INSERT INTO template_facial (id, colaborador_id, versao, vetores, miniatura_url, coerencia, estado, origem) VALUES ($1,$2,1,$3,$4,0.31,'ativo','rh')",
        [randomUUID(), r.id, JSON.stringify([vetor(), vetor(), vetor()]), avatares[p.nome] || null]);
      let d = (await q('SELECT id FROM dispositivo WHERE colaborador_id=$1 AND ativo', [r.id]))[0];
      if (!d) { d = { id: randomUUID() }; await q("INSERT INTO dispositivo (id, empresa_id, colaborador_id, credencial_hash, apelido, ua, ativo, estado, pareado_em, visto_em) VALUES ($1,$2,$3,$4,$5,'Demo/Android',true,$6, now() - interval '20 days', now())",
        [d.id, emp.id, r.id, hash('demo-' + p.mat + '-' + randomBytes(8).toString('hex')), 'Celular de ' + p.nome.split(' ')[0], p.ativo === false ? 'bloqueado' : 'ativo']); }
      if (p.ativo === false) await q("UPDATE dispositivo SET estado='bloqueado', bloqueado_em=now() - interval '3 days', motivo_bloqueio='colaborador_inativo' WHERE id=$1", [d.id]);
      pessoa[p.mat].disp = d.id;
    }
  }

  // ---------- escalas (planos) + alocações (14 dias atrás … +90) ----------
  const inicio = diaMais(hojeLocal, -21);
  for (const e of EQUIPES) {
    const membros = PESSOAS.filter(p => p.eq === e.nome && p.ativo !== false).map(p => pessoa[p.mat].id);
    const L = local[e.local];
    let pl = (await q('SELECT id FROM plano_alocacao WHERE empresa_id=$1 AND equipe_id=$2 AND ativo', [emp.id, equipe[e.nome].id]))[0];
    if (!pl) { pl = { id: randomUUID() }; await q(`INSERT INTO plano_alocacao (id, empresa_id, nome, equipe_id, colaboradores, cerca_lat, cerca_lng, cerca_raio_m, dias_semana, vigencia_inicio, vigencia_fim)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [pl.id, emp.id, e.nome.replace(/^Obra /, 'Projeto '), equipe[e.nome].id, membros, L.lat, L.lng, L.raio, e.dias, inicio, e.fim]); }
    else await q('UPDATE plano_alocacao SET colaboradores=$2, vigencia_fim=$3 WHERE id=$1', [pl.id, membros, e.fim]);
    equipe[e.nome].plano = pl.id;
    const ate = e.fim || diaMais(hojeLocal, 90);
    for (let d = inicio; d <= ate; d = diaMais(d, 1)) {
      if (!e.dias.includes(dow(d))) continue;
      for (const c of membros) {
        await q(`INSERT INTO alocacao (id, empresa_id, dia, colaborador_id, equipe_id, cerca_lat, cerca_lng, cerca_raio_m, origem, plano_id)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'plano',$9) ON CONFLICT (empresa_id, dia, colaborador_id) DO NOTHING`, [randomUUID(), emp.id, d, c, equipe[e.nome].id, L.lat, L.lng, L.raio, pl.id]);
      }
    }
  }
  // ajuste manual de hoje: Alcinei (504) deslocado para o Escritório só hoje
  { const L = local['Escritório Efrat'];
    await q(`INSERT INTO alocacao (id, empresa_id, dia, colaborador_id, equipe_id, cerca_lat, cerca_lng, cerca_raio_m, origem, plano_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'manual',NULL)
             ON CONFLICT (empresa_id, dia, colaborador_id) DO UPDATE SET equipe_id=EXCLUDED.equipe_id, cerca_lat=EXCLUDED.cerca_lat, cerca_lng=EXCLUDED.cerca_lng, cerca_raio_m=EXCLUDED.cerca_raio_m, origem='manual', plano_id=NULL`,
      [randomUUID(), emp.id, hojeLocal, pessoa.D004.id, equipe['Escritório Efrat'].id, L.lat, L.lng, L.raio]); }

  // ---------- marcações: últimos 10 dias úteis + hoje ----------
  const dias = []; for (let d = diaMais(hojeLocal, -1); dias.length < 10; d = diaMais(d, -1)) if (dow(d) <= 5) dias.push(d);
  dias.reverse();
  let nMarc = 0, nCorr = 0;
  const marcar = async (m) => {
    await q(`INSERT INTO marcacao (id_cliente, empresa_id, colaborador_id, dispositivo_id, equipe_id, tipo, origem, veredito, score, liveness_ok, motivo,
              marcado_em, marcado_dia, deriva_ms, lat, lng, precisao_m, dentro_cerca, distancia_cerca_m, foto_url, requer_revisao)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) ON CONFLICT (id_cliente) DO NOTHING`,
      [m.id, emp.id, m.colab, m.disp, m.equipe, m.tipo, m.origem || 'biometria', m.veredito, m.score ?? null, m.liveness ?? true, m.motivo || null,
       m.em.toISOString(), m.dia, m.deriva || 0, m.lat ?? null, m.lng ?? null, m.precisao ?? null, m.dentro ?? null, m.dist ?? null, m.foto || null, !!m.revisar]);
    nMarc++;
  };
  const corrigir = async (idCliente, acao, motivo, ha) => {
    await q(`INSERT INTO correcao (id, empresa_id, alvo_tipo, alvo_id, acao, motivo, usuario_rh_id, criada_em) VALUES ($1,$2,'marcacao',$3,$4,$5,$6, now() - ($7 || ' hours')::interval)`,
      [randomUUID(), emp.id, idCliente, acao, motivo, rh ? rh.id : null, String(ha)]); nCorr++;
  };

  const todosDias = dias.concat([hojeLocal]);
  for (const p of PESSOAS) {
    if (!p.eq || p.ativo === false || !p.bio) continue;
    const P = pessoa[p.mat]; const E = equipe[p.eq]; const L = local[E.local]; const J = jornada[E.jornada];
    const [hE] = J.entrada.split(':').map(Number), [hS] = J.saida.split(':').map(Number);
    for (let i = 0; i < todosDias.length; i++) {
      const dia = todosDias[i]; const hoje = dia === hojeLocal;
      if (!E.dias.includes(dow(dia))) continue;
      const ja = (await q('SELECT 1 FROM marcacao WHERE colaborador_id=$1 AND marcado_dia=$2 LIMIT 1', [P.id, dia]))[0];
      if (ja) continue;
      if (p.perfil === 'sem_entrada_hoje' && hoje) continue;                       // exceção "sem entrada"
      const cercaDe = hoje && p.mat === 'D004' ? local['Escritório Efrat'] : L;
      const base = (tipo, hh, mm, extra = {}) => {
        const g = perto(cercaDe.lat, cercaDe.lng, 40);
        return Object.assign({ id: randomUUID(), colab: P.id, disp: P.disp, equipe: E.id, tipo, em: emLocal(dia, hh, mm), dia,
          veredito: 'aceito', score: Number((0.32 + rnd() * 0.12).toFixed(3)), liveness: true, lat: g.lat, lng: g.lng, precisao: entre(6, 25),
          dentro: true, dist: entre(3, 40), revisar: false }, extra);
      };
      let atraso = p.perfil === 'atrasado' ? entre(25, 45) : entre(-12, 8);
      const ent = base('entrada', hE, 0); ent.em = emLocal(dia, hE, 0); ent.em = new Date(ent.em.getTime() + atraso * 60000);
      const sai = base('saida', hS, 0); sai.em = new Date(sai.em.getTime() + entre(-5, 20) * 60000);
      const foto = avatares[p.nome] || null;

      // variações por perfil, em dias escolhidos
      if (p.perfil === 'fora_cerca' && (i === 3 || i === todosDias.length - 2)) {
        const longe = perto(cercaDe.lat + 0.008, cercaDe.lng, 60);   // ~900 m
        Object.assign(ent, { lat: longe.lat, lng: longe.lng, dentro: false, dist: entre(850, 950), veredito: 'revisar', revisar: true, foto, motivo: 'fora_da_cerca' });
      }
      if (p.perfil === 'cinzenta' && (i === 5 || hoje)) Object.assign(ent, { score: Number((0.53 + rnd() * 0.05).toFixed(3)), veredito: 'revisar', revisar: true, foto });
      if (p.perfil === 'manual' && (i === 2 || i === 6 || i === 8)) Object.assign(ent, { origem: 'manual', veredito: 'revisar', revisar: true, score: null, liveness: null, motivo: 'celular sem bateria — registro pelo supervisor', foto: null, lat: null, lng: null, precisao: null, dentro: null, dist: null });
      if (p.perfil === 'sem_liveness' && i === todosDias.length - 3) Object.assign(ent, { liveness: false, veredito: 'revisar', revisar: true, foto });
      if (p.perfil === 'deriva' && i === 4) Object.assign(sai, { deriva: 185000, veredito: 'revisar', revisar: true, foto, motivo: 'relógio do aparelho 3 min fora' });

      await marcar(ent);
      if (!hoje) {
        if (p.perfil === 'saida_esquecida' && i === 7) { /* esqueceu a saída */ }
        else await marcar(sai);
      }
      // decisões do RH já tomadas (histórico): exceções antigas resolvidas; as dos últimos 2 dias ficam abertas
      const antigo = i < todosDias.length - 2;
      if (ent.revisar && antigo) await corrigir(ent.id, p.perfil === 'cinzenta' ? 'rejeitar' : 'aprovar', p.perfil === 'manual' ? 'confirmado com o supervisor' : p.perfil === 'cinzenta' ? 'não era o colaborador — pediu ao colega para bater' : 'GPS ruim, colaborador estava na obra (confirmado pelo encarregado)', 24 * (todosDias.length - i));
      if (sai.revisar && antigo) await corrigir(sai.id, 'aprovar', 'ajuste de relógio', 24 * (todosDias.length - i));
    }
  }

  // ---------- aparelho pendente (link da empresa) ----------
  const pend = (await q("SELECT id FROM dispositivo WHERE empresa_id=$1 AND estado='pendente' AND matricula_informada='D020' LIMIT 1", [emp.id]))[0];
  if (!pend) {
    const id = randomUUID(); const L = local['Obra 504 - PPD São Gabriel'];
    await q(`INSERT INTO dispositivo (id, empresa_id, colaborador_id, credencial_hash, apelido, ua, ativo, estado, pareado_em, visto_em, matricula_informada, cadastro)
             VALUES ($1,$2,NULL,$3,'Celular (primeiro acesso)','Demo/Android',true,'pendente', now() - interval '9 hours', now() - interval '1 hour', 'D020', $4)`,
      [id, emp.id, hash('pend-' + randomBytes(8).toString('hex')), JSON.stringify({ vetores: [vetor()], miniatura_url: avatares['Desconhecido'] || null })]);
    for (const [tipo, hh, mm] of [['entrada', 7, 4], ['saida', 11, 58]]) {
      const g = perto(L.lat, L.lng, 30);
      await q(`INSERT INTO marcacao (id_cliente, empresa_id, colaborador_id, dispositivo_id, equipe_id, tipo, origem, veredito, liveness_ok, motivo, marcado_em, marcado_dia, deriva_ms, lat, lng, precisao_m, foto_url, requer_revisao)
               VALUES ($1,$2,NULL,$3,NULL,$4,'biometria','revisar',true,'aparelho_nao_identificado',$5,$6,0,$7,$8,11,$9,true)`,
        [randomUUID(), emp.id, id, tipo, emLocal(hojeLocal, hh, mm).toISOString(), hojeLocal, g.lat, g.lng, avatares['Desconhecido'] || null]);
      nMarc++;
    }
  }

  console.log(`✓ demo: ${PESSOAS.length} colaboradores, ${EQUIPES.length} equipes/escalas, ${LOCAIS.length} locais, ${JORN.length} jornadas, ${nMarc} marcações novas, ${nCorr} decisões do RH, 1 aparelho pendente`);
}
main().catch(e => { console.error(e); process.exit(1); });
