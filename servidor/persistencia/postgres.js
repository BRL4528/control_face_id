// Adaptador Postgres (Neon) da interface de nucleo/repositorio.js.
//
// Confere contra nucleo/memoria.js (a implementacao de referencia) e nao
// contra o proprio julgamento de quem le "ATOMICO" e acha familiar -- por
// isso a doc de cada metodo em nucleo/repositorio.js repete, aqui, qual
// SENTENCA fecha a corrida, nao um resumo dela.
//
// LOTE 2 (NaoRevisado): metodo EXISTE (verificarRepositorio constroi), mas
// o corpo lanca em vez de fingir que funciona. Corrigido metodo a metodo,
// nunca em lote, porque "existe e funciona mais ou menos" e o defeito que
// este projeto ja pagou caro (README.md:356, e as tres impossibilidades do
// n8n em .central-agentes/handoffs/2026-08-24-decisao-api-propria.md).
// trocarEstadoConvite em especial: so sai do throw com revisao INTEIRA,丁
// nunca com o tempo que sobrar de outra coisa (ordem do Orquestrador,
// 2026-08-25) -- e uma das duas razoes de a API existir.

import { neon } from '@neondatabase/serverless';
import { verificarRepositorio } from '../nucleo/repositorio.js';

export class NaoRevisado extends Error {
  constructor(nome) {
    super(`${nome}: adaptador Postgres ainda nao revisado (API-3 lote 2) -- nao chame em producao`);
    this.name = 'NaoRevisado';
  }
}

const paraIso = v => (v == null ? null : new Date(v).toISOString());
const paraMs = v => (v == null ? null : Number(v));
const paraNumero = v => (v == null ? null : Number(v));

export function criarRepositorioPostgres({ connectionString } = {}) {
  const url = connectionString || process.env.DATABASE_URL;
  if (!url) throw new Error('criarRepositorioPostgres: falta DATABASE_URL');
  const sql = neon(url);

  // ==========================================================================
  // APARELHO (dispositivo)
  // ==========================================================================

  const linhaDispositivo = r => (r == null ? null : Object.assign({}, r, {
    aprovado_em: paraIso(r.aprovado_em),
    criado_em: paraIso(r.criado_em),
    ultimo_uso: paraIso(r.ultimo_uso),
    primeiro_pedido_em: paraIso(r.primeiro_pedido_em),
    ultimo_pedido_em: paraIso(r.ultimo_pedido_em),
    recusado_em: paraIso(r.recusado_em),
    revogado_em: paraIso(r.revogado_em)
  }));

  const COLUNAS_DISPOSITIVO = [
    'credencial_hash', 'estado', 'codigo_curto', 'apelido', 'ua', 'geo', 'tentativas',
    'local_id', 'equipes_ids', 'configuracao_versao', 'aprovado_por', 'aprovado_em',
    'criado_em', 'ultimo_uso', 'pendente_id', 'ip_hash', 'primeiro_pedido_em',
    'ultimo_pedido_em', 'unidade', 'recusado_por', 'recusado_em', 'revogado_por',
    'revogado_em', 'motivo_decisao', 'retidasPosRevogacao'
  ];
  const COLUNAS_JSONB_DISPOSITIVO = new Set(['geo']);

  async function lerDispositivo(dispositivoId) {
    const [linha] = await sql`SELECT * FROM efrat_dispositivo WHERE dispositivo_id = ${dispositivoId}`;
    return linhaDispositivo(linha) || null;
  }

  async function listarDispositivos() {
    const linhas = await sql`SELECT * FROM efrat_dispositivo`;
    return linhas.map(linhaDispositivo);
  }

  const repo = {
    lerDispositivo,

    async lerDispositivoPorPendenteId(pendenteId) {
      const [linha] = await sql`SELECT * FROM efrat_dispositivo WHERE pendente_id = ${pendenteId}`;
      return linhaDispositivo(linha) || null;
    },

    // ADICAO de 2026-08-25 (Arquiteto, e72345c) -- leitura de VALIDACAO, nao
    // de decisao. Quem ATIVA continua sendo aprovarDispositivoPorCodigo, que
    // refaz as MESMAS tres condicoes dentro do UPDATE. Conferir duas vezes
    // de proposito: esta leitura pode ficar obsoleta entre validar e
    // escrever, e a escrita e que decide -- usar so esta leitura com um
    // UPDATE incondicional depois e o check-then-act que a interface existe
    // para tirar do caminho.
    async lerDispositivoPorCodigoPendente(codigo, agoraMs, expiraEmMs) {
      const [linha] = await sql`
        SELECT * FROM efrat_dispositivo
         WHERE codigo_curto = ${codigo} AND estado = 'pendente'
           AND criado_em > to_timestamp(${agoraMs - expiraEmMs} / 1000.0)
      `;
      return linhaDispositivo(linha) || null;
    },

    listarDispositivos,

    // ATOMICO em DOIS indices: PK dispositivo_id e o parcial de codigo_curto
    // (WHERE estado='pendente'). ON CONFLICT so cobre UM alvo por INSERT, e
    // aqui os dois tem significado DIFERENTE (dispositivo_id colidindo =
    // "ja existe", codigo_curto colidindo = "sorteie outro") -- por isso o
    // ON CONFLICT cobre dispositivo_id (o caminho mais comum: reenvio do
    // mesmo aparelho) e a colisao de codigo_curto e pega pelo nome da
    // constraint no catch, nunca por um SELECT antes.
    async inserirDispositivoSeAusente(dispositivo) {
      const d = dispositivo;
      try {
        const [linha] = await sql`
          INSERT INTO efrat_dispositivo (
            dispositivo_id, credencial_hash, estado, codigo_curto, apelido, ua, geo,
            tentativas, local_id, equipes_ids, configuracao_versao, criado_em,
            pendente_id, ip_hash, primeiro_pedido_em, ultimo_pedido_em
          ) VALUES (
            ${d.dispositivo_id}, ${d.credencial_hash}, ${d.estado}, ${d.codigo_curto || null},
            ${d.apelido || null}, ${d.ua || null}, ${d.geo ? JSON.stringify(d.geo) : null},
            ${d.tentativas ?? 1}, ${d.local_id || null}, ${d.equipes_ids || []},
            ${d.configuracao_versao ?? 0}, ${d.criado_em}, ${d.pendente_id},
            ${d.ip_hash || null}, ${d.primeiro_pedido_em || d.criado_em}, ${d.ultimo_pedido_em || d.criado_em}
          )
          ON CONFLICT (dispositivo_id) DO NOTHING
          RETURNING *
        `;
        if (linha) return { inserido: true, dispositivo: linhaDispositivo(linha) };
        // dispositivo_id ja existia -- devolve a linha atual para quem chama
        // decidir entre 202 (mesmo aparelho insistindo) e 409 DISPOSITIVO_CONFLITO.
        return { inserido: false, dispositivo: await lerDispositivo(d.dispositivo_id) };
      } catch (erro) {
        if (erro?.code === '23505' && String(erro?.constraint || '').includes('codigo_curto')) {
          return { inserido: false, dispositivo: null, colisaoCodigo: true };
        }
        throw erro;
      }
    },

    async atualizarDispositivo(dispositivoId, campos) {
      const { clausula, valores } = construirSet(campos, COLUNAS_DISPOSITIVO, COLUNAS_JSONB_DISPOSITIVO, 2);
      if (!clausula) return lerDispositivo(dispositivoId);
      const linhas = await sql.query(
        `UPDATE efrat_dispositivo SET ${clausula} WHERE dispositivo_id = $1 RETURNING *`,
        [dispositivoId, ...valores]
      );
      return linhaDispositivo(linhas[0]) || null;
    },

    // ATOMICO -- indice unico parcial decide, nao um SELECT antes.
    async renovarCodigoCurto({ dispositivoId, codigoAntigo, codigoNovo, criadoEm }) {
      try {
        const [linha] = await sql`
          UPDATE efrat_dispositivo
             SET codigo_curto = ${codigoNovo}, criado_em = ${criadoEm}, tentativas = tentativas + 1
           WHERE dispositivo_id = ${dispositivoId} AND estado = 'pendente'
           RETURNING *
        `;
        if (!linha) return { trocado: false, dispositivo: await lerDispositivo(dispositivoId) };
        return { trocado: true, dispositivo: linhaDispositivo(linha) };
      } catch (erro) {
        if (erro?.code === '23505') return { trocado: false, dispositivo: await lerDispositivo(dispositivoId) };
        throw erro;
      }
    },

    // ATOMICO (compare-and-set) -- as tres condicoes na MESMA clausula, como
    // a doc do metodo em nucleo/repositorio.js exige: resolve SO pelo codigo
    // (prova de posse fisica), nunca por uma leitura anterior do dispositivo_id.
    async aprovarDispositivoPorCodigo({ codigo, criadoDepoisDe, campos }) {
      const { clausula, valores } = construirSet(campos || {}, COLUNAS_DISPOSITIVO, COLUNAS_JSONB_DISPOSITIVO, 3);
      const extra = clausula ? `, ${clausula}` : '';
      const [linha] = await sql.query(
        `UPDATE efrat_dispositivo
            SET estado = 'ativo', codigo_curto = NULL${extra}
          WHERE codigo_curto = $1
            AND estado = 'pendente'
            AND criado_em > to_timestamp($2 / 1000.0)
          RETURNING *`,
        [codigo, criadoDepoisDe, ...valores]
      );
      if (linha) return { trocado: true, dispositivo: linhaDispositivo(linha) };
      // Codigo pode nao existir mais (ja usado/expirado/trocado): a doc do
      // metodo so promete `dispositivo` quando localiza a linha pelo codigo
      // atual, e aqui ele nao existe mais -- null e a resposta honesta.
      return { trocado: false, dispositivo: null };
    },

    // ATOMICO -- de:[...] vira ANY($n).
    async trocarEstadoDispositivo({ dispositivoId, de, para, campos }) {
      const { clausula, valores } = construirSet(campos || {}, COLUNAS_DISPOSITIVO, COLUNAS_JSONB_DISPOSITIVO, 4);
      const extra = clausula ? `, ${clausula}` : '';
      const [linha] = await sql.query(
        `UPDATE efrat_dispositivo
            SET estado = $3${extra}
          WHERE dispositivo_id = $1 AND estado = ANY($2)
          RETURNING *`,
        [dispositivoId, de, para, ...valores]
      );
      if (linha) return { trocado: true, dispositivo: linhaDispositivo(linha) };
      return { trocado: false, dispositivo: await lerDispositivo(dispositivoId) };
    },

    // ATOMICO -- incremento puro, nunca ler-somar-gravar.
    async incrementarRetidasPosRevogacao(dispositivoId) {
      const [linha] = await sql`
        UPDATE efrat_dispositivo SET "retidasPosRevogacao" = "retidasPosRevogacao" + 1
         WHERE dispositivo_id = ${dispositivoId}
         RETURNING "retidasPosRevogacao"
      `;
      return linha ? Number(linha.retidasPosRevogacao) : 0;
    },

    async marcarUsoDispositivo(dispositivoId, instanteIso) {
      await sql`UPDATE efrat_dispositivo SET ultimo_uso = ${instanteIso} WHERE dispositivo_id = ${dispositivoId}`;
    },

    async removerEquipeDoEscopoDosDispositivos(equipeId) {
      const linhas = await sql`
        UPDATE efrat_dispositivo
           SET equipes_ids = array_remove(equipes_ids, ${equipeId}),
               configuracao_versao = configuracao_versao + 1
         WHERE ${equipeId} = ANY(equipes_ids)
         RETURNING dispositivo_id
      `;
      return linhas.length;
    },

    // ATOMICO -- UPDATE condicionado ao estado ANTERIOR, no chao de uma unica
    // linha de config (nunca um if em cima de uma leitura separada).
    async consumirTokenLegado() {
      const linhas = await sql`
        UPDATE efrat_config SET valor = 'true'
         WHERE chave = 'token_legado_consumido' AND valor IS DISTINCT FROM 'true'
         RETURNING chave
      `;
      if (linhas.length) return true;
      await sql`
        INSERT INTO efrat_config (chave, valor) VALUES ('token_legado_consumido', 'true')
        ON CONFLICT (chave) DO NOTHING
      `;
      // Se o INSERT tambem nao gravou (corrida com outro consumidor), a
      // linha ja existia com valor='true' -- ninguem alem do primeiro ganha.
      const [depois] = await sql`SELECT valor FROM efrat_config WHERE chave = 'token_legado_consumido'`;
      return depois?.valor === 'true' && linhas.length === 0 ? false : linhas.length > 0;
    },

    // ==========================================================================
    // PESSOA
    // ==========================================================================

    async listarPessoas() {
      const linhas = await sql`SELECT * FROM efrat_pessoa`;
      return linhas.map(linhaPessoa);
    },

    async lerPessoa(pessoaId) {
      const [linha] = await sql`SELECT * FROM efrat_pessoa WHERE pessoa_id = ${pessoaId}`;
      return linhaPessoa(linha) || null;
    },

    async inserirPessoa(pessoa) {
      const p = pessoa;
      const [linha] = await sql`
        INSERT INTO efrat_pessoa (
          pessoa_id, nome, matricula, equipe_id, papel, ativo, telefone, versao,
          vetores, miniatura, versao_cadastro, origem, coerencia, criado_em,
          modelo_id, modelo_divergente, modelo_desconhecido
        ) VALUES (
          ${p.pessoa_id}, ${p.nome}, ${p.matricula || null}, ${p.equipe_id || null},
          ${p.papel || 'colaborador'}, ${p.ativo ?? true}, ${p.telefone || ''}, ${p.versao ?? 0},
          ${p.vetores ? JSON.stringify(p.vetores) : null}, ${p.miniatura || ''}, ${p.versao_cadastro ?? 0},
          ${p.origem || null}, ${p.coerencia ?? null}, ${p.criado_em || null},
          ${p.modelo_id || null}, ${p.modelo_divergente ?? false}, ${p.modelo_desconhecido ?? false}
        )
        RETURNING *
      `;
      return linhaPessoa(linha);
    },

    // ATOMICO -- versao_cadastro na CLAUSULA do UPDATE, nunca numa leitura
    // anterior (e a janela que CADASTRO_DESATUALIZADO existe para fechar).
    async atualizarPessoaSeVersao(pessoaId, versaoEsperada, campos) {
      const { clausula, valores } = construirSet(campos || {}, COLUNAS_PESSOA, COLUNAS_JSONB_PESSOA, 3);
      const extra = clausula ? `, ${clausula}` : '';
      const [linha] = await sql.query(
        `UPDATE efrat_pessoa SET versao_cadastro = versao_cadastro + 1${extra}
          WHERE pessoa_id = $1 AND versao_cadastro = $2
          RETURNING *`,
        [pessoaId, versaoEsperada, ...valores]
      );
      if (linha) return { trocado: true, pessoa: linhaPessoa(linha) };
      const atual = await repo.lerPessoa(pessoaId);
      return { trocado: false, pessoa: atual };
    },

    // Escrita SEM invariante de versao (template biometrico) -- nao disputa
    // versao_cadastro, que e so de dados cadastrais.
    async atualizarPessoa(pessoaId, campos) {
      const { clausula, valores } = construirSet(campos, COLUNAS_PESSOA, COLUNAS_JSONB_PESSOA, 2);
      if (!clausula) return repo.lerPessoa(pessoaId);
      const linhas = await sql.query(
        `UPDATE efrat_pessoa SET ${clausula} WHERE pessoa_id = $1 RETURNING *`,
        [pessoaId, ...valores]
      );
      return linhaPessoa(linhas[0]) || null;
    },

    // ==========================================================================
    // EQUIPE
    // ==========================================================================

    async listarEquipes() {
      const linhas = await sql`SELECT * FROM efrat_equipe`;
      return linhas;
    },

    async lerEquipe(equipeId) {
      const [linha] = await sql`SELECT * FROM efrat_equipe WHERE equipe_id = ${equipeId}`;
      return linha || null;
    },

    // ATOMICO -- indice unico parcial em lower(nome) WHERE ativo.
    async inserirEquipeSeNomeLivre(equipe) {
      try {
        const [linha] = await sql`
          INSERT INTO efrat_equipe (equipe_id, nome, unidade, ativo)
          VALUES (${equipe.equipe_id}, ${equipe.nome}, ${equipe.unidade || null}, ${equipe.ativo ?? true})
          RETURNING *
        `;
        return { inserida: true, equipe: linha };
      } catch (erro) {
        if (erro?.code === '23505') {
          const [duplicada] = await sql`SELECT * FROM efrat_equipe WHERE lower(nome) = lower(${equipe.nome}) AND ativo`;
          return { inserida: false, equipe: duplicada || null };
        }
        throw erro;
      }
    },

    // Renomear disputa o MESMO indice -- deixa o banco decidir, nao um SELECT antes.
    async atualizarEquipe(equipeId, campos) {
      const { clausula, valores } = construirSet(campos, ['nome', 'unidade', 'ativo'], new Set(), 2);
      if (!clausula) {
        const atual = await repo.lerEquipe(equipeId);
        return { renomeada: !!atual, equipe: atual };
      }
      try {
        const linhas = await sql.query(
          `UPDATE efrat_equipe SET ${clausula} WHERE equipe_id = $1 RETURNING *`,
          [equipeId, ...valores]
        );
        if (!linhas[0]) return { renomeada: false, equipe: null };
        return { renomeada: true, equipe: linhas[0] };
      } catch (erro) {
        if (erro?.code === '23505') {
          const atual = await repo.lerEquipe(equipeId);
          return { renomeada: false, equipe: atual };
        }
        throw erro;
      }
    },

    // ==========================================================================
    // MARCACAO -- o indice unico mais importante da API.
    // ==========================================================================

    // ATOMICO -- ON CONFLICT (id_cliente) DO NOTHING RETURNING *.
    // NUNCA vire SELECT+INSERT: duas requisicoes com o mesmo id_cliente
    // passariam pelo SELECT juntas e gravariam duas vezes (a impossibilidade
    // nº2 que tirou o n8n do caminho).
    async inserirMarcacaoSeAusente(marcacao) {
      const m = marcacao;
      const [linha] = await sql`
        INSERT INTO efrat_marcacao (
          id_cliente, pessoa_id, marcado_em, tipo, veredito, origem, deriva_relogio_ms,
          requer_revisao, foto_auditoria, recebido_em, aparelho_estado_no_envio,
          aparelho_revogado_em, aparelho_apelido, aparelho_dispositivo_id, motivo_codigo
        ) VALUES (
          ${m.id_cliente}, ${m.pessoa_id}, ${m.marcado_em}, ${m.tipo || null}, ${m.veredito || null},
          ${m.origem || null}, ${m.deriva_relogio_ms ?? null}, ${m.requer_revisao ?? false},
          ${m.foto_auditoria || ''}, ${m.recebido_em || null}, ${m.aparelho_estado_no_envio || null},
          ${m.aparelho_revogado_em || null}, ${m.aparelho_apelido || null},
          ${m.aparelho_dispositivo_id || null}, ${m.motivo_codigo || null}
        )
        ON CONFLICT (id_cliente) DO NOTHING
        RETURNING *
      `;
      if (linha) return { inserida: true, marcacao: linhaMarcacao(linha) };
      const [existente] = await sql`SELECT * FROM efrat_marcacao WHERE id_cliente = ${m.id_cliente}`;
      return { inserida: false, marcacao: linhaMarcacao(existente) };
    },

    // Sonda de leitura -- SO para o ramo que nao persiste nada. Ver a doc do
    // metodo em nucleo/repositorio.js antes de usar em qualquer outro lugar.
    async marcacaoExiste(idCliente) {
      const [linha] = await sql`SELECT 1 FROM efrat_marcacao WHERE id_cliente = ${idCliente}`;
      return !!linha;
    },

    async lerMarcacao(idCliente) {
      const [linha] = await sql`SELECT * FROM efrat_marcacao WHERE id_cliente = ${idCliente}`;
      return linhaMarcacao(linha) || null;
    },

    async listarMarcacoes() {
      const linhas = await sql`SELECT * FROM efrat_marcacao`;
      return linhas.map(linhaMarcacao);
    },

    async atualizarMarcacao(idCliente, campos) {
      const { clausula, valores } = construirSet(campos, COLUNAS_MARCACAO, new Set(), 2);
      if (!clausula) return repo.lerMarcacao(idCliente);
      const linhas = await sql.query(
        `UPDATE efrat_marcacao SET ${clausula} WHERE id_cliente = $1 RETURNING *`,
        [idCliente, ...valores]
      );
      return linhaMarcacao(linhas[0]) || null;
    },

    // ==========================================================================
    // CONVITE DE FACE -- LOTE 2. trocarEstadoConvite so sai do throw com
    // revisao INTEIRA (a outra razao de a API existir: uso unico do link).
    // ==========================================================================
    async inserirConvite() { throw new NaoRevisado('inserirConvite'); },
    async lerConvite() { throw new NaoRevisado('lerConvite'); },
    async lerConvitePorTokenHash() { throw new NaoRevisado('lerConvitePorTokenHash'); },
    async listarConvites() { throw new NaoRevisado('listarConvites'); },
    async listarConvitesVivosDaPessoa() { throw new NaoRevisado('listarConvitesVivosDaPessoa'); },
    async trocarEstadoConvite() { throw new NaoRevisado('trocarEstadoConvite'); },
    async contarTentativaConvite() { throw new NaoRevisado('contarTentativaConvite'); },

    // ==========================================================================
    // TEMPLATE PENDENTE (recadastro) -- saiu do lote 2: rh/face/cadastrar
    // entrou na coluna do primeiro turno (Orquestrador, 2026-08-25, achado
    // do Designer -- sem cadastro de rosto pela camera do RH nao ha rosto
    // real pra reconhecer amanha). Sem invariante de corrida documentada na
    // interface (nao ha marca ATOMICO em nenhum dos tres) -- CRUD direto.
    //
    // DESVIO CONSCIENTE de memoria.js, registrado em vez de silencioso:
    // la, `inserirRecadastro` e um push() num array -- template_id repetido
    // (ele e deterministico, 't-'+pessoa_id) gera DUAS linhas, e quem le
    // depois assume que so existe uma pendente por pessoa. Aqui template_id
    // e PK com upsert (ON CONFLICT ... DO UPDATE): reenvio da mesma pessoa
    // SUBSTITUI a pendente anterior em vez de duplicar. Nao ha marca ATOMICO
    // pedindo o array, e duas linhas pro mesmo template_id e estado que
    // ninguem quer ter que explicar depois -- mas e uma escolha, nao uma
    // coincidencia, e fica registrada aqui pra quem for comparar com a
    // referencia em memoria achar isto antes de estranhar.
    // ==========================================================================
    async inserirRecadastro(recadastro) {
      const r = recadastro;
      const [linha] = await sql`
        INSERT INTO efrat_recadastro (
          template_id, pessoa_id, versao, coerencia, miniatura, vetores, origem,
          criado_em, convite_id, modelo_id, modelo_divergente, modelo_desconhecido
        ) VALUES (
          ${r.template_id}, ${r.pessoa_id}, ${r.versao ?? null}, ${r.coerencia ?? null},
          ${r.miniatura || ''}, ${r.vetores ? JSON.stringify(r.vetores) : null}, ${r.origem || null},
          ${r.criado_em || null}, ${r.convite_id || null}, ${r.modelo_id || null},
          ${r.modelo_divergente ?? false}, ${r.modelo_desconhecido ?? false}
        )
        ON CONFLICT (template_id) DO UPDATE SET
          pessoa_id = EXCLUDED.pessoa_id, versao = EXCLUDED.versao, coerencia = EXCLUDED.coerencia,
          miniatura = EXCLUDED.miniatura, vetores = EXCLUDED.vetores, origem = EXCLUDED.origem,
          criado_em = EXCLUDED.criado_em, convite_id = EXCLUDED.convite_id, modelo_id = EXCLUDED.modelo_id,
          modelo_divergente = EXCLUDED.modelo_divergente, modelo_desconhecido = EXCLUDED.modelo_desconhecido
        RETURNING *
      `;
      return linhaRecadastro(linha);
    },

    async listarRecadastros() {
      const linhas = await sql`SELECT * FROM efrat_recadastro`;
      return linhas.map(linhaRecadastro);
    },

    async removerRecadastro(templateId) {
      const linhas = await sql`DELETE FROM efrat_recadastro WHERE template_id = ${templateId} RETURNING template_id`;
      return linhas.length;
    },

    // ==========================================================================
    // CORRECAO / SESSAO DE GESTOR -- continuam no lote 2: gestor/equipe-hoje
    // e o passo 4 do gestor ficaram fora do teste de amanha (Orquestrador).
    // ==========================================================================
    async inserirCorrecao() { throw new NaoRevisado('inserirCorrecao'); },
    async criarSessaoGestor() { throw new NaoRevisado('criarSessaoGestor'); },
    async lerSessaoGestor() { throw new NaoRevisado('lerSessaoGestor'); },

    // ==========================================================================
    // IDEMPOTENCIA
    // ==========================================================================
    async lerIdempotencia(chave) {
      const [linha] = await sql`SELECT hash, status, resposta FROM efrat_idempotencia WHERE chave = ${chave}`;
      return linha || null;
    },

    async gravarIdempotencia(chave, registro) {
      await sql`
        INSERT INTO efrat_idempotencia (chave, hash, status, resposta)
        VALUES (${chave}, ${registro.hash}, ${registro.status}, ${JSON.stringify(registro.resposta)})
        ON CONFLICT (chave) DO NOTHING
      `;
    },

    // ==========================================================================
    // AUDITORIA
    // ==========================================================================
    async registrarAuditoriaIdentificacao() { throw new NaoRevisado('registrarAuditoriaIdentificacao'); },

    // T-81C721 (§2.1e): toda tentativa de aprovar, certa ou errada. Nunca
    // grava o codigo tentado -- so o resultado.
    async registrarAuditoriaAprovacao(evento) {
      await sql`
        INSERT INTO efrat_auditoria_aprovacao (usuario_rh, instante, pendente_id, resultado, request_id)
        VALUES (${evento.usuario_rh || null}, ${evento.instante}, ${evento.pendente_id || null},
                ${evento.resultado || null}, ${evento.request_id || null})
      `;
    },

    async registrarDecisaoRh() { throw new NaoRevisado('registrarDecisaoRh'); },

    // ==========================================================================
    // MODELO BIOMETRICO OBSERVADO (§4.7)
    // ==========================================================================
    async lerReferenciaModeloApp() {
      const [linha] = await sql`SELECT valor FROM efrat_config WHERE chave = 'referencia_modelo_app'`;
      return linha?.valor ?? null;
    },

    async definirReferenciaModeloApp(modeloId) {
      await sql`
        INSERT INTO efrat_config (chave, valor) VALUES ('referencia_modelo_app', ${modeloId})
        ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor
      `;
    },

    async modeloJaObservado(modeloId) {
      const [linha] = await sql`SELECT 1 FROM efrat_modelo WHERE modelo_id = ${modeloId}`;
      return !!linha;
    },

    // Soma uma observacao -- primeira/ultima aparicao e a UNIAO de origens
    // (memoria.js acumula num Set, nunca substitui).
    async registrarModeloObservado(modeloId, origemObservada, agoraIso) {
      await sql`
        INSERT INTO efrat_modelo (modelo_id, primeira_aparicao_em, ultima_aparicao_em)
        VALUES (${modeloId}, ${agoraIso}, ${agoraIso})
        ON CONFLICT (modelo_id) DO UPDATE SET ultima_aparicao_em = EXCLUDED.ultima_aparicao_em
      `;
      await sql`
        INSERT INTO efrat_modelo_origem (modelo_id, origem) VALUES (${modeloId}, ${origemObservada})
        ON CONFLICT (modelo_id, origem) DO NOTHING
      `;
    },

    // ==========================================================================
    // LIMITES DE VOLUME E DE TENTATIVA
    // ==========================================================================

    // ATOMICO -- janela fixa. UPSERT com UPDATE condicionado a janela ainda
    // valida; janela vencida reseta na MESMA sentenca.
    async contarNaJanela(balde, chave, janelaMs, agoraMs) {
      const [linha] = await sql`
        INSERT INTO efrat_limite_contagem (balde, chave, inicio_ms, total)
        VALUES (${balde}, ${chave}, ${agoraMs}, 1)
        ON CONFLICT (balde, chave) DO UPDATE SET
          inicio_ms = CASE WHEN ${agoraMs} - efrat_limite_contagem.inicio_ms >= ${janelaMs}
                           THEN ${agoraMs} ELSE efrat_limite_contagem.inicio_ms END,
          total = CASE WHEN ${agoraMs} - efrat_limite_contagem.inicio_ms >= ${janelaMs}
                       THEN 1 ELSE efrat_limite_contagem.total + 1 END
        RETURNING inicio_ms, total
      `;
      return { total: paraNumero(linha.total), inicioMs: paraMs(linha.inicio_ms) };
    },

    async registrarTentativaErrada(balde, chave, agoraMs) {
      await sql`INSERT INTO efrat_limite_tentativa (balde, chave, instante_ms) VALUES (${balde}, ${chave}, ${agoraMs})`;
      // Poda o que ja saiu de qualquer janela plausivel (24h), mesmo espirito
      // de memoria.js: a lista nao cresce sem limite.
      await sql`DELETE FROM efrat_limite_tentativa WHERE balde = ${balde} AND chave = ${chave} AND instante_ms < ${agoraMs - 24 * 3600_000}`;
    },

    async tentativasNaJanela(balde, chave, janelaMs, agoraMs) {
      const linhas = await sql`
        SELECT instante_ms FROM efrat_limite_tentativa
         WHERE balde = ${balde} AND chave = ${chave} AND instante_ms > ${agoraMs - janelaMs}
         ORDER BY instante_ms ASC
      `;
      return linhas.map(l => paraMs(l.instante_ms));
    },

    // ==========================================================================
    // USUARIO DE RH
    //
    // So leitura, de proposito -- decisao do Orquestrador (2026-08-25), nao
    // lacuna: nenhuma das 8 rotas do primeiro turno CRIA usuario de RH, e um
    // inserirUsuarioRh aqui seria capacidade privilegiada de escrita que a
    // producao carrega pra sempre sem nenhum caminho de produto exercitando
    // ela. A linha de efrat_usuario_rh do teste nasce por SQL direto na
    // semente do DevOps, excecao documentada. Gestao de usuario de RH como
    // produto (rota, auth, auditoria de quem criou quem) e T-641E39. Ver o
    // mesmo comentario em nucleo/repositorio.js -- se esta ausencia voltar
    // como "necessidade tecnica" daqui a um mes, o motivo ja esta escrito
    // nos dois lugares.
    //
    // P0 (achado do QA, 2026-08-25): a doc do metodo em nucleo/repositorio.js
    // nomeia cinco campos e deixa o sexto -- "material de conferencia da
    // chave", o unico que decide o login -- como frase, nao campo. memoria.js
    // devolve `chave`; nucleo/http.js:81 compara `usuario.chave`. A coluna
    // aqui chama chave_hash (nome melhor: e hash PBKDF2, nunca a chave em
    // claro) mas o ALIAS na leitura tem de casar com o que http.js consome
    // hoje -- e memoria.js, que ja e verde, nao vai mudar por minha causa.
    // Opcao (a) do QA: risco zero pro que ja esta provado. Falta cartao
    // pedindo ao Arquiteto pra NOMEAR este campo na interface (opcao c) --
    // sem isso, o proximo adaptador escolhe um terceiro nome.
    // ==========================================================================
    async lerUsuarioRh(usuario) {
      const [linha] = await sql`
        SELECT usuario, nome, sal, iteracoes, chave_hash AS chave, ativo
          FROM efrat_usuario_rh WHERE usuario = ${usuario}
      `;
      return linha || null;
    }
  };

  return verificarRepositorio(repo);
}

// ============================================================================
// Helpers de linha e de UPDATE dinamico
// ============================================================================

const COLUNAS_PESSOA = [
  'nome', 'matricula', 'equipe_id', 'papel', 'ativo', 'telefone', 'versao', 'vetores',
  'miniatura', 'inativado_em', 'inativado_por', 'motivo_inativacao', 'telefone_autorizado_por',
  'telefone_autorizado_em', 'telefone_autorizacao_motivo', 'atualizado_por', 'atualizado_em',
  'origem', 'coerencia', 'criado_em', 'modelo_id', 'modelo_divergente', 'modelo_desconhecido'
];
const COLUNAS_JSONB_PESSOA = new Set(['vetores']);

const COLUNAS_MARCACAO = [
  'pessoa_id', 'marcado_em', 'tipo', 'veredito', 'origem', 'deriva_relogio_ms', 'requer_revisao',
  'foto_auditoria', 'recebido_em', 'aparelho_estado_no_envio', 'aparelho_revogado_em',
  'aparelho_apelido', 'aparelho_dispositivo_id', 'motivo_codigo'
];

function linhaPessoa(r) {
  if (r == null) return null;
  return Object.assign({}, r, {
    inativado_em: paraIso(r.inativado_em),
    telefone_autorizado_em: paraIso(r.telefone_autorizado_em),
    atualizado_em: paraIso(r.atualizado_em),
    criado_em: paraIso(r.criado_em),
    coerencia: r.coerencia == null ? null : Number(r.coerencia)
  });
}

function linhaMarcacao(r) {
  if (r == null) return null;
  return Object.assign({}, r, {
    marcado_em: paraIso(r.marcado_em),
    recebido_em: paraIso(r.recebido_em),
    aparelho_revogado_em: paraIso(r.aparelho_revogado_em)
  });
}

function linhaRecadastro(r) {
  if (r == null) return null;
  return Object.assign({}, r, {
    criado_em: paraIso(r.criado_em),
    coerencia: r.coerencia == null ? null : Number(r.coerencia)
  });
}

/**
 * Monta `col = $n, col2 = $n+1, ...` a partir de `campos`, restrito a
 * `permitidas` (nomes ja SAO os nomes de coluna -- ver a nota de estilo no
 * topo do arquivo). Falha ALTO em campo desconhecido -- em vez de gravar
 * silenciosamente em coluna nenhuma, ou pior, aceitar chave que vira SQL.
 * `offsetParam` e o indice do PRIMEIRO parametro dinamico (os anteriores ja
 * estao ocupados por WHERE/valores fixos da sentenca que chama).
 */
function construirSet(campos, permitidas, colunasJsonb, offsetParam) {
  const entradas = Object.entries(campos || {});
  if (!entradas.length) return { clausula: '', valores: [] };
  const partes = [];
  const valores = [];
  let i = offsetParam;
  for (const [k, v] of entradas) {
    if (!permitidas.includes(k)) throw new Error(`campo desconhecido para esta tabela: "${k}"`);
    const alvo = colunasJsonb.has(k) ? `"${k}" = $${i}::jsonb` : `"${k}" = $${i}`;
    partes.push(alvo);
    valores.push(colunasJsonb.has(k) && v != null ? JSON.stringify(v) : v);
    i++;
  }
  return { clausula: partes.join(', '), valores };
}
