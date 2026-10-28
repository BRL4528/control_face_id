// Funcionalidade com tabela nova pode chegar ao ar antes da migração rodar no banco.
// Em vez de 500, a rota responde 503 MIGRACAO_PENDENTE e a tela avisa, sem afetar
// o resto do painel nem o ponto.
import { erro } from './http.js';

export const faltaTabela = e => /relation "[^"]+" does not exist/.test(String((e && e.message) || e));

export async function comTabelaNova(res, fn) {
  try { return await fn(); }
  catch (e) {
    if (faltaTabela(e)) return erro(res, 503, 'MIGRACAO_PENDENTE', 'falta rodar a migração do banco para esta função (db/schema.sql)');
    throw e;
  }
}
