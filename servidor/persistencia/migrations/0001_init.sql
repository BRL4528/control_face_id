-- API-3 · esquema inicial, contra nucleo/repositorio.js e nucleo/memoria.js
-- (a implementacao de referencia). Nomes de coluna seguem literalmente os
-- nomes de campo que memoria.js/servidor-falso.js usam -- onde os dois
-- convencionam nomes diferentes (ex.: retidasPosRevogacao em camelCase no
-- meio de colunas snake_case), a coluna mantem o nome literal da referencia:
-- fidelidade de comportamento importa mais que consistencia de estilo aqui.
--
-- Instantes que atravessam a interface como ISO 8601 viram timestamptz.
-- Instantes que a interface documenta como number (agoraMs) e que nunca
-- saem do dominio de sessao-gestor/limites ficam bigint (epoch ms) -- evita
-- conversao ida-e-volta onde a comparacao e sempre numerica mesmo.

CREATE TABLE efrat_dispositivo (
  dispositivo_id            text PRIMARY KEY,
  credencial_hash           text NOT NULL,
  estado                    text NOT NULL CHECK (estado IN ('pendente','ativo','negado','revogado')),
  codigo_curto              text,
  apelido                   text,
  ua                        text,
  geo                       jsonb,
  tentativas                integer NOT NULL DEFAULT 0,
  local_id                  text,
  equipes_ids               text[] NOT NULL DEFAULT '{}',
  configuracao_versao       integer NOT NULL DEFAULT 0,
  aprovado_por              text,
  aprovado_em               timestamptz,
  criado_em                 timestamptz NOT NULL,
  ultimo_uso                timestamptz,
  pendente_id               text UNIQUE,
  ip_hash                   text,
  primeiro_pedido_em        timestamptz,
  ultimo_pedido_em          timestamptz,
  unidade                   text,
  recusado_por              text,
  recusado_em               timestamptz,
  revogado_por              text,
  revogado_em               timestamptz,
  motivo_decisao            text,
  "retidasPosRevogacao"     integer NOT NULL DEFAULT 0
);

-- A unicidade do codigo curto vale so entre PENDENTES VIVOS, nunca no
-- historico: o codigo expira (24h) e e reemitido, e aprovar/recusar/revogar
-- tiram a linha de 'pendente'. Indice global faria reemissao do MESMO
-- aparelho colidir com o proprio codigo antigo, e um aparelho novo falhar
-- por um codigo que outro aparelho teve ha semanas. Confirmado lendo
-- nucleo/memoria.js: estado.codigosPendentes so guarda a linha enquanto
-- ela esta pendente.
CREATE UNIQUE INDEX efrat_dispositivo_codigo_curto_pendente
  ON efrat_dispositivo (codigo_curto) WHERE estado = 'pendente';

CREATE TABLE efrat_pessoa (
  pessoa_id                     text PRIMARY KEY,
  nome                          text NOT NULL,
  matricula                     text,
  equipe_id                     text,
  papel                         text NOT NULL DEFAULT 'colaborador' CHECK (papel IN ('colaborador','gestor')),
  ativo                         boolean NOT NULL DEFAULT true,
  telefone                      text NOT NULL DEFAULT '',
  versao                        integer NOT NULL DEFAULT 0,
  vetores                       jsonb,
  miniatura                     text NOT NULL DEFAULT '',
  versao_cadastro               integer NOT NULL DEFAULT 0,
  inativado_em                  timestamptz,
  inativado_por                 text,
  motivo_inativacao             text,
  telefone_autorizado_por       text,
  telefone_autorizado_em        timestamptz,
  telefone_autorizacao_motivo   text,
  atualizado_por                text,
  atualizado_em                 timestamptz,
  -- procedencia do template ATIVO desta pessoa (§4.7); nao e efrat_template
  -- em separado -- e o que memoria.js grava direto na linha da pessoa.
  origem                        text,
  coerencia                     double precision,
  criado_em                     timestamptz,
  modelo_id                     text,
  modelo_divergente             boolean NOT NULL DEFAULT false,
  modelo_desconhecido           boolean NOT NULL DEFAULT false
);

CREATE TABLE efrat_equipe (
  equipe_id   text PRIMARY KEY,
  nome        text NOT NULL,
  unidade     text,
  ativo       boolean NOT NULL DEFAULT true
);

-- Nome unico so entre equipes ATIVAS (§2.3): inativar libera o nome.
CREATE UNIQUE INDEX efrat_equipe_nome_ativa ON efrat_equipe (lower(nome)) WHERE ativo;

CREATE TABLE efrat_marcacao (
  id_cliente                  text PRIMARY KEY,
  pessoa_id                   text NOT NULL,
  marcado_em                  timestamptz NOT NULL,
  tipo                        text,
  veredito                    text,
  origem                      text,
  deriva_relogio_ms           integer,
  requer_revisao              boolean NOT NULL DEFAULT false,
  foto_auditoria              text NOT NULL DEFAULT '',
  recebido_em                 timestamptz,
  aparelho_estado_no_envio    text,
  aparelho_revogado_em        timestamptz,
  aparelho_apelido            text,
  aparelho_dispositivo_id     text,
  motivo_codigo               text
);

-- LOTE 2 (revisao ainda pendente no adaptador -- ver NaoRevisado em
-- postgres.js). Schema entra aqui porque e so DDL: ninguem le antes do
-- metodo sair do throw.

CREATE TABLE efrat_face_convite (
  convite_id       text PRIMARY KEY,
  pessoa_id        text NOT NULL,
  token_hash       text NOT NULL UNIQUE,
  estado           text NOT NULL CHECK (estado IN ('emitido','aberto','consumido','expirado','revogado','substituido','bloqueado')),
  canal            text,
  criado_por       text,
  criado_em        timestamptz NOT NULL,
  expira_em        timestamptz NOT NULL,
  aberto_em        timestamptz,
  tentativas       integer NOT NULL DEFAULT 0,
  consumido_em     timestamptz,
  revogado_por     text,
  revogado_em      timestamptz,
  substituido_por  text
);

CREATE TABLE efrat_recadastro (
  template_id           text PRIMARY KEY,
  pessoa_id             text NOT NULL,
  versao                integer,
  coerencia             double precision,
  miniatura             text,
  vetores               jsonb,
  origem                text CHECK (origem IN ('rh_camera','rh_upload','link','gestor')),
  criado_em             timestamptz,
  convite_id            text,
  modelo_id             text,
  modelo_divergente     boolean NOT NULL DEFAULT false,
  modelo_desconhecido   boolean NOT NULL DEFAULT false
);

CREATE TABLE efrat_correcao (
  correcao_id     text PRIMARY KEY,
  estado          text NOT NULL DEFAULT 'pendente_rh',
  pessoa_id       text NOT NULL,
  marcacao_id     text,
  valor_anterior  jsonb,
  valor_proposto  jsonb,
  motivo          text,
  autor_id        text,
  sessao_evento   text,
  criado_em       timestamptz
);

CREATE TABLE efrat_sessao_gestor (
  token             text PRIMARY KEY,
  gestor_id         text NOT NULL,
  dispositivo_id    text NOT NULL,
  equipes_ids       text[] NOT NULL DEFAULT '{}',
  criado_em         bigint NOT NULL,
  ultima_atividade  bigint NOT NULL,
  expira_absoluto   bigint NOT NULL,
  evento            text
);

-- Fim do lote 2. Dai em diante e infraestrutura transversal (idempotencia,
-- auditoria, limites, modelo, usuario de RH) -- todos de primeiro lote.

CREATE TABLE efrat_idempotencia (
  chave     text PRIMARY KEY,
  hash      text NOT NULL,
  status    integer NOT NULL,
  resposta  jsonb NOT NULL
);

CREATE TABLE efrat_auditoria_identificacao (
  id             bigserial PRIMARY KEY,
  dispositivo_id text,
  instante       timestamptz NOT NULL,
  resultado      text,
  pessoa_id      text,
  request_id     text
);

CREATE TABLE efrat_auditoria_aprovacao (
  id           bigserial PRIMARY KEY,
  usuario_rh   text,
  instante     timestamptz NOT NULL,
  pendente_id  text,
  resultado    text,
  request_id   text
);

-- T-81C721 (§2.1e): TODA tentativa, certa ou errada. NUNCA guarda o codigo
-- tentado -- so o resultado.

CREATE TABLE efrat_decisao_rh (
  id         bigserial PRIMARY KEY,
  tipo       text,
  alvo_id    text,
  acao       text,
  criado_em  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE efrat_modelo (
  modelo_id             text PRIMARY KEY,
  primeira_aparicao_em  timestamptz NOT NULL,
  ultima_aparicao_em    timestamptz NOT NULL
);

-- origens observadas por modelo_id: memoria.js ACUMULA num Set, nunca
-- substitui -- tabela filha em vez de coluna singular preserva isso.
CREATE TABLE efrat_modelo_origem (
  modelo_id  text NOT NULL REFERENCES efrat_modelo (modelo_id) ON DELETE CASCADE,
  origem     text NOT NULL CHECK (origem IN ('app','publica')),
  PRIMARY KEY (modelo_id, origem)
);

-- chave-valor generico. Unico uso hoje: referencia_modelo_app (§4.7) -- o
-- modelo_id mais recente visto no caminho do app, um valor GLOBAL, nao uma
-- coluna de efrat_modelo.
CREATE TABLE efrat_config (
  chave  text PRIMARY KEY,
  valor  text
);

-- limites de volume: contador de JANELA FIXA (contarNaJanela). Cadastro,
-- identificacao e volume anonimo usam este formato -- so total + inicio da
-- janela corrente importam, nunca a lista de instantes.
CREATE TABLE efrat_limite_contagem (
  balde      text NOT NULL,
  chave      text NOT NULL,
  inicio_ms  bigint NOT NULL,
  total      integer NOT NULL,
  PRIMARY KEY (balde, chave)
);

-- limite de tentativa ERRADA de aprovacao (§1.3 LIMITE_APROVACAO): precisa
-- da LISTA de instantes, nao so da contagem, porque o Retry-After sai do
-- mais antigo ainda dentro da janela. Formato incompativel com a tabela
-- acima -- por isso as duas existem, uma por metodo do contrato.
CREATE TABLE efrat_limite_tentativa (
  id           bigserial PRIMARY KEY,
  balde        text NOT NULL,
  chave        text NOT NULL,
  instante_ms  bigint NOT NULL
);

CREATE INDEX efrat_limite_tentativa_busca ON efrat_limite_tentativa (balde, chave, instante_ms);

CREATE TABLE efrat_usuario_rh (
  usuario     text PRIMARY KEY,
  nome        text,
  sal         text NOT NULL,
  iteracoes   integer NOT NULL,
  -- Nunca a chave em claro -- "material de conferencia" (doc do metodo
  -- lerUsuarioRh em nucleo/repositorio.js) e o hash derivado por
  -- PBKDF2(senha, sal, iteracoes), conferido pelo adaptador HTTP.
  chave_hash  text NOT NULL,
  ativo       boolean NOT NULL DEFAULT true
);
