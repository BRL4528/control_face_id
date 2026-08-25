// Prova de vida da origem da API. Nao e rota do contrato — as 25 rotas sao do
// cartao API-4, contra o nucleo do API-1. Esta existe para responder tres
// perguntas que so a infraestrutura responde:
//
//   1. a terceira origem esta no ar e serve JSON;
//   2. a funcao alcanca o banco (SELECT 1 de verdade, nao um ok hardcoded —
//      "saude" que nao toca o banco fica verde com o banco fora);
//   3. o CORS libera exatamente as origens declaradas, e nao '*'.
//
// Nao devolve nome de banco, versao, host nem contagem de tabela: sonda publica
// e sem autenticacao, entao ela diz VIVO ou NAO, e nada sobre a topologia.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';
import { aplicarCors } from '../lib/origens.js';

export default async function handler(req, res) {
  if (aplicarCors(req, res)) return;

  // FORA de producao, a sonda diz TAMBEM em que banco ela caiu. Nao e
  // inconsistencia com o paragrafo acima: o que nao pode vazar e a topologia da
  // origem de PRODUCAO. Num preview a pergunta "estou no banco descartavel ou
  // no da demo?" e exatamente o que precisa ser respondida ANTES de alguem
  // rodar uma corrida que grava marcacao — e marcacao, por contrato, nunca e
  // apagada. Descobrir isso depois nao tem conserto.
  const revelaBanco = process.env.VERCEL_ENV !== 'production';

  // O nucleo NAO mora nesta pasta: ele e copiado no build a partir da raiz do
  // repo (copiar-nucleo.sh), porque o Root Directory daqui e servidor/ e o
  // servidor falso precisa da MESMA fonte. Import que nao resolve so apareceria
  // no primeiro request da primeira rota que o usa — em producao, no teste.
  // Entao a sonda carrega o adaptador, que por sua vez importa o nucleo: se a
  // copia faltou ou veio incompleta, a saude fica vermelha ANTES de alguem
  // depender disso.
  // O SINAL PERCORRE O MESMO CAMINHO QUE A REQUISICAO, e por construcao —
  // nao por lista.
  //
  // Duas versoes anteriores erraram do mesmo jeito, cada uma um degrau mais
  // fundo: a primeira dizia 200 sem olhar rota nenhuma; a segunda importava
  // persistencia/postgres.js e chamava isso de "nucleo ok", enquanto
  // nucleo/dominio.js — que praticamente toda rota usa — nem carregava, porque
  // reexporta funcoes puras de ../js/ que a copia de build nao trazia.
  // Importar UM arquivo do nucleo prova que aquele arquivo carrega, nao que o
  // nucleo carrega.
  //
  // Aqui a sonda MONTA O ROTEADOR REAL a partir da tabela real e RESOLVE uma
  // rota, sem executa-la. O caminho resolvido sai da propria tabela, entao nao
  // ha nome escrito a mao para ficar desatualizado. Se o roteador monta e
  // resolve, entao tudo o que o despacho precisa carregou: rotas -> casos ->
  // dominio -> js/coerencia + js/regras. Nao ha lista que possa ficar
  // incompleta, porque nao ha lista.
  const { roteador, erro: erroRotas } = await import('../lib/rotas.js').then(m => m.carregarRotas());
  const rotas = roteador ? roteador.caminhos().length : 0;

  let nucleo = 'ausente';
  if (roteador && rotas > 0) {
    const primeira = roteador.caminhos()[0];
    const achou = roteador.achar(primeira);
    nucleo = achou && typeof achou.manipulador === 'function' ? 'ok' : 'incompleto';
  }

  let banco = 'sem_configuracao';
  let nome = null;
  if (process.env.DATABASE_URL) {
    try {
      const sql = neon(process.env.DATABASE_URL);
      const r = await sql`select current_database() as db`;
      banco = 'ok';
      if (revelaBanco) nome = r[0].db;
    } catch {
      // Sem detalhe do erro na resposta: mensagem de driver vaza host e usuario.
      banco = 'indisponivel';
    }
  }

  // rotas === 0 e 503 DE PROPOSITO. Uma origem de API sem rota nenhuma nao esta
  // saudavel, esta vazia — e o custo de chamar isso de 200 ja foi medido hoje.
  // QUAL COMMIT ESTA NO AR (T-B19BBE). Carimbado no build por
  // copiar-nucleo.sh, porque a Vercel nao injeta VERCEL_GIT_COMMIT_SHA em
  // deploy por CLI.
  //
  // SHA COMPLETO, 40 caracteres, combinado com o QA: dois instrumentos
  // mostrando recortes diferentes do mesmo commit produzem exatamente a duvida
  // que este campo existe para matar. Com o inteiro nao ha recorte que possa
  // divergir — qualquer recorte do outro lado e prefixo deste.
  //
  // `arvore_suja` vale tanto quanto o sha. Deploy feito com mudanca nao
  // commitada tem um sha que MENTE sobre o que esta no ar, e sha que mente e
  // pior que sha ausente: ausencia nao atesta nada, atestado falso atesta.
  let versao = { commit: null, ref: null, arvore_suja: null };
  try {
    const aqui = path.dirname(fileURLToPath(import.meta.url));
    versao = JSON.parse(fs.readFileSync(path.join(aqui, '..', 'versao.json'), 'utf8'));
  } catch { /* sem carimbo: os campos ficam null e isso ja e a informacao */ }

  const saudavel = banco === 'ok' && nucleo === 'ok' && rotas > 0;
  res.statusCode = saudavel ? 200 : 503;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const corpo = { ok: saudavel, commit: versao.commit, ref: versao.ref, arvore_suja: versao.arvore_suja, banco, nucleo, rotas, causa_rotas: rotas ? undefined : erroRotas, servidor_hora: new Date().toISOString() };
  if (nome) { corpo.banco_nome = nome; corpo.ambiente = process.env.VERCEL_ENV || 'desconhecido'; }
  res.end(JSON.stringify(corpo));
}
