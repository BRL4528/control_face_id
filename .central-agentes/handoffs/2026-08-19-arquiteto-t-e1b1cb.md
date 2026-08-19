# Checkpoint T-E1B1CB

## Concluido no branch

- `47c8a54`: servidor falso implementa registro e estado de dispositivo v3.
- `069050e`: carga escopada, identificacao 1:N, sessao/equipe/ajuste do gestor.
- `4bd88b8`: rate limits, CORS e migracao de token legado.
- `49c13de`: compatibilidade do erro textual v2.
- Smoke direto de todas as rotas v3: OK.
- Unitarios: 47/47.
- E2E apos a correcao de compatibilidade: 23/23 em 1,7 min.

## Bloqueio externo

O runtime nao possui credencial/API/conector n8n. A habilidade Browser foi inicializada
para `https://n8n.samasc.com.br/`, mas retornou `No browser is available`. Portanto
nenhum workflow ativo foi tocado, nenhuma copia foi criada e nenhuma Data Table real
foi alterada.

## Falta

- Obter sessao autenticada do navegador ou credencial/API n8n.
- Duplicar/versionar workflows sem alterar os seis ativos.
- Criar tabelas/colunas aditivas do ADR e workflows v3 nas copias.
- Validar copias e informar ao Orquestrador exatamente quais IDs trocar.

## SDK n8n sem deploy

- `4a939e5` + `6e27733`: `n8n/dispositivo-registrar.workflow.js`, SDK validado sem issues; inclui cadastro pendente, codigo CSPRNG com 3 tentativas, idempotencia por dispositivo e migracao do token legado. Falta ligar rate limit persistente de cadastro.
- `c8e261b` + `6e27733`: `n8n/dispositivo-estado.workflow.js`, SDK validado sem issues.
- `43d0cf8`: `n8n/carga-escopada.workflow.js`, SDK validado sem issues; filtra pessoas/templates por `equipes_ids` do dispositivo. Path temporario `efrat/carga-v3` para coexistir com ativo; trocar para `efrat/carga` no corte.
- Nenhum workflow foi criado/publicado; Orquestrador ficou responsavel por validar/publicar via conector.
- Faltam `identificar`, `gestor/equipe-hoje`, `gestor/ajustar` e rate limit persistente do registrar.
- `210098d`: patch CSP do DevOps absorvido literalmente; 23/23 E2E passaram com CSP ativa.

- `41ec956` + `ceed955` + `eafb391`: `n8n/identificar.workflow.js`; 1:N, limite, auditoria e sessao em `efrat_sessao_gestor` dedicada; SDK validate sem issues/warnings.
- `89bdd89`: CORS literal do ativo e `executeOnce` nas leituras globais.
- `7920cc9`: seeds do Revisor; confirmados em uso com 23/23 no branch dele.
- Faltam somente `gestor/equipe-hoje`, `gestor/ajustar` e rate limit persistente do registrar.

## Parada da rodada

- Ultimo commit funcional: `c2a71c1`, criou `n8n/gestor-equipe-hoje.workflow.js`; SDK CLI valida sem issues.
- Correcoes A1-A3 aplicadas em `bcfbfd2` e `d1e1119`: locators com IDs reais, `descricao` no storage/`apelido` na API, filtro de dispositivo nos nodes conhecidos e nota no ADR.
- Identificacao usa `efrat_sessao_gestor` dedicada desde `ceed955`; `eafb391` eliminou todos os warnings do SDK.
- Nenhum workflow foi publicado. Orquestrador publica/valida pelo conector.

### Faltando exatamente

1. Revisar `n8n/gestor-equipe-hoje.workflow.js`: hoje o fluxo e linear e tenta `Atualizar Atividade` mesmo quando `Validar Sessao e Montar Equipe` devolve erro sem `sessao_hash`. Primeira acao da retomada: inserir IF por `_status == 200`; sucesso atualiza `ultima_atividade`, erro vai direto a `Responder`.
2. Criar `n8n/gestor-ajustar.workflow.js` (ainda nao existe), com escopo da sessao, idempotencia, correcao pendente e update de atividade.
3. Ligar rate limit persistente do registrar a `efrat_limite_api`; o Code gera CSPRNG/migracao, mas o SDK ainda nao persiste limite por IP/janela.
4. Pedir ao Orquestrador `validate_workflow`/publicacao dos seis SDKs depois das correcoes; nao publicar localmente.
5. Ao retomar, ler primeiro o handoff mestre `2026-08-19-orquestrador-v3.md` no branch do Orquestrador. Os 23 E2E estao vermelhos intencionalmente pela retirada do pareamento; nao restaurar fluxo legado.
