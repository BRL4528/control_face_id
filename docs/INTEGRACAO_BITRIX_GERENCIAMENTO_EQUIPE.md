# Integração Bitrix24 → Ponto: pipeline "Gerenciamento de Equipe"

Decisão de 09/09/2026. **Substitui** a proposta em três camadas do
`HANDOFF_2026-09-08_retomada.md` (admissão/desligamento pelas categorias 5 e 11,
WhatsApp via Elisia, retorno Ponto → Bitrix). O escopo agora é um só:

> O pipeline **Gerenciamento de Equipe** (`CATEGORY_ID = 13`, portal
> `efrat.bitrix24.com.br`) é a fonte da alocação. **Cada etapa é uma equipe do
> ponto; cada card é um colaborador alocado nessa equipe.** Mover o card no kanban
> é o ato de realocar a pessoa. Sentido único: Bitrix → Ponto.

Status: **aprovado e IMPLEMENTADO em 09/09/2026** (código no repo, não commitado;
schema já aplicado no banco; workflow do n8n criado inativo). Falta o que está na
seção 9.

## 1. Mapeamento

| Bitrix (cat. 13)                                   | Ponto                                                                  |
|----------------------------------------------------|------------------------------------------------------------------------|
| Pipeline                                           | Empresa (1 pipeline por empresa; configurado no tenant do n8n)         |
| Etapa (`STATUS_ID` `C13:*`)                        | `equipe` — nome = nome da etapa. Nova coluna `equipe.bitrix_stage_id`  |
| Etapa **"A alocar"** (`C13:UC_ALOCAR`)              | *Sem equipe*: `equipe_padrao = NULL`, fora de qualquer escala          |
| Etapas finais: `C13:WON` "Desligado / Saída da equipe", `C13:LOSE` "Arquivado" | Não são equipes                                              |
| Card aberto na etapa X                             | `colaborador` ativo, `equipe_padrao = X`, membro da escala ativa de X  |
| Card fechado (ganho ou perdido) ou excluído        | Colaborador **inativo** → aparelho bloqueado (regra que já existe)     |
| Card reaberto                                      | Colaborador volta a ativo (desbloqueio automático, regra que já existe)|
| Contato vinculado ao card (`CONTACT_ID`)           | Identidade da pessoa. Nova coluna `colaborador.bitrix_contact_id`      |
| Título do card (fallback: nome do contato)         | `colaborador.nome` — o contato pode ser placeholder "Cliente 5567…"    |
| ID do contato no Bitrix (não existe campo "Código")| `colaborador.matricula` (decisão 1)                                    |
| Contato sem card no pipeline                       | O ponto não o conhece (não cria)                                       |

**O Bitrix NÃO define** (continua no ponto, cadastrado pelo RH uma vez por
equipe): cerca/local, dias da semana, jornada, biometria, pendências. A partir daí
o kanban decide *quem* está em cada equipe.

## 2. Efeito de mover um card (regra central)

Ao receber que o colaborador C está na etapa/equipe E:

1. `colaborador.equipe_padrao = E` (ou `NULL` se E = "A alocar").
2. C sai do array `colaboradores` de **todo** plano ativo da empresa em que
   estiver e entra nos planos ativos de E. Isso satisfaz por construção a regra
   "uma escala por pessoa por dia" que `/rh/plano` já impõe.
3. Re-materializa os planos afetados **de hoje em diante**
   (`materializarPlano(..., { recriar: true })`). Ajustes manuais
   (`origem='manual'`) e o passado não mudam. Marcações nunca mudam (trigger).
4. E sem plano ativo → C fica só com `equipe_padrao`; a Central deve sinalizar
   "equipe sem escala" (conferir se o aviso já existe antes de criar outro).

## 3. Mecanismo

Dois caminhos possíveis, ambos terminando na **mesma rota** do ponto:

- **(b) Reconciliação por snapshot** — n8n, a cada 5 min: `crm.dealcategory.stage.list
  {id:13}` + `crm.deal.list {filter:{CATEGORY_ID:13}, select:[ID,TITLE,STAGE_ID,
  CONTACT_ID,CLOSED,DATE_MODIFY]}` (paginado) + `crm.contact.get` dos contatos
  novos → monta o estado inteiro e faz `POST /api/integracao/bitrix {acao:'snapshot'}`.
  Idempotente: cura evento perdido, etapa renomeada/excluída, card apagado.
- **(a) Evento** — `event.bind` de `ONCRMDEALADD/UPDATE/DELETE` no app local já
  instalado, handler no n8n; o payload só traz o `ID`, então o n8n busca o card e
  o contato e chama a mesma rota com `{acao:'card'}`. Latência de segundos.

**Recomendação: começar só com (b).** É uma rota, um workflow, sem `event.bind`,
e 5 min de atraso é irrelevante para alocação de equipe. Adicionar (a) só se a
latência incomodar. Limite REST do Bitrix (2 req/s) comporta o snapshot com folga.

## 4. Contrato: `POST /api/integracao/bitrix`

Autenticação: `Authorization: Bearer <token de integração da empresa>`. O token é
gerado em Configurações (`/rh/config` acao `novo_token_integracao`), mostrado uma
vez e guardado só como sha256 em `empresa.integracao_token_hash` (mesmo padrão da
credencial do aparelho). O n8n guarda o token na linha do tenant (coluna nova
`ponto_token` na Data Table `0plzFQOimeF5qncE`). Um token só alcança a própria
empresa — isolamento igual ao das rotas `/rh/*`.

```json
{
  "acao": "snapshot",
  "origem": "bitrix",
  "pipeline": "13",
  "etapas": [
    { "id": "C13:UC_ALOCAR",          "nome": "A alocar",                       "ordem": 10, "sem_equipe": true },
    { "id": "C13:NEW",                "nome": "Escritório Efrat",               "ordem": 20 },
    { "id": "C13:PREPAYMENT_INVOIC",  "nome": "Obra 423 - Residencial Jerivás", "ordem": 40 }
  ],
  "cards": [
    { "id": "812", "etapa": "C13:PREPAYMENT_INVOIC", "fechado": false, "alterado_em": "2026-09-08T18:02:11-04:00",
      "contato": { "id": "456", "nome": "WAGNER DE OLIVEIRA CORREIA", "codigo": "1042", "telefone": "+5567..." } }
  ]
}
```

Resposta:

```json
{ "equipes": { "criadas": 1, "renomeadas": 0, "desativadas": 0 },
  "colaboradores": { "criados": 3, "atualizados": 60, "movidos": 2, "desativados": 1, "reativados": 0 },
  "avisos": [ { "tipo": "card_sem_contato", "card": "815", "titulo": "Lucas Santos Pereira" },
              { "tipo": "contato_em_mais_de_um_card", "contato": "456", "cards": ["812", "901"] } ] }
```

Regras de aplicação:

- **Equipes:** upsert por `bitrix_stage_id`; nome = nome da etapa (renomear no
  Bitrix renomeia no ponto, não duplica). Etapa que sumiu → `equipe.ativo=false`
  (nunca apaga: marcações referenciam `equipe_id`). Etapas finais e a etapa
  `sem_equipe` não geram equipe. Qual etapa é `sem_equipe` fica configurado na
  linha do tenant do n8n (coluna nova `ponto_stage_sem_equipe`, hoje
  `C13:UC_ALOCAR`) — os `STATUS_ID` do Bitrix não seguem a ordem do kanban.
- **Colaboradores:** upsert por `bitrix_contact_id`. Na primeira vez, se não
  houver `bitrix_contact_id` mas a matrícula casar com alguém já importado por
  planilha, **adota** esse registro (não duplica). Card sem contato → aviso,
  ignorado. Contato em mais de um card aberto (existe: "negócio repetido" no
  kanban) → vale o de `DATE_MODIFY` mais recente, aviso.
- Colaborador **com** `bitrix_contact_id` que não veio em nenhum card aberto →
  inativo. Colaborador **sem** `bitrix_contact_id` (criado à mão, demo) →
  intocado. Assim os dados de demonstração convivem com a integração.
- Depois de tudo: `sincronizarBloqueios` + re-materialização dos planos alterados
  (seção 2). Grava `config_empresa.dados.integracao_bitrix = { ultima_sync,
  resumo, avisos }` para a tela.
- Aplicar o mesmo snapshot duas vezes não muda nada.

## 5. Mudanças no repositório (feitas em 09/09)

| Onde                                    | O quê                                                                                                   |
|-----------------------------------------|---------------------------------------------------------------------------------------------------------|
| `db/schema.sql`                         | `equipe.bitrix_stage_id`, `colaborador.bitrix_contact_id` (únicos por empresa, parciais), `empresa.integracao_token_hash` |
| `api/_lib/bitrix.js` (novo)             | `normalizarSnapshot` (pura: validação, "A alocar", finais, desempate de contato repetido) + `aplicarSnapshot` (upserts em lote por `unnest`, próprio — a importação por planilha tem chave e semântica diferentes, não foi extraída) |
| `api/_lib/escala.js`                    | `realocarColaboradores(sql, empresaId, [{colaborador_id, equipe_id}], hoje)`: ajusta `plano_alocacao.colaboradores` e re-materializa |
| `api/integracao/bitrix.js` (novo)       | A rota da seção 4 (autentica pelo token da empresa, aplica snapshot, devolve resumo)                     |
| `api/rh/config.js` + tela Configurações | acoes `novo_token_integracao` / `revogar_token_integracao`; seção "Integração Bitrix24" com estado da última sincronização e avisos |
| `api/rh/colaborador.js`                 | Colaborador com `bitrix_contact_id`: a tela só altera o papel (nome/equipe/status vêm do kanban)        |
| `scripts/dev-local.js` (novo)           | Servidor local sem `vercel dev` (estáticos + `/api/*`), usado para testar tudo isto ponta a ponta       |
| `api/rh/equipe.js` (vincular/desvincular) | Passa a usar `realocarColaboradores` (decisão 4) para a tela e o kanban terem o mesmo efeito           |
| Telas Equipes / Colaboradores           | Item sincronizado ganha rótulo "Bitrix" e nome/equipe/ativo ficam só leitura ("mude no Bitrix")         |
| n8n                                     | `Efrat - Ponto ⇐ Bitrix (snapshot Gerenciamento de Equipe)` (id `LCzd196pI029cTF8`, INATIVO): 5 min → lê tenant → REST → POST em `ponto_url` com `ponto_token`; sem `ponto_url` só monta (dry run). Colunas novas na Data Table `0plzFQOimeF5qncE`: `ponto_url`, `ponto_token`, `ponto_stage_sem_equipe` |
| Testes                                  | `tests/unit/bitrix.test.js` (normalização, desempate, resumos). Ponta a ponta contra o banco pelo servidor local: criar/idempotência/plano preenchido/mover/fechar/renomear/snapshot vazio 409 — tudo passou e os dados sintéticos foram removidos |

## 6. Portal renomeado — CORRIGIDO em 09/09 (02:42 UTC)

O portal da Efrat passou a responder em **`efrat.bitrix24.com.br`**; a linha do
tenant na Data Table `0plzFQOimeF5qncE` ainda dizia `b24-4yujaa.bitrix24.com.br`
e todos os workflows montam a URL REST a partir dela. Efeito (verificado 02:31 UTC):
Console → `NO_AUTH_FOUND` em toda chamada; `Efrat - Sync Colaborador Ativo (30min)`
rodando "success" com `activeStageId: null, 0/0` — quebrado em silêncio desde a
troca. O `Bitrix Token Keeper` nunca quebrou (fala com `oauth.bitrix.info`, cuja
resposta já trazia `client_endpoint: https://efrat.bitrix24.com.br/rest/`).

O que foi feito:

| Item | Estado |
|------|--------|
| `domain` da linha `id=2` → `efrat.bitrix24.com.br` (one-off `Efrat - Corrigir dominio do portal`, id `cBZF17pDWq9kpOPa`, executado 02:42) | **feito** |
| `Efrat - Bitrix Console (Claude)` (`JoBbcT5S23cqbL3C`): filtro do tenant → domínio novo | **feito** (inativo por design; execução manual já usa a versão nova) |
| `Efrat - Sync Colaborador Ativo (30min)` (`ifnZrWqRfT90p2pZ`): filtro do tenant → domínio novo | rascunho **salvo**; a versão ATIVA ainda é a antiga — **falta clicar Publicar no n8n** (o agente não tem permissão para publicar) |
| Token Keeper, handler de instalação (`bitrix-oauth`), Chat Embutido, Bridges Outbound/MessageService/Status/Inbound | não precisam de edição: casam o tenant pelo `domain` que vem na própria linha, no payload do Bitrix ou por `member_id` |
| `id_key` da linha continua `b24-4yujaa.bitrix24.com.br` | mantido de propósito: nenhum workflow filtra por ele |

Prova: Console executado 02:43 UTC contra `efrat.bitrix24.com.br` devolveu as
etapas, os 69 cards e os campos do contato sem erro (seção 8).

## 7. Decisões (fechadas em 09/09)

1. **Matrícula = ID do contato no Bitrix.** Não existe campo "Código" no contato
   (lista completa de `UF_*` levantada; o que há de identificador é `CPF`, um
   `double`). Quem já foi importado por planilha é adotado pela matrícula na 1ª
   sincronização quando ela casar; senão nasce registro novo.
2. **Card fechado = fora do ponto:** `C13:WON` ("Desligado / Saída da equipe") e
   `C13:LOSE` ("Arquivado") desativam o colaborador e bloqueiam o aparelho.
3. **Vigência da movimentação: hoje inclusive.**
4. **Vincular/desvincular na tela do ponto passa a mexer na escala** (mesma função
   que o snapshot usa). Equipes/colaboradores sincronizados ficam só leitura na
   tela, com a orientação "mude no Bitrix".
5. **Frequência: 5 min.**

## 8. Levantamento da categoria 13 (feito em 09/09)

Etapas (`crm.dealcategory.stage.list {id:13}`), na ordem do kanban:

| SORT | STATUS_ID | Nome |
|-----:|-----------|------|
| 10 | `C13:UC_ALOCAR` | A alocar |
| 20 | `C13:NEW` | Escritório Efrat |
| 30 | `C13:PREPARATION` | Obra 408 - Unicesumar - Santa Casa Corumbá |
| 40 | `C13:PREPAYMENT_INVOIC` | Obra 423 - Residencial Jerivás |
| 50 | `C13:EXECUTING` | Obra 430 - Residencial Heliéder |
| 60 | `C13:FINAL_INVOICE` | Obra 469 - UBSF Ana Maria Couto |
| 70 | `C13:UC_OBR05` | Obra 471 - EMEI Regina Vitorazzi |
| 80 | `C13:UC_OBR06` | Obra 504 - Edificação PPD São Gabriel |
| 90 | `C13:UC_OBR07` | Obra 518 - ETE Botas |
| 100 | `C13:UC_OBR08` | Obra 519 - ETE Taboado |
| 110 | `C13:UC_OBR09` | Obra 536 - Dephos - Grupo Salta |
| 120 | `C13:UC_OBR10` | Obra 538 - Fazenda - João e Mirela |
| 130 | `C13:UC_OBR11` | Obra 547 - ETE Imbirussu |
| 140 | `C13:UC_OBR12` | Obra 548 - Guarda Corpo MRV |
| 150 | `C13:UC_OBR13` | Obra 562 - Três Lagoas (Reforma) |
| 160 | `C13:UC_OBR14` | Obra 574 - Rio Verde (Elevatórias) |
| 170 | `C13:UC_OBR15` | Obra 576 - Dephos - Grupo Salta |
| 180 | `C13:UC_OBR16` | MO - MRV |
| 190 | `C13:UC_HQ0UT6` | MO - Almoxarifado |
| 200 | `C13:WON` | Desligado / Saída da equipe *(final)* |
| 210 | `C13:LOSE` | Arquivado *(final)* |

Cards (`crm.deal.list CATEGORY_ID=13`): **69 abertos, 0 fechados, todos com
`CONTACT_ID`**. 66 em "A alocar", 2 em "Escritório Efrat", 1 em "Obra 423".

Inconsistência para o RH resolver no Bitrix (o snapshot vai só avisar):

| Contato | Cards | Títulos (nomes diferentes no mesmo contato) |
|---------|-------|----------------------------------------------|
| 3807 | 4773, 4787 | ANDERSON LOPES DE SOUZA / ANDERSON PINHEIRO GOMES |
| 3811 | 4885, 4777 | ROGERIO DE REZENDE ALIXANDRE / ANTONIO MARCO DIAS TEIXEIRA |

Campos do contato relevantes: `UF_CRM_1784607740` Colaborador Ativo (boolean),
`UF_CRM_1781034184963` Local de alocação (enumeration — hoje redundante com o
kanban), `UF_CRM_1781033819427` Status (enumeration; bloqueios 305/307/57/61),
`UF_CRM_1785428521471` CPF (double), `UF_CRM_1781038005918` Data de admissão.
Não há campo "Código"/matrícula.

## 9. Para ligar em produção (na ordem)

1. **Revisar e commitar** o código do repo (`git status` lista os arquivos) e dar
   push em `main` — o deploy da Vercel publica `/api/integracao/bitrix`.
2. **No n8n**, três cliques que o agente não tem permissão para dar:
   - `Efrat - Sync Colaborador Ativo (30min)` (`ifnZrWqRfT90p2pZ`): **Publicar** a
     versão salva (filtro do tenant no domínio novo). Até isso a versão ativa usa
     o domínio antigo e continua 0/0.
   - `Efrat - Configurar tenant (one-off)` (`cBZF17pDWq9kpOPa`): **Executar** uma
     vez. Grava `ponto_url`, `ponto_token` (já gerado em Configurações do Ponto,
     hash no banco) e `ponto_stage_sem_equipe = C13:UC_ALOCAR` na linha da Efrat.
   - `Efrat - Ponto ⇐ Bitrix (snapshot …)` (`LCzd196pI029cTF8`): executar uma vez à
     mão e conferir a resposta (`status: 200`, resumo com 19 equipes criadas e 69
     colaboradores); depois **Publicar**.
3. No Ponto: cadastrar a **escala** (cerca, dias) de cada equipe que veio do
   Bitrix — hoje só "Escritório Efrat" e "Obra 423" têm gente fora de "A alocar".
4. No Bitrix: resolver os dois contatos em dois cards (seção 8).

Dry run já feito: o workflow montou 21 etapas, 69 cards e 67 contatos (2
repetidos) em 2,6 s, sem erro de REST.
