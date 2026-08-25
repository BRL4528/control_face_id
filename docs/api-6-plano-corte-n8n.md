# API-6 · Plano de corte n8n → API própria, com rollback

Cartão T-5D99FB. Medido em produção (`mcp n8n` + `curl` na Vercel), não em git —
o repo (`n8n/*.workflow.js`) e o n8n real divergem, e é essa divergência que
importa aqui.

## 0. Achado crítico — não estava no escopo do cartão, precisa ir na frente

**O app v3 já está em produção (`control-face-id.vercel.app`, confirmado por
`curl` agora) e as três rotas que o aparelho usa para bater ponto —
`/efrat/carga`, `/efrat/marcacoes`, `/efrat/cadastro` — respondem 401 para
100% dos aparelhos.**

Causa: os três workflows n8n ainda ativos nessas rotas (`iykvFQQfkNv4jIxM`,
`RZzyM9O3ybVWwgDL`, `Itr2erwEzwpf2Blm`) autenticam lendo `body.token` contra
`efrat_dispositivo.token` — mecanismo v2. O cliente v3 (`js/api.js:9`, comentário
próprio) não manda mais `token` nenhum: manda `Authorization: Bearer
<credencial>` e o corpo só tem `dispositivo_id`. Os três workflows não leem essa
header. Todo aparelho cai no mesmo `if (disp.length === 0)` e recebe
`{ ok:false, erro:'token invalido ou dispositivo inativo' }`.

Rotas novas do v3 (`dispositivo/registrar`, `dispositivo/estado`,
`identificar`, `gestor/equipe-hoje`, `gestor/ajustar`) não têm workflow
nenhum em produção — nem a versão nova nem a antiga. `mcp n8n search_workflows
query:"Efrat"` devolve só os **7 workflows do piloto v2** (`api-piloto.md`),
nenhum deles dessas cinco rotas. Essas chamadas recebem 404 de webhook não
registrado.

**O que não quebrou:** `/efrat/rh/*` — autentica por `usuario`+`chave`, mecanismo
que não mudou, `postRh()` não manda `credencial`. O painel do RH segue de pé.

**O que não se perde, mesmo quebrado:** o app é offline-first — marcação
fica na fila local e não desaparece. Mas sem `/efrat/carga` funcionando o
aparelho não tem galeria pra comparar rosto nenhum; meu palpite é que o
reconhecimento biométrico trava por completo, não só o envio. Isso e o alcance
exato de "trava totalmente" ou "degrada" é do Full-Stack medir no app — eu meço
n8n, não a tela.

**Isto é mais urgente que o corte do cartão.** Duas saídas possíveis, ambas fora
do meu papel de decidir sozinho porque mexem em código ou reverte deploy do
cliente: (a) rollback do deploy do `main` para o commit anterior a `d13d39a`
até a API própria (ou os workflows v3) estarem prontos; (b) hotfix nos 3
workflows v2 pra também aceitarem `Authorization: Bearer` como alternativa a
`body.token` (mudança pequena, mesma Data Table, sem trocar de schema). Não
apliquei nenhuma das duas — são código/infra, e (a) é decisão do Orquestrador,
(b) é do Full-Stack ou de quem tiver a caneta em n8n neste ciclo.

## 1. A discrepância `/efrat/carga` vs `/efrat/carga-v3` — resolvida, não é mistério

Já estava decidido e documentado antes deste ciclo
(`.central-agentes/handoffs/2026-08-19-arquiteto-t-e1b1cb.md:31` e
`RETOMAR-AQUI.md:118`): `efrat/carga-v3` é o **path temporário de propósito**
do workflow escopado por equipe (`n8n/carga-escopada.workflow.js`), criado pra
coexistir com o `/efrat/carga` antigo (`iykvFQQfkNv4jIxM`, ainda ativo, devolve
a unidade inteira sem escopo por equipe). O plano sempre foi: quando cortar,
apagar o antigo e renomear o path do novo para `efrat/carga`.

**Fato que muda o plano:** esse "workflow antigo vivo em produção fora do
repo" existe mesmo — é `iykvFQQfkNv4jIxM`, criado 2026-08-14, e **nunca foi
commitado**; só existe no n8n. E o workflow v3 escopado (`carga-escopada`) **não
está publicado em n8n nenhum** — só existe como fonte em
`n8n/carga-escopada.workflow.js`, nunca criado via `create_workflow_from_code`.
Ou seja, a "virada de path" planejada nunca aconteceu, e agora é irrelevante:
com a API própria substituindo os dois, não faz sentido publicar o
`carga-escopada` em n8n só para trocar de path — vai direto do `iykvFQQfkNv4jIxM`
(v2, ativo) para a rota `/efrat/carga` da API (que já nasce escopada, porque usa
o núcleo do servidor-falso). **Não há pergunta para o cliente aqui — é
plano interno, decisão já tomada, só não executada.**

## 2. Inventário real: 24 rotas que o cliente chama, o que responde hoje

Contei em `js/api.js` (22) + `publico/js/api-face.js` (2) = **24** rotas
chamadas pelo código hoje (`integra/v3-r3`, que é onde o v3 vive — este
worktree está num ponto anterior a ela, sem `publico/`). O contrato
(`docs/fase3-contrato.md`) também define `POST /efrat/rh/aparelho/escopo`
(§1.7) que não encontrei chamada em `js/`; ou é rota do contrato ainda não
ligada na UI, ou fica pra quem estiver com T-13FDDF/T-D9CDF8 confirmar — não é
bloqueio deste cartão.

| Rota | Quem chama | n8n hoje | Situação |
|---|---|---|---|
| `/efrat/carga` | aparelho | `iykvFQQfkNv4jIxM` (v2, ativo) | **quebrada p/ cliente v3** (§0) |
| `/efrat/marcacoes` | aparelho | `RZzyM9O3ybVWwgDL` (v2, ativo) | **quebrada p/ cliente v3** (§0) |
| `/efrat/cadastro` | aparelho/gestor/RH | `Itr2erwEzwpf2Blm` (v2, ativo) | **quebrada p/ cliente v3** (§0) |
| `/efrat/dispositivo/registrar` | aparelho | nenhum | 404 |
| `/efrat/dispositivo/estado` | aparelho | nenhum | 404 |
| `/efrat/identificar` | gestor | nenhum | 404 |
| `/efrat/gestor/equipe-hoje` | gestor | nenhum | 404 |
| `/efrat/gestor/ajustar` | gestor | nenhum | 404 |
| `/efrat/rh/sal` | RH | `ILyS0MQF2HWMmWTD` (ativo) | ok |
| `/efrat/rh/dados` | RH | `ILyS0MQF2HWMmWTD` (ativo) | ok |
| `/efrat/rh/equipe` | RH | `omGeaICuugB6xrJZ` (ativo) | ok |
| `/efrat/rh/colaborador` | RH | `omGeaICuugB6xrJZ` (ativo) | ok |
| `/efrat/rh/decidir` | RH | `omGeaICuugB6xrJZ` (ativo) | ok |
| `/efrat/rh/colaborador/inativar` | RH | nenhum | 404 |
| `/efrat/rh/colaborador/reativar` | RH | nenhum | 404 |
| `/efrat/rh/aparelhos` | RH | nenhum | 404 |
| `/efrat/rh/aparelho/aprovar` | RH | nenhum | 404 |
| `/efrat/rh/aparelho/recusar` | RH | nenhum | 404 |
| `/efrat/rh/aparelho/revogar` | RH | nenhum | 404 |
| `/efrat/rh/face/cadastrar` | RH | nenhum | 404 |
| `/efrat/rh/face/convite` | RH | nenhum | 404 |
| `/efrat/rh/face/convites` | RH | nenhum | 404 |
| `/efrat/rh/face/convite/revogar` | RH | nenhum | 404 |
| `/efrat/face/convite/abrir` | página pública | nenhum | 404 |
| `/efrat/face/convite/enviar` | página pública | nenhum | 404 |

**Leitura do quadro:** 5 rotas ok (RH básico, v2 nunca mudou de contrato), 3
quebradas por incompatibilidade de auth (§0), **16 nunca tiveram
implementação nenhuma em n8n** — nem a v3 do repo (só 6 arquivos `.workflow.js`
existem como fonte, nenhum publicado) nem versão alguma. Isto é, a maior parte
do que a fase 2/3 "entregou" no kanban é frontend + `servidor-falso.js`
(a referência dos 173 e2e) — o backend real nunca acompanhou.

## 3. O que isso muda no plano de corte

Como 16 das 24 rotas não existem em n8n, **não há "n8n em produção" para
desligar** na maioria delas — a API própria não está substituindo um
workflow ativo, está preenchendo um buraco que já existe hoje (essas 16 rotas
já dão 404; a API vindo primeiro só troca "404" por "funciona"). O corte de
verdade — com sistema vivo dos dois lados, dependente da ordem — é só nas 5
rotas RH + 3 rotas de aparelho (8 no total). É nessas 8 que rollback importa.

## 4. Plano de corte por rota, com ordem e rollback

Restrição dura, do brief: **o cliente opera o n8n e não pode parar de bater
ponto durante a virada.** Isso governa a ordem: nunca cortar uma rota de
aparelho sem a API já provada contra a suíte de contrato (T-A4AAFD/T-D3DC5C/
T-7A35B5), e sempre por `js/config.js.apiBase` — nunca desligando o workflow
n8n primeiro.

**Mecanismo de corte, igual em toda rota:** trocar `apiBase` em `js/config.js`
de `https://n8n.samasc.com.br/webhook` para a origem da API nova. É uma linha,
efeito imediato em todo cliente que buscar a página de novo (sem build, por
desenho — comentário do próprio arquivo). **Mecanismo de rollback: a mesma
linha, de volta.** Enquanto o workflow n8n correspondente não for arquivado,
reverter é sempre possível e sempre rápido — arquivar cedo demais é o único
jeito de perder essa reversibilidade barata.

### Ordem recomendada

**Passo 0 — antes de qualquer corte:** resolver §0. Não empilhar corte em cima
de um backend já quebrado — se a API entrar enquanto o mundo pensa que o n8n
"funciona", ninguém vai saber separar sintoma novo de sintoma velho.

**Passo 1 — as 16 rotas 404 primeiro, sem risco de regressão.** Não existe
comportamento anterior pra quebrar; corte é estritamente ganho. Ordem interna
sugerida pelo que destrava mais operação: `dispositivo/registrar` +
`dispositivo/estado` (sem isso nenhum aparelho novo pareia) → `identificar` +
`gestor/*` (login do gestor e ajuste) → `rh/aparelho/*` + `rh/aparelhos`
(fila de aprovação do RH) → `rh/face/*` + `face/convite/*` (cadastro remoto) →
`rh/colaborador/inativar` + `reativar`.

**Passo 2 — as 3 rotas quebradas (`carga`, `marcacoes`, `cadastro`).** Só depois
da API provar essas três contra a suíte de contrato com dispositivo real de
teste (não só `servidor-falso.js`). Cortar uma de cada vez, `carga` primeiro
(sem carga não há o que marcar), confirmando em produção com um aparelho
piloto antes de liberar geral. **Rollback aqui tem uma armadilha:** se o
hotfix do §0 for aplicado nos workflows v2 (aceitar `Authorization` também),
o rollback desses três continua valendo — volta pro n8n corrigido, não pro
quebrado. Se ninguém aplicar o hotfix, rollback dessas três rotas **volta pro
mesmo 401**, então antes de cortar vale confirmar qual dos dois estados o
rollback vai encontrar.

**Passo 3 — as 5 rotas RH que hoje funcionam** (`rh/sal`, `rh/dados`,
`rh/equipe`, `rh/colaborador`, `rh/decidir`). Por último, de propósito: são as
únicas com base de comparação real em produção (uso diário do RH). Cortar por
último dá o máximo de tempo pra API já estar rodando as 19 rotas anteriores
sem susto antes de tocar na única coisa que hoje não está quebrada.

### O que NÃO cortar de uma vez

Não desligar (arquivar/desativar) nenhum workflow n8n antes de todas as rotas
dele estarem estáveis na API por pelo menos um ciclo de expediente completo
(turno cheio, não só um teste manual). `apiBase` trocado + workflow ainda
ativo = rollback de um passo. Workflow arquivado = rollback vira reconstrução.

## 5. O que fica no n8n de propósito, e o que não deve migrar

**Fica no n8n, fora do escopo desta migração:**
- **Monitor Diário** (`A6RSAH9SBb2BSnhj`) — cron + e-mail, não é rota HTTP do
  contrato. Sem motivo pra virar API; é automação, não serviço.
- Todo o resto do n8n que não é Efrat — Bitrix Bridge, ElisiaFeed, chat
  embutido, Efrat-RH-Bitrix (sincronização de "Colaborador Ativo" com o CRM,
  `ifnZrWqRfT90p2pZ` etc.). **Esta instância de n8n hospeda vários produtos do
  cliente, não só o ponto** — confirmado agora pela listagem (79 workflows,
  a maioria de outros produtos). Migrar Efrat não migra, nem deveria tocar,
  o resto.

**Não deveria migrar (é dívida a resolver, não rota a portar):**
- Nenhuma das 3 rotas de aparelho deveria carregar pro código novo o
  mecanismo de auth por `body.token` — a API já nasce com o contrato v3
  (`Authorization: Bearer`, `dispositivo_id`), então isso resolve sozinho ao
  portar, não é decisão extra.
- O `carga-escopada.workflow.js` (fonte v3 nunca publicada) não precisa ser
  publicado em n8n em momento nenhum — vai direto pro núcleo da API
  (`servidor-falso.js` já é a referência). Publicá-lo seria trabalho descartável
  no caminho do corte.

## 6. Pendência que não é minha para fechar

§0 precisa de dono e decisão de horário (hotfix nos workflows v2 vs. rollback
do deploy) antes do próximo turno do cliente começar. Reportando ao
Orquestrador como bloqueio prioritário, separado do plano de corte em si.
