// CALIBRAÇÃO DO ARNÊS — NÃO É A API DO PRODUTO. Veja o cabeçalho de repos.js.
//
// HTTP mínimo em volta dos repositórios de aferição: só as DUAS rotas que os
// dois alvos do cartão exercitam, e só as decisões que os testes conferem.
// Autenticação, limite de volume, coerência das 3 fotos, idempotência e as
// outras 23 rotas NÃO estão aqui de propósito — quem as porta é o API-4, e
// reimplementá-las aqui criaria uma segunda fonte da verdade concorrendo com
// tests/e2e/servidor-falso.js.
//
// O que ESTE arquivo precisa ser fiel é o CONTRATO DE SAÍDA das duas rotas: o
// mesmo caminho, os mesmos campos de status. É isso que faz o teste escrito
// aqui ser LITERALMENTE O MESMO teste que vai rodar contra o API-4 depois, sem
// reescrita de asserção.
import http from 'node:http';
import { hashToken } from './repos.js';

const json = (res, status, corpo) => {
  const texto = JSON.stringify(corpo);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(texto);
};

const lerCorpo = req => new Promise((resolve, reject) => {
  const partes = [];
  req.on('data', p => partes.push(p));
  req.on('end', () => {
    const bruto = Buffer.concat(partes).toString('utf8');
    try { resolve(bruto ? JSON.parse(bruto) : {}); } catch (e) { reject(e); }
  });
  req.on('error', reject);
});

/**
 * @param {object} p
 * @param {import('pg').Pool} p.pool
 * @param {object} p.repoMarcacao  uma das VARIANTES.marcacao
 * @param {object} p.repoConvite   uma das VARIANTES.convite
 * @returns {Promise<{base: string, encerrar: () => Promise<void>}>}
 */
export async function subirApiReferencia({ pool, repoMarcacao, repoConvite }) {
  const servidor = http.createServer(async (req, res) => {
    let corpo;
    try { corpo = await lerCorpo(req); }
    catch { return json(res, 400, { ok: false, erro: { codigo: 'CORPO_INVALIDO' } }); }

    try {
      // ---------------------------------------------------------------- //
      // §1.6 / §3.3.3 — nunca 403 por estado; sempre 200 item a item, que é
      // o único formato em que o aparelho consegue soltar da fila o que já
      // foi resolvido.
      // ---------------------------------------------------------------- //
      if (req.url === '/webhook/efrat/marcacoes') {
        const resultados = [];
        for (const m of (corpo.marcacoes || [])) {
          if (!m || !m.id_cliente || !m.pessoa_id || !m.marcado_em) {
            resultados.push({ id_cliente: m && m.id_cliente, status: 'rejeitado', motivo: 'campos obrigatorios ausentes' });
            continue;
          }
          const { inserida } = await repoMarcacao.inserirMarcacaoSeAusente(pool, m);
          resultados.push({ id_cliente: m.id_cliente, status: inserida ? 'aceito' : 'duplicado', motivo: null });
        }
        const conta = s => resultados.filter(x => x.status === s).length;
        return json(res, 200, {
          ok: true,
          servidor_hora: new Date().toISOString(),
          resumo: {
            aceitas: conta('aceito'), duplicadas: conta('duplicado'),
            retidas: conta('retido'), rejeitadas: conta('rejeitado')
          },
          resultados
        });
      }

      // ---------------------------------------------------------------- //
      // §4.4 — uso único do convite. Ameaça 1.3.
      // ---------------------------------------------------------------- //
      if (req.url === '/webhook/efrat/face/convite/enviar') {
        const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
        const achado = await pool.query(
          'select convite_id, pessoa_id from convite where token_hash = $1',
          [hashToken(token)]
        );
        const c = achado.rows[0];
        if (!c) return json(res, 404, { ok: false, erro: { codigo: 'CONVITE_INVALIDO' } });

        // O template_id é derivado da PESSOA, não da requisição: é assim no
        // servidor falso ('t-' + pessoa_id, servidor-falso.js:1649). Manter
        // isso importa para a aferição — com id por requisição, dois
        // templates do mesmo convite viravam duas linhas distintas e o
        // ingênuo ficaria óbvio pelo motivo errado. Aqui o segundo template
        // só aparece se o repositório de fato deixou os dois passarem.
        const r = await repoConvite.consumir(pool, {
          conviteId: c.convite_id,
          pessoaId: c.pessoa_id,
          templateId: 't-' + c.pessoa_id + '-' + Math.random().toString(36).slice(2, 10),
          agoraIso: new Date().toISOString()
        });

        if (!r.trocado) {
          return json(res, 409, { ok: false, erro: { codigo: 'CONVITE_CONSUMIDO', mensagem: 'Já recebemos suas fotos. O RH vai conferir.' } });
        }
        return json(res, 200, { ok: true, estado: 'recebido', template_estado: 'pendente' });
      }

      return json(res, 404, { ok: false, erro: { codigo: 'ROTA_DESCONHECIDA' } });
    } catch (e) {
      // 500 é RESULTADO OBSERVÁVEL, não acidente de teste: é exatamente o que
      // a variante 'ingenua-com-indice' produz para quem perde a corrida, e o
      // teste precisa poder vê-lo para reprovar por ele.
      return json(res, 500, { ok: false, erro: { codigo: 'ERRO_INTERNO', mensagem: String(e && e.message) } });
    }
  });

  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  const { port } = servidor.address();
  return {
    base: `http://127.0.0.1:${port}`,
    encerrar: () => new Promise(r => servidor.close(r))
  };
}
