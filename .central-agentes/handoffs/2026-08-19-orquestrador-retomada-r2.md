# Retomada da rodada v3 — checkpoint do Orquestrador (r2)

Rodada `fc42c1ff9f`, 2026-08-19. Continuação direta de
`RETOMAR-AQUI.md` (branch `central/50bbfbf909/f9024bcab1-control_face_id`).

## A pegadinha que custou meia hora — registre isto

Os 5 branches desta rodada (`central/fc42c1ff9f/*`) nasceram do `main`, que está em
`269cd42` (14/ago). **Estão zerados em relação ao v3.** Quem olhar só o próprio worktree
conclui que o projeto está verde e completo — e foi exatamente o que eu concluí antes de
consultar o Pipeline do Ambiente (`central-agentes task list`).

**Regra:** `task list` primeiro, código depois. O git desta rodada não é a fonte da verdade
sobre o que está em andamento.

## Integração refeita — `integra/v3-r2`

`integra/v3` (`aa8d8e7`) ficou intacto; preservado também em `backup/integra-v3-aa8d8e7`.
A base nova é `integra/v3-r2`, partindo de `main` e mesclando na ordem prescrita:
DevOps (`a0874c9`) → Arquiteto (`c71a1eb`) → Full-Stack (`3328bf7`) → Revisor (`6ca46b3`).

Um conflito, dois achados. Todos da mesma família de sempre: duas metades certas que não
se conhecem.

| | O que era | Quem pegou | Efeito real se passasse |
|---|---|---|---|
| conflito | `css/fontes.css`: 8 faces (DevOps) vs 18 com `latin-ext` (Full-Stack) | o próprio merge | resolvido pelo corte do DevOps |
| achado | 10 `.woff2` de `latin-ext` entraram como arquivo novo — adição de binário não conflita | **guarda 7** | 10 órfãos em `vendor/fontes/` |
| achado | `./css/tema.css` linkado no `index.html`, ausente do precache do `sw.js` | **guarda 6** | **PWA offline abrindo sem estilo nenhum** |

A guarda 7 só pegou porque é **bidirecional**: a direção css→arquivo passaria limpa.
As guardas do DevOps se pagaram na primeira integração em que foram usadas.

Estado: **59 unit verdes, 7 e2e verdes** (`acesso.spec.js` 6 + `offline.spec.js` 1).
Os 23 de `fluxo.spec.js` seguem vermelhos **de propósito** — T-38A7C1.

## Duas divergências entre handoffs, resolvidas

1. **`tests/e2e/acesso.spec.js` existe.** O Revisor registrou que não achou em branch
   nenhum; está em `central/50bbfbf909/c9bb844c20` (commit `9abfc2a`), só no branch do
   Full-Stack. Ele procurou antes de ter esse branch em mãos. Já está na `integra/v3-r2`.
2. **A prova de reprovação do critério 5 foi feita.** Mutei `js/app.js:173`
   (`ultimoEstado === 'ativo'` → `true`, o fail-open de volta) e o **critério 5b reprovou**.
   Fail-closed está provado por teste que eu vi reprovar. Mutação revertida, 6/6 verdes.
   Ressalva honesta: **5a passa mesmo mutado** — cobre o caminho anterior à identidade
   existir, então não prova o gate. Não é bloqueio; é chamada do Revisor se quiser reforçar.

## Cartões movidos

- **T-607E5A → concluído.** A pendência única era eu conferir se `acesso.spec.js` provava os
  5 critérios de verdade. Prova obtida (5b reprova). Aprovada.
- **T-5A062C → concluído.** Guarda 7 pronta e, melhor, provada em uso: pegou 2 bugs nesta
  integração.

Quadro: **8 concluídos, 3 abertos** (T-38A7C1 caminho crítico, T-8FB792, T-E1B1CB) +
T-D9CDF8 no backlog. `T-FBAA8F "teste"` é cartão de lixo, sem responsável — apagar.

## Despachado

Os 4 agentes receberam ordem de partir da `integra/v3-r2`, **não** dos branches antigos, com
o aviso de que o branch da rodada está zerado. Ao Revisor foram as duas notícias que o
destravam (o `acesso.spec.js` existe; a prova do 5 está feita). Ao DevOps, o pedido de
decidir se o CI roda `fluxo.spec.js` como não-bloqueante temporário com prazo explícito —
com licença para argumentar contra.

## Herdado e mantido

Nenhum cartão está pronto sem teste que alguém **viu reprovar**. Foi o que fechou a T-607E5A
hoje. E: nada tocou produção do cliente — nenhum workflow publicado, nenhum dado do piloto.
