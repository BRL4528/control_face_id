# Checkpoint — entrega do v3 no repo do cliente (Orquestrador)

Ciclo curto, sem especialistas acionados: nenhum agente estava escrevendo ou
rodando teste. Todo o trabalho abaixo foi integração e medição.

## Concluído

O v3 saiu dos worktrees da Central e chegou ao repo do cliente. Causa do
"nada refletiu no meu repo": ~10 branches `central/*` divergentes, nenhum
integrado, `main` parado em `269cd42` (14/08).

- Branch de integração **`integra/v3-r3`** (`8598786`) = `f306a47099` (T-E3DBD4)
  + `bcab3666de` (T-38A7C1) + `4eef9411ef` (T-E1B1CB/n8n) + os dois branches de
  docs (`17ed6e3df4`, `f9024bcab1`). **Quatro merges, zero conflito.**
- `main` do cliente **fast-forward** para `8598786` — 81 commits à frente de
  `origin/main`. Nada reescrito.
- `integra/v3` (`aa8d8e7`) e todos os branches originais intactos.

## Arquivos que chegaram (antes ausentes no main)

`js/gestor.js` · `css/tema.css` · `css/fontes.css` · `n8n/` (6 workflows, com
`gestor-ajustar.workflow.js`) · `docs/adr-acesso-v3.md` · `docs/ameacas-v3.md` ·
`docs/plano-v3.md` · `docs/auditoria-integracao-v3.md` ·
`tests/e2e/{acesso,gestor,offline,gestor-ajustar-contrato}.spec.js` ·
`vendor/fontes/*` (8) · `vendor/chart.umd.min.js` · `.central-agentes/handoffs/*`

## Testes (medidos no diretório do cliente, `--retries=0`)

**59 unit verdes** (número-detector de base certa: 47/48 = a mescla não
aconteceu). E2E **42/42 verdes** em duas rodadas em `integra/v3-r3`; no `main`
pós-merge, 41/42 — os 12 vermelhos do handoff r2 fecharam de vez, eram
correções em branches que não se conheciam.

## Pendências

1. **PUSH NÃO FEITO.** Bloqueado pelo classificador do modo auto (duas
   tentativas) e a sessão não tem rota para github.com — é o motivo de
   `subir.sh` existir. Cliente rodou/roda: `git push origin main`.
2. **Flaky `acesso.spec.js:63`** ("critério 2"): 2 falhas em 8 rodadas do
   arquivo completo, 4/4 verde isolado. Não é regressão do merge. Causa é o
   assert, não o produto nem o fixture (servidor próprio por `beforeEach`):
   lê `Fila.candidato === null` no instante em que `marcar()` volta, e
   `marcar()` só espera `#cartao .cartao.ok` pintar. Conserto: `waitForFunction`
   curto, preservando a intenção (zera na confirmação, não no timer de 3,5s).
3. **T-B1D7F6 aberta** — `js/config.js` com `apiBase` de produção por padrão +
   boot autocadastra sem clique. Se o Vercel estiver ligado ao Git deste repo,
   o push publica app onde cada carregamento cria linha em `efrat_dispositivo`.
   Testar à mão só por `npm test` / `npx playwright test --headed`, nunca
   `npm run serve`.
4. **Decisão do cliente, ainda sem resposta:** as até 2 linhas pendentes em
   `efrat_dispositivo` de produção ficam ou saem.
5. `pnpm-lock.yaml` não rastreado no diretório do cliente (origem desconhecida,
   não fui eu). Faz `subir.sh` abrir prompt interativo.

## Próximo passo, em ordem

1. Cliente: `cd ~/inova/control_face_id && git push origin main` → acompanhar
   `github.com/BRL4528/control_face_id/actions`.
2. Consertar o flaky do item 2 (Revisor é o dono do arquivo? não — `acesso.spec.js`
   é do Full-Stack; `fluxo.spec.js` é do Revisor).
3. T-B1D7F6 (DevOps, já `PRONTO` no kanban) antes de qualquer teste manual em
   navegador.
4. Levar o item 4 ao cliente.

## Regra que esta rodada acrescenta

Integrar e entregar no worktree do cliente **faz parte de terminar**. Trabalho
que fica em branch de worktree da Central é invisível para quem roda o projeto —
foi exatamente a cobrança que abriu este ciclo.
