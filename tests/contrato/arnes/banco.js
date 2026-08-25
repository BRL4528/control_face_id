// ARNÊS · o banco REAL sobre o qual a suíte de contrato passa a correr.
//
// Por que este arquivo existe: o servidor falso guarda tudo em `Map`. Num Map,
// "olhar e depois gravar" é atômico DE GRAÇA — o Node é uma thread só e não há
// `await` entre o `has` e o `set` (tests/e2e/servidor-falso.js:946 e :963). Em
// banco de verdade, com driver de verdade, há E/S entre os dois, e a mesma
// linha de código passa a perder a corrida.
//
// É exatamente por isso que VERDE CONTRA O SERVIDOR FALSO NÃO CONTA: ele é o
// réu, e a propriedade que estamos medindo é justamente a que ele ganha de
// brinde por ser um Map. Medir aqui é medir onde a propriedade custa.
//
// DOIS MODOS, e o segundo é o ponto de plugue do API-2:
//
//   ARNES_PG_URL=postgres://...   -> usa ESSE banco, não sobe nada.
//                                    É assim que o DevOps aponta o arnês para
//                                    o provedor provisionado, sem tocar aqui.
//   (sem a variável)              -> sobe um postgres:16-alpine em container
//                                    descartável, porta escolhida pelo Docker.
//
// Nunca cai para um substituto em memória. Banco ausente é PULO ANUNCIADO
// (veja `motivoIndisponivel`), nunca verde silencioso — arnês que se degrada
// sozinho para um Map volta a medir o réu sem avisar.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';

const exec = promisify(execFile);

export const IMAGEM = 'postgres:16-alpine';
const SENHA = 'arnes';
const BANCO = 'arnes';

async function docker(args, timeout = 60000) {
  const { stdout } = await exec('docker', args, { timeout });
  return stdout.trim();
}

/**
 * Diz por que o arnês NÃO pode rodar, ou null quando pode. Chamado antes de
 * qualquer teste, para que a ausência de banco vire mensagem e não silêncio.
 * @returns {Promise<string|null>}
 */
export async function motivoIndisponivel() {
  if (process.env.ARNES_PG_URL) return null;
  try {
    await docker(['info'], 15000);
  } catch {
    return 'Docker indisponível e ARNES_PG_URL não definida — sem banco real não há medição.';
  }
  try {
    const saida = await docker(['image', 'inspect', IMAGEM, '--format', '{{.Id}}'], 20000);
    if (!saida) throw new Error('vazio');
  } catch {
    return `imagem ${IMAGEM} ausente (docker pull ${IMAGEM}) e ARNES_PG_URL não definida.`;
  }
  return null;
}

/**
 * Sobe (ou reaproveita) um Postgres e devolve um pool conectado.
 * @returns {Promise<{url: string, pool: import('pg').Pool, proprio: boolean, parar: () => Promise<void>}>}
 */
export async function subirBanco() {
  const externo = process.env.ARNES_PG_URL;
  if (externo) {
    const pool = new pg.Pool({ connectionString: externo, max: 12 });
    await esperarPronto(pool);
    return { url: externo, pool, proprio: false, parar: async () => { await pool.end(); } };
  }

  // `--rm` para o container sumir sozinho se o processo de teste morrer no
  // meio; fsync desligado porque é banco descartável e durabilidade aqui só
  // custaria segundos. `127.0.0.1::5432` deixa o Docker escolher a porta —
  // escolher porta livre por conta própria é corrida com quem escolhe junto.
  const id = await docker([
    'run', '-d', '--rm',
    '-e', `POSTGRES_PASSWORD=${SENHA}`,
    '-e', `POSTGRES_DB=${BANCO}`,
    '-p', '127.0.0.1::5432',
    IMAGEM,
    'postgres', '-c', 'fsync=off', '-c', 'full_page_writes=off', '-c', 'synchronous_commit=off'
  ], 120000);

  let pool;
  try {
    const mapeada = await docker(['port', id, '5432/tcp']);
    const porta = mapeada.split('\n')[0].trim().split(':').pop();
    const url = `postgres://postgres:${SENHA}@127.0.0.1:${porta}/${BANCO}`;
    pool = new pg.Pool({ connectionString: url, max: 12 });
    await esperarPronto(pool);
    return {
      url,
      pool,
      proprio: true,
      parar: async () => {
        try { await pool.end(); } catch { /* pool já caiu junto com o container */ }
        try { await docker(['stop', '-t', '1', id], 30000); } catch { /* --rm já levou */ }
      }
    };
  } catch (e) {
    try { if (pool) await pool.end(); } catch { /* idem */ }
    try { await docker(['stop', '-t', '1', id], 30000); } catch { /* idem */ }
    throw e;
  }
}

/** O container responde antes de o Postgres aceitar conexão; espera de fato. */
async function esperarPronto(pool, tetoMs = 60000) {
  const limite = Date.now() + tetoMs;
  let ultimo;
  while (Date.now() < limite) {
    try {
      await pool.query('select 1');
      return;
    } catch (e) {
      ultimo = e;
      await new Promise(r => setTimeout(r, 250));
    }
  }
  throw new Error(`Postgres não ficou pronto em ${tetoMs}ms: ${ultimo && ultimo.message}`);
}

/**
 * O que fazer quando não há banco real.
 *
 * Pular é o padrão certo na máquina de alguém sem Docker — travar o
 * desenvolvimento de terceiros por causa do meu arnês seria pior. Mas em CI,
 * teste pulado sai com codigo 0 e o painel fica VERDE: exatamente a falha
 * silenciosa que este arnês existe para não cometer. `ARNES_EXIGIR_BANCO=1`
 * troca o pulo por REPROVAÇÃO, e é assim que a esteira tem de rodar.
 *
 * @param {string|null} impedimento
 * @returns {{opcoes: object, reprovar: string|null}} `opcoes` vai no test();
 *   `reprovar`, quando não-nulo, é a mensagem com que o corpo deve falhar.
 */
export function politicaDeAusencia(impedimento) {
  if (!impedimento) return { opcoes: {}, reprovar: null };
  if (process.env.ARNES_EXIGIR_BANCO === '1') {
    return {
      opcoes: {},
      reprovar: `ARNES_EXIGIR_BANCO=1 e nao ha banco real — ${impedimento}\n` +
        'Pular aqui devolveria codigo 0 e pintaria a esteira de verde sem ter medido nada.'
    };
  }
  return { opcoes: { skip: `ARNÊS SEM BANCO REAL — ${impedimento}` }, reprovar: null };
}
