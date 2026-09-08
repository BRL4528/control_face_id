-- Control Face ID — esquema Postgres (Neon).
--
-- Produto multi-tenant de ponto por reconhecimento facial. Substitui as Data
-- Tables do n8n do piloto. Decisões estruturais (ver docs/arquitetura-v4.md):
--
--   • Cada colaborador bate ponto no PRÓPRIO celular — não há mais aparelho do
--     gestor operando a fila. O celular é pareado ao colaborador uma vez.
--   • Face é confirmação 1:1 (é você?), nunca identificação 1:N (quem é?). O
--     template biométrico é o do próprio colaborador logado.
--   • O RH aloca colaborador→equipe DIARIAMENTE e desenha a cerca virtual
--     (lat/lng/raio) onde o ponto pode ser batido. É a tabela alocacao.
--   • Imutabilidade é estrutural: marcacao nunca é alterada (trigger barra
--     UPDATE/DELETE); correção é sempre linha nova. É o que o REP-P exige e o
--     que a Data Table do n8n não garantia.
--
-- Convenções: ids são text (uuid como string, casa com crypto.randomUUID do
-- cliente e evita extensão). timestamps em timestamptz (UTC). Todo dado de
-- negócio pende de empresa_id — o tenant.

-- ═══════════════════════════════════════════════════════ tenant

CREATE TABLE IF NOT EXISTS empresa (
  id           text PRIMARY KEY,
  nome         text NOT NULL,
  criada_em    timestamptz NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════ usuários do RH

-- Login do painel administrativo. Senha nunca trafega nem é guardada: o cliente
-- deriva PBKDF2-SHA256 e envia só a chave; guardamos o hash bcrypt dessa chave.
CREATE TABLE IF NOT EXISTS usuario_rh (
  id           text PRIMARY KEY,
  empresa_id   text NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  usuario      text NOT NULL,
  nome         text NOT NULL,
  sal          text NOT NULL,          -- sal do PBKDF2 do cliente (público)
  iteracoes    integer NOT NULL DEFAULT 150000,
  chave_hash   text NOT NULL,          -- bcrypt(chave derivada) — nunca a senha
  ativo        boolean NOT NULL DEFAULT true,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, usuario)
);
-- O login não pede empresa (só usuário + senha), então o usuário precisa ser
-- único no SISTEMA, não só na empresa — senão dois RHs "rh" de empresas
-- diferentes colidem e o LIMIT 1 do login escolhe um deles às cegas.
CREATE UNIQUE INDEX IF NOT EXISTS ux_usuario_rh_usuario ON usuario_rh (lower(usuario));

-- ═══════════════════════════════════════════════════════ equipes

-- A equipe é o agrupamento estável (setor, turma, obra). A CERCA fica na
-- alocação diária, não aqui: uma mesma equipe pode operar em locais diferentes
-- em dias diferentes, e é o RH que define o de hoje.
CREATE TABLE IF NOT EXISTS equipe (
  id           text PRIMARY KEY,
  empresa_id   text NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  nome         text NOT NULL,
  ativo        boolean NOT NULL DEFAULT true,
  criada_em    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_equipe_empresa ON equipe (empresa_id);

-- ═══════════════════════════════════════════════════════ colaboradores

CREATE TABLE IF NOT EXISTS colaborador (
  id            text PRIMARY KEY,
  empresa_id    text NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  nome          text NOT NULL,
  matricula     text NOT NULL,          -- usada no pareamento inicial do celular
  papel         text NOT NULL DEFAULT 'colaborador',  -- colaborador | gestor
  equipe_padrao text REFERENCES equipe(id),           -- equipe default (o RH pode realocar por dia)
  ativo         boolean NOT NULL DEFAULT true,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, matricula)
);
CREATE INDEX IF NOT EXISTS ix_colab_empresa ON colaborador (empresa_id);

-- ═══════════════════════════════════════════════════════ biometria (1:1)

-- Template facial versionado. Guardamos o vetor de 128 dims (o embedding), não
-- a foto — o descritor não reconstrói o rosto. Vários vetores por versão dão
-- robustez a pose/luz. Só um template fica 'ativo' por colaborador; recadastro
-- entra 'pendente' e o RH aprova (aí o anterior vira 'substituido').
CREATE TABLE IF NOT EXISTS template_facial (
  id            text PRIMARY KEY,
  colaborador_id text NOT NULL REFERENCES colaborador(id) ON DELETE CASCADE,
  versao        integer NOT NULL,
  vetores       jsonb NOT NULL,          -- [[128 floats], ...]
  miniatura_url text,                     -- Vercel Blob; referência p/ o RH conferir
  coerencia     real,                     -- distância máx entre as capturas do cadastro
  estado        text NOT NULL DEFAULT 'ativo',  -- ativo | pendente | substituido | reprovado
  origem        text NOT NULL DEFAULT 'rh',     -- rh | autocadastro
  criado_em     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (colaborador_id, versao)
);
CREATE INDEX IF NOT EXISTS ix_template_colab ON template_facial (colaborador_id, estado);

-- ═══════════════════════════════════════════════════════ pareamento do celular

-- Vincula um dispositivo (celular pessoal) a um colaborador. Nasce no
-- pareamento inicial: o colaborador informa a matrícula UMA vez e captura a
-- face; daí em diante o app abre direto na câmera. A credencial de 256 bits
-- fica só no IndexedDB do celular; aqui guardamos só o hash, como bearer.
CREATE TABLE IF NOT EXISTS dispositivo (
  id             text PRIMARY KEY,       -- uuid gerado no celular
  colaborador_id text NOT NULL REFERENCES colaborador(id) ON DELETE CASCADE,
  credencial_hash text NOT NULL,         -- sha256(credencial) base64url
  apelido        text,
  ua             text,
  ativo          boolean NOT NULL DEFAULT true,
  pareado_em     timestamptz NOT NULL DEFAULT now(),
  visto_em       timestamptz
);
CREATE INDEX IF NOT EXISTS ix_disp_colab ON dispositivo (colaborador_id);

-- ═══════════════════════════════════════════════════════ locais frequentes

-- O RH aloca gente todo dia; digitar coordenadas toda vez seria inviável. Salva
-- os pontos recorrentes (Obra Norte, Sede) uma vez e no dia só escolhe da lista
-- e ajusta o pin. A alocação copia o centro/raio daqui — desacoplada, para
-- renomear/mover um local não reescrever o histórico de alocações passadas.
CREATE TABLE IF NOT EXISTS local (
  id           text PRIMARY KEY,
  empresa_id   text NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  nome         text NOT NULL,
  lat          double precision NOT NULL,
  lng          double precision NOT NULL,
  raio_m       integer NOT NULL DEFAULT 200,
  ativo        boolean NOT NULL DEFAULT true,
  criado_em    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_local_empresa ON local (empresa_id);

-- ═══════════════════════════════════════════════════════ alocação diária + cerca

-- O coração da operação diária do RH. Para um dia e uma equipe, define:
--   • quem está alocado (colaborador_id)
--   • ONDE — a cerca virtual: centro (lat/lng) e raio em metros
-- O ponto só é aceito se o GPS do celular cair dentro dessa cerca. Como o RH
-- realoca gente todo dia, a chave é (empresa, dia, colaborador): cada pessoa
-- tem uma alocação por dia, e mudá-la é um UPDATE simples.
CREATE TABLE IF NOT EXISTS alocacao (
  id             text PRIMARY KEY,
  empresa_id     text NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  dia            date NOT NULL,
  colaborador_id text NOT NULL REFERENCES colaborador(id) ON DELETE CASCADE,
  equipe_id      text NOT NULL REFERENCES equipe(id),
  cerca_lat      double precision NOT NULL,
  cerca_lng      double precision NOT NULL,
  cerca_raio_m   integer NOT NULL DEFAULT 200,
  criada_em      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, dia, colaborador_id)
);
CREATE INDEX IF NOT EXISTS ix_aloc_dia ON alocacao (empresa_id, dia);

-- ═══════════════════════════════════════════════════════ marcações (imutável)

-- Livro-razão do ponto. NUNCA alterado após inserido (ver trigger abaixo).
-- id_cliente é gerado no celular e é UNIQUE — é a garantia de deduplicação que
-- a Data Table do n8n não tinha: reenvio após timeout não vira ponto dobrado.
CREATE TABLE IF NOT EXISTS marcacao (
  id_cliente     text PRIMARY KEY,       -- uuid do celular; dedup por reenvio
  empresa_id     text NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  colaborador_id text NOT NULL REFERENCES colaborador(id),
  equipe_id      text,
  tipo           text NOT NULL,          -- entrada | saida
  origem         text NOT NULL DEFAULT 'biometria',  -- biometria | manual
  veredito       text NOT NULL,          -- aceito | revisar
  score          real,                   -- distância 1:1 (menor = melhor)
  liveness_ok    boolean,                -- passou no desafio de prova de vida?
  motivo         text,
  marcado_em     timestamptz NOT NULL,
  marcado_dia    date NOT NULL,
  deriva_ms      integer NOT NULL DEFAULT 0,
  lat            double precision,
  lng            double precision,
  precisao_m     real,
  dentro_cerca   boolean,                -- GPS caiu dentro da cerca da alocação?
  distancia_cerca_m integer,             -- a que distância do centro (auditoria)
  foto_url       text,                   -- Blob; só quando vai p/ revisão
  requer_revisao boolean NOT NULL DEFAULT false,
  criado_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_marc_empresa_dia ON marcacao (empresa_id, marcado_dia);
CREATE INDEX IF NOT EXISTS ix_marc_colab ON marcacao (colaborador_id, marcado_dia);
CREATE INDEX IF NOT EXISTS ix_marc_revisao ON marcacao (empresa_id, requer_revisao) WHERE requer_revisao;

-- Imutabilidade estrutural: o livro de ponto não se reescreve. Correção é
-- lançamento novo (tabela correcao). Isto é exigência de REP-P, não zelo.
CREATE OR REPLACE FUNCTION marcacao_imutavel() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'marcacao é imutável: correção deve virar lançamento novo';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_marcacao_imutavel ON marcacao;
CREATE TRIGGER trg_marcacao_imutavel
  BEFORE UPDATE OR DELETE ON marcacao
  FOR EACH ROW EXECUTE FUNCTION marcacao_imutavel();

-- ═══════════════════════════════════════════════════════ correções do RH

-- Toda decisão do RH sobre uma marcação em revisão vira uma linha aqui. O
-- estado atual de uma marcação é (marcacao + a última correção que a referencia).
CREATE TABLE IF NOT EXISTS correcao (
  id             text PRIMARY KEY,
  empresa_id     text NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  alvo_tipo      text NOT NULL,          -- marcacao | template
  alvo_id        text NOT NULL,          -- id_cliente da marcação ou id do template
  acao           text NOT NULL,          -- aprovar | rejeitar | lancar
  motivo         text,
  usuario_rh_id  text REFERENCES usuario_rh(id),
  criada_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_correcao_alvo ON correcao (alvo_tipo, alvo_id);
CREATE INDEX IF NOT EXISTS ix_correcao_empresa ON correcao (empresa_id, criada_em DESC);

-- ═══════════════════════════════════════════════════════ jornadas (turnos)

-- Turno de trabalho: entrada, saída e tolerância. A equipe aponta para uma
-- jornada (equipe.jornada_id); sem jornada, cai no default da empresa (config).
-- A hora de entrada da jornada é o que a exceção "sem entrada" usa como limite.
CREATE TABLE IF NOT EXISTS jornada (
  id             text PRIMARY KEY,
  empresa_id     text NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  nome           text NOT NULL,
  entrada        time NOT NULL DEFAULT '07:00',
  saida          time NOT NULL DEFAULT '17:00',
  tolerancia_min integer NOT NULL DEFAULT 10,
  ativa          boolean NOT NULL DEFAULT true,
  criada_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_jornada_empresa ON jornada (empresa_id);

-- A equipe ganha jornada e supervisor (ambos opcionais). Colunas aditivas para
-- não reescrever o histórico; equipe antiga continua válida com NULL.
ALTER TABLE equipe ADD COLUMN IF NOT EXISTS jornada_id text REFERENCES jornada(id);
ALTER TABLE equipe ADD COLUMN IF NOT EXISTS supervisor_id text REFERENCES colaborador(id);

-- ═══════════════════════════════════════════════════════ configurações + auth

-- Parâmetros por empresa (anti-fraude, alarme manual, jornada padrão). Uma linha
-- por empresa; o cliente mescla sobre os defaults de js/config.js (EFRAT_CFG).
CREATE TABLE IF NOT EXISTS config_empresa (
  empresa_id     text PRIMARY KEY REFERENCES empresa(id) ON DELETE CASCADE,
  dados          jsonb NOT NULL DEFAULT '{}',
  atualizada_em  timestamptz NOT NULL DEFAULT now()
);

-- Fuso da empresa (afeta "hoje" e o carimbo). Default no fuso do piloto.
ALTER TABLE empresa ADD COLUMN IF NOT EXISTS fuso text NOT NULL DEFAULT 'America/Campo_Grande';

-- Senha temporária: usuário criado pelo RH nasce obrigado a trocar no 1º acesso.
ALTER TABLE usuario_rh ADD COLUMN IF NOT EXISTS trocar_senha boolean NOT NULL DEFAULT false;

-- ═══════════════════════════════════════════════════════ planejamento recorrente

-- Alocar cada equipe TODO dia à mão é inviável. O RH cria um PLANO recorrente
-- (equipe → local/cerca, dias da semana, vigência) e o sistema MATERIALIZA esse
-- plano em linhas `alocacao` reais para os dias úteis. Assim o app do colaborador
-- (que lê `alocacao` por dia ao bater ponto) não muda em nada.
CREATE TABLE IF NOT EXISTS plano_alocacao (
  id             text PRIMARY KEY,
  empresa_id     text NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  equipe_id      text NOT NULL REFERENCES equipe(id),
  colaboradores  text[] NOT NULL DEFAULT '{}',           -- ids dos colaboradores do plano
  cerca_lat      double precision NOT NULL,
  cerca_lng      double precision NOT NULL,
  cerca_raio_m   integer NOT NULL DEFAULT 200,
  dias_semana    int[] NOT NULL DEFAULT '{1,2,3,4,5}',    -- ISO: 1=seg … 7=dom
  vigencia_inicio date NOT NULL,
  vigencia_fim    date,                                    -- NULL = indefinido (materializa até o horizonte)
  ativo          boolean NOT NULL DEFAULT true,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_plano_empresa ON plano_alocacao (empresa_id, ativo);
-- nome: rótulo livre do RH para o plano — em geral o PROJETO/obra em que a equipe
-- está alocada ("Obra Norte", "Manutenção Sede"). NULL nos planos antigos: a tela
-- cai no nome da equipe.
ALTER TABLE plano_alocacao ADD COLUMN IF NOT EXISTS nome text;

-- origem: 'plano' = linha gerada pela materialização (pode ser recriada);
--         'manual' = ajuste pontual do RH (SAGRADO — a re-materialização não sobrescreve).
-- plano_id aponta o plano que gerou a linha (NULL em alocações puramente manuais).
ALTER TABLE alocacao ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'manual';
ALTER TABLE alocacao ADD COLUMN IF NOT EXISTS plano_id text;
CREATE INDEX IF NOT EXISTS ix_aloc_plano ON alocacao (plano_id) WHERE plano_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════ primeiro acesso sem barreira
--
-- O RH manda UM link por empresa (/e/<link_token>). Quem abre já está "na
-- empresa" e bate ponto sem digitar nada: o aparelho nasce PENDENTE (sem
-- colaborador), as marcações nascem sem colaborador e o RH identifica a pessoa
-- em Pendências. Nesse ato o aparelho vira ativo, as fotos viram o cadastro
-- facial e as marcações pendentes são atribuídas (valem retroativamente).
-- Aparelho de quem saiu da empresa (colaborador inativo) ou rejeitado pelo RH
-- fica BLOQUEADO: a API responde 403 e o app para de enviar.
ALTER TABLE empresa ADD COLUMN IF NOT EXISTS link_token text;
CREATE UNIQUE INDEX IF NOT EXISTS ux_empresa_link_token ON empresa (link_token);

ALTER TABLE dispositivo ALTER COLUMN colaborador_id DROP NOT NULL;
ALTER TABLE dispositivo ADD COLUMN IF NOT EXISTS empresa_id text REFERENCES empresa(id) ON DELETE CASCADE;
ALTER TABLE dispositivo ADD COLUMN IF NOT EXISTS estado text NOT NULL DEFAULT 'ativo';  -- pendente | ativo | bloqueado
ALTER TABLE dispositivo ADD COLUMN IF NOT EXISTS matricula_informada text;              -- opcional, digitada após o 1º ponto
ALTER TABLE dispositivo ADD COLUMN IF NOT EXISTS cadastro jsonb;                        -- {vetores, miniatura_url} do 1º ponto; vira template ao identificar
ALTER TABLE dispositivo ADD COLUMN IF NOT EXISTS bloqueado_em timestamptz;
ALTER TABLE dispositivo ADD COLUMN IF NOT EXISTS motivo_bloqueio text;                  -- colaborador_inativo | rejeitado_rh
UPDATE dispositivo d SET empresa_id = c.empresa_id FROM colaborador c WHERE c.id = d.colaborador_id AND d.empresa_id IS NULL;
CREATE INDEX IF NOT EXISTS ix_disp_empresa_estado ON dispositivo (empresa_id, estado);

ALTER TABLE marcacao ALTER COLUMN colaborador_id DROP NOT NULL;
ALTER TABLE marcacao ADD COLUMN IF NOT EXISTS dispositivo_id text;
CREATE INDEX IF NOT EXISTS ix_marc_disp_pendente ON marcacao (dispositivo_id) WHERE colaborador_id IS NULL;
