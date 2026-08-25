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

  res.statusCode = banco === 'ok' ? 200 : 503;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const corpo = { ok: banco === 'ok', banco, servidor_hora: new Date().toISOString() };
  if (nome) { corpo.banco_nome = nome; corpo.ambiente = process.env.VERCEL_ENV || 'desconhecido'; }
  res.end(JSON.stringify(corpo));
}
