# ADR — Acesso v3 sem token digitado

- **Status:** aceito para implementacao
- **Data:** 2026-08-19
- **Escopo:** autenticacao do aparelho, identificacao facial, sessao do gestor e carga biometrica

## Contexto e decisao

O aparelho compartilhado deixa de pedir token ao usuario. No primeiro acesso ele gera
um `dispositivo_id` UUID v4 e uma credencial aleatoria de 256 bits, ambos persistidos
no IndexedDB. A credencial e segredo de maquina: nunca aparece na interface. O cadastro
fica pendente ate o RH localizar o pedido e digitar no painel o codigo curto mostrado
no aparelho, escolhendo local e `equipes_ids`.

O codigo curto serve somente para prova de posse e busca do pedido; nao autentica API.
`apelido`, `ua` e `geo` sao metadados autodeclarados. O backend guarda apenas o hash da
credencial. Depois do cadastro, todos os endpoints do aparelho exigem
`Authorization: Bearer <credencial_dispositivo>` e conferem se o
`dispositivo_id` do corpo pertence a ela.

A carga offline contem somente pessoas ativas das equipes autorizadas para o aparelho.
O fallback 1:N da unidade passa para o servidor e so funciona on-line. A face pode
abrir uma sessao de gestor, nunca uma sessao de RH. Ajustes do gestor sao propostas
pendentes de decisao do RH.

## Convencoes do contrato

- Base: `/webhook`; JSON UTF-8; datas em ISO 8601 UTC; IDs opacos.
- Toda resposta inclui `ok` e `request_id`. Resposta de erro:
  `{ "ok": false, "erro": { "codigo": "CODIGO", "mensagem": "texto seguro", "campo": "opcional" }, "request_id": "..." }`.
- `400` corpo invalido; `401` credencial ausente/invalida; `403` fora do escopo;
  `404` recurso invisivel ou inexistente; `409` conflito; `422` regra de negocio;
  `429` limite excedido; `503` dependencia indisponivel.
- Nenhum erro revela se uma pessoa fora do escopo existe. Descritores, credenciais e
  fotos nunca aparecem em logs. O cliente gera `Idempotency-Key` UUID v4 nas escritas.

## `POST /efrat/dispositivo/registrar`

Nao exige `Authorization` no primeiro cadastro. Corpo:

```json
{
  "dispositivo_id": "uuid-v4",
  "credencial_publica": "base64url(sha256 da credencial)",
  "apelido": "Tablet obra norte",
  "ua": "user-agent",
  "geo": { "lat": -20.46, "lng": -54.62, "precisao_m": 24 },
  "codigo_curto": "ABC-123"
}
```

`geo` e opcional; os demais campos sao obrigatorios. O codigo e derivado localmente
do UUID, tem seis caracteres e e exibido ao RH. Repetir o mesmo cadastro e idempotente
se a credencial coincidir; credencial diferente para UUID existente retorna conflito.
O endpoint aplica limite por IP e por janela e incrementa um contador de tentativas
visivel no painel do RH.

Resposta `202`:

```json
{
  "ok": true,
  "estado": "pendente",
  "dispositivo_id": "uuid-v4",
  "codigo_curto": "ABC-123",
  "consultar_apos_s": 10,
  "request_id": "..."
}
```

Erros especificos: `DISPOSITIVO_CONFLITO` (`409`), `CODIGO_INVALIDO` (`400`) e
`LIMITE_CADASTRO` (`429`, com `Retry-After`). A aprovacao pelo RH deve conferir o
codigo digitado, registrar autor/data, `equipes_ids` e local antes de ativar.

## `POST /efrat/dispositivo/estado`

Requer a credencial do aparelho, inclusive enquanto pendente. Corpo:

```json
{ "dispositivo_id": "uuid-v4" }
```

Resposta `200` pendente:

```json
{
  "ok": true,
  "estado": "pendente",
  "codigo_curto": "ABC-123",
  "consultar_apos_s": 15,
  "request_id": "..."
}
```

Resposta `200` aprovado:

```json
{
  "ok": true,
  "estado": "ativo",
  "dispositivo": {
    "dispositivo_id": "uuid-v4",
    "apelido": "Tablet obra norte",
    "equipes_ids": ["eq-01", "eq-02"],
    "configuracao_versao": 7
  },
  "request_id": "..."
}
```

Um aparelho negado ou revogado recebe `200` com `estado: "negado"` ou
`estado: "revogado"`, sem carga. Erros: `CREDENCIAL_INVALIDA` (`401`) e
`DISPOSITIVO_NAO_ENCONTRADO` (`404`).

## `POST /efrat/carga`

Requer credencial de aparelho ativo. Corpo:

```json
{
  "dispositivo_id": "uuid-v4",
  "desde_versao": 41
}
```

`desde_versao` e opcional. O servidor obtem `equipes_ids` exclusivamente do cadastro
ativo; nao aceita unidade ou equipes pedidas pelo cliente. A consulta retorna somente
pessoas ativas e templates vigentes cuja `equipe_id` pertence a essa intersecao.

Resposta `200`:

```json
{
  "ok": true,
  "versao": 42,
  "gerado_em": "2026-08-19T18:00:00Z",
  "escopo": { "equipes_ids": ["eq-01", "eq-02"] },
  "pessoas": [
    {
      "pessoa_id": "p-1",
      "nome": "Ana Silva",
      "equipe_id": "eq-01",
      "papel": "colaborador",
      "template": { "versao": 3, "vetores": [[0.1, 0.2]] },
      "miniatura": "data:image/jpeg;base64,..."
    }
  ],
  "removidos_ids": [],
  "request_id": "..."
}
```

Se nao houve alteracao, responde `200` com listas vazias e a mesma `versao`. Pendente
recebe `403 DISPOSITIVO_PENDENTE`; negado/revogado, `403 DISPOSITIVO_INATIVO`; aparelho
ativo sem equipes, `403 DISPOSITIVO_SEM_ESCOPO`.

## `POST /efrat/identificar`

Fallback on-line para pessoa que nao esta na galeria offline do aparelho. Requer
aparelho ativo. Corpo:

```json
{
  "dispositivo_id": "uuid-v4",
  "descritor": [0.012, -0.031],
  "capturado_em": "2026-08-19T18:02:03Z"
}
```

O descritor deve ter exatamente 128 numeros finitos no intervalo aceito pelo motor.
O servidor compara com a galeria da unidade associada ao local do aparelho, sem
devolver essa galeria. Resposta reconhecida `200`:

```json
{
  "ok": true,
  "resultado": "reconhecido",
  "pessoa": {
    "pessoa_id": "p-9",
    "nome": "Bruno Lima",
    "equipe_id": "eq-09",
    "papel": "gestor"
  },
  "distancia": 0.37,
  "pode_registrar": true,
  "fora_do_escopo_offline": true,
  "request_id": "..."
}
```

Sem correspondencia inequívoca responde `200` com
`{ "ok": true, "resultado": "nao_reconhecido", "request_id": "..." }`.
Somente distancia estritamente menor que `limiarAceite` (`0.45`) identifica gestor;
zona cinzenta nunca cria sessao privilegiada. Erros: `DESCRITOR_INVALIDO` (`400`),
`DISPOSITIVO_INATIVO` (`403`) e `SERVICO_RECONHECIMENTO_INDISPONIVEL` (`503`).

## Sessao facial do gestor

Ao reconhecer `papel: "gestor"`, o backend emite `sessao_gestor` opaca, ligada a
`gestor_id`, aparelho, equipes geridas e evento de reconhecimento. Ela dura no maximo
**10 minutos**, expira apos **5 minutos de inatividade** e nao e renovavel alem do
limite absoluto; nova sessao exige nova face. Ficar com a tela aberta nao conta como
atividade: ao expirar, dados somem da memoria/DOM, requisicoes passam a receber
`401 SESSAO_EXPIRADA` e o app volta automaticamente para a tela de ponto.

### `POST /efrat/gestor/equipe-hoje`

Requer `Authorization: Bearer <sessao_gestor>`. Corpo:

```json
{ "data_local": "2026-08-19", "timezone": "America/Campo_Grande" }
```

Resposta `200`:

```json
{
  "ok": true,
  "data_local": "2026-08-19",
  "equipes_ids": ["eq-01"],
  "resumo": { "em_jornada": 8, "em_intervalo": 2, "ausentes": 1 },
  "pessoas": [
    {
      "pessoa_id": "p-1",
      "nome": "Ana Silva",
      "equipe_id": "eq-01",
      "estado": "em_jornada",
      "ultima_marcacao": { "tipo": "entrada", "em": "2026-08-19T11:00:00Z" }
    }
  ],
  "request_id": "..."
}
```

O servidor ignora qualquer equipe enviada e calcula o escopo da sessao. Erros:
`SESSAO_EXPIRADA` (`401`), `FORA_DO_ESCOPO` (`403`) e `DATA_INVALIDA` (`400`).

### `POST /efrat/gestor/ajustar`

Requer sessao de gestor. Corpo:

```json
{
  "pessoa_id": "p-1",
  "data_local": "2026-08-19",
  "acao": "incluir_marcacao",
  "marcacao": { "tipo": "entrada", "em": "2026-08-19T11:00:00Z" },
  "motivo": "Falha de sincronizacao informada pelo colaborador"
}
```

`acao` admite `incluir_marcacao`, `alterar_marcacao` e `excluir_marcacao`; alterar ou
excluir tambem exige `marcacao_id`. Motivo e obrigatorio (10 a 500 caracteres). O
servidor confirma que a pessoa pertence a uma equipe gerida na sessao, mas nao altera
a marcacao. Cria uma linha em `efrat_correcao` com estado pendente, autor, instante,
valores anterior/proposto e trilha do evento facial.

Resposta `202`:

```json
{
  "ok": true,
  "estado": "pendente_rh",
  "correcao_id": "corr-123",
  "criado_em": "2026-08-19T18:10:00Z",
  "request_id": "..."
}
```

Erros: `PESSOA_FORA_DO_ESCOPO` (`403`), `MARCACAO_NAO_ENCONTRADA` (`404`),
`AJUSTE_INVALIDO` (`422`), `SESSAO_EXPIRADA` (`401`) e `IDEMPOTENCIA_CONFLITANTE`
(`409`).

## Sessao pessoal do colaborador

Depois do reconhecimento, a tela pessoal usa uma sessao em memoria com **90 segundos
de inatividade** e **3 minutos de limite absoluto**. Qualquer nova face encerra a
sessao anterior. Ao expirar, ao perder visibilidade por 30 segundos, ao bloquear o
aparelho ou ao tocar em "Sair", o app apaga dados pessoais da memoria/DOM, nao os
persiste em cache e volta para a tela de ponto. Manter a tela aberta nao renova o TTL;
somente acao explicita do usuario renova o prazo de inatividade.

Essa sessao permite consultar apenas o proprio historico e propor ajuste proprio. Ela
nao herda escopo de gestor, ainda que a pessoa tenha `papel: "gestor"`.

## Migracao de aparelhos com token antigo

1. Na primeira execucao da v3, o app que encontrar `token` legado gera UUID e nova
   credencial e chama `registrar` uma unica vez com `Authorization: Bearer <token antigo>`.
2. O backend valida o token contra a linha ativa existente, vincula de forma atomica o
   novo UUID/hash a ela e preserva exatamente `equipes_ids`, gestor e local atuais.
   A resposta e `200 estado: "ativo", migrado: true`; nao exige nova aprovacao porque
   a posse da credencial previamente aprovada e a prova de continuidade.
3. Depois de confirmar `estado=ativo` e obter uma carga autenticada pela nova
   credencial, o app apaga o token legado. Falha intermediaria e repetivel pela mesma
   `Idempotency-Key` e nunca cria dois dispositivos.
4. O backend aceita o token antigo apenas para essa migracao por **30 dias a partir do
   deploy**. Nao o aceita nos endpoints v3 nem em `/efrat/carga` novo. Ao migrar, marca
   o token como consumido imediatamente; depois da janela, aparelho nao migrado segue
   o fluxo normal de aprovacao do RH.

Erros especificos: `TOKEN_LEGADO_INVALIDO` (`401`), `TOKEN_LEGADO_CONSUMIDO` (`409`)
e `JANELA_MIGRACAO_ENCERRADA` (`410`). A operacao registra dispositivo, IP, instante e
resultado para auditoria, sem registrar o token.

## Consequencias e criterios de aceite

- Um celular comprometido expoe somente a biometria das equipes explicitamente
  autorizadas, nao a unidade inteira.
- Colaborador remanejado depende de rede para identificacao 1:N; sem rede segue para
  registro manual com foto e decisao posterior do RH.
- Spoof facial de gestor pode, no pior caso, ler o dia das equipes geridas e propor
  correcao; nao altera ponto nem acessa RH diretamente.
- Testes de contrato devem cobrir escopo calculado no servidor, estados pendente/
  revogado, expiracao absoluta e por inatividade, idempotencia, limite de cadastro,
  migracao repetida e impossibilidade de gestor acessar pessoa/equipe alheia.
