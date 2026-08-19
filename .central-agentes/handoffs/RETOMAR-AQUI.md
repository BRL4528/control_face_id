# RETOMAR AQUI — rodada v3 do ControlFaceId

Pausada em 2026-08-19 por pedido do cliente. **Leia este arquivo primeiro, inteiro.**
Depois `docs/plano-v3.md` (briefing) e só então o handoff do agente que você for retomar.

## O que o cliente pediu

1. Tirar o token que o app pede. O funcionário só bate o ponto.
2. Gestor loga com a face, vê status da equipe e ajusta registro.
3. RH entra como admin: ajustes, relatórios, cadastro de face, equipes e **locais**.
4. Aplicar o design aprovado no Claude Designer (`~/Downloads/UI mockups for HR panel.zip`).
5. Backend n8n liberado para alteração.

Duas decisões que ELE tomou e não se discutem mais:
- **Carga escopada no servidor.** `/efrat/carga` entrega só as equipes do aparelho. O
  "buscar na unidade" offline morreu; remanejado depende de rede via `/efrat/identificar`.
  Ele aceitou o custo (mais registro manual em obra sem sinal).
- **Sessão do RH fica para depois.** A chave PBKDF2 como senha eterna é dívida documentada,
  estimada em 2,5-3 dias, cartão próprio na próxima rodada. Não tocar `js/cripto.js`.

## Estado do código — branch head de cada agente

| Branch (`central/50bbfbf909/<id>-control_face_id`) | Head | Conteúdo |
|---|---|---|
| `f9024bcab1` Orquestrador | `36b9ece` | `docs/plano-v3.md`, checkpoints, README, este arquivo |
| `72b3e79015` Arquiteto | **`c71a1eb`** | ADR, 4 de 6 `n8n/*.workflow.js`, `servidor-falso.js` v3 |
| `a7f15f0974` Revisor | **`908f212`** | 4 docs de análise, 3 e2e do RH com seed, **WIP: UI nova trazida, `fluxo.spec.js` intocado** |
| `41fa23ad22` DevOps | **`a0874c9`** | fontes, CSP, sw.js v6, 7 guardas, `offline.spec.js` |
| `c9bb844c20` Full-Stack | **`3328bf7`** | tema, fluxo do colaborador, `acesso.spec.js`, T-8FB792 **não iniciada** |

Handoffs individuais, um por branch, em `.central-agentes/handoffs/`:
`2026-08-19-arquiteto-t-e1b1cb.md` · `2026-08-19-devops-v3.md` ·
`2026-08-19-engenheiro-fullstack-c9bb844c20.md`. O do Revisor foi pedido na parada.

Nada ficou pela metade: a T-8FB792 do Full-Stack **não começou**, e o Revisor parou antes de
tocar em `fluxo.spec.js`. Os 4 agentes commitaram e pararam sob ordem.

`integra/v3` está em `aa8d8e7` — **desatualizado**. Foi integração provada (56 unit + 23 e2e
verdes) de um lote anterior. Refazer do zero na retomada: `git branch -f integra/v3 main` e
mesclar os 4 branches na ordem DevOps → Arquiteto → Full-Stack → Revisor.

## ⚠️ Os 23 e2e estão VERMELHOS de propósito

O pareamento por token foi removido, então tudo que clicava em `#btnParear`,
`#tokenAparelho`, `#btnParearOk` falha. **Isso é o plano, não regressão.** Não restaure o
pareamento para "consertar". A reescrita é a T-38A7C1, do Revisor, e é o caminho crítico.

Baseline de referência antes da quebra: 56 unitários, 23 e2e (24 com o offline do DevOps).
O README deliberadamente não anuncia mais números — eles envelhecem e já fizeram uma
estimativa nascer errada.

## Quadro: 6 concluídos, 4 abertos

**Concluídos:** ADR de acesso v3 · threat model + invariantes · privacidade da tela
compartilhada · auditoria de integração · fontes/CSP/cache · design system/tema.

**Abertos, em ordem de prioridade na retomada:**

1. **T-38A7C1 Revisor — CAMINHO CRÍTICO.** Reescrever `tests/e2e/fluxo.spec.js`. A tela nova
   já existe (`6b1958f`). Ordem definida por ele: helper novo que substitui `abrirFila()`
   (destrava 14 testes de uma vez), depois os 2 com asserção inline (linhas 106 e 175),
   depois os 4 que usam `#btnSairFila`. A tabela teste-a-teste está em `docs/ameacas-v3.md`.
   Dois critérios dele, já escritos: o helper espera **sinal visível**, nunca estado interno
   de JS; e o fluxo novo tem de continuar passando offline.
2. **T-607E5A Full-Stack — em REVISÃO, falta eu revisar.** Fluxo do colaborador entregue.
   Pendência única: conferir se `tests/e2e/acesso.spec.js` (`9abfc2a`) prova os 5 critérios
   de verdade — exigi que ele mostrasse os testes REPROVANDO, não só passando. O Revisor tem
   a palavra final sobre se a prova serve, porque foi ele quem definiu os critérios.
3. **T-8FB792 Full-Stack — começou.** Painel do gestor. Regras não negociáveis em
   `docs/plano-v3.md`: não abre automático, abre **agregado**, nome individual só num segundo
   toque, **ausentes antes de presentes**, corpo pequeno em tudo que não seja hora/contador.
   Ajuste do gestor é **proposta** que vira pendência do RH, nunca alteração direta.
4. **T-E1B1CB Arquiteto — 4 de 6 workflows escritos.** Faltam os dois de gestor. Ele estava
   aplicando 3 correções minhas quando parou: `descricao`↔`apelido`, locators `list`+ID em
   vez de `mode:'name'`, e filtro no nó Data Table em vez de varrer a tabela e filtrar em JS.
5. **T-5A062C DevOps — guarda 7 pronta**, é fechar o cartão.
6. **T-D9CDF8 Full-Stack — não começou.** Painel RH admin: locais, aparelhos pendentes,
   espelho, relatórios. Telas do mockup mapeadas por linha no `plano-v3.md`.

## Backend n8n — o que EU já fiz (não refazer)

Projeto `iSQtz4jYvP9BS6nf`. **Nenhum workflow ativo foi alterado. Nenhum dado do piloto
tocado.** Só criação de tabela e coluna aditiva.

Tabelas novas, vazias:
`efrat_local` `JSzppr9Wz4nj756T` · `efrat_sessao_gestor` `xUz34Fj1qC9sBwLL` ·
`efrat_limite_api` `J7ceiczp8jqyTZ3w` · `efrat_idempotencia` `mh8IzyAAG9CCFxlb` ·
`efrat_auditoria_identificacao` `ewGHLDCNzaZQpWpr`

Existentes: `efrat_dispositivo` `gFJaT1uUyeVpHC74` · `efrat_pessoa` `ZB53ZUrgAgv1u7Mg` ·
`efrat_equipe` `XukIk37upRprjTTU` · `efrat_template` `T33xTjG0vmcQlMem` ·
`efrat_marcacao` `JCv42ZfWXBk4Ut4m` · `efrat_correcao` `9TOrNN48yAmRQb31` ·
`efrat_usuario_rh` `XHDfV4ABxxq1us24`

Colunas aditivas criadas: `efrat_dispositivo` ganhou dispositivo_id, credencial_hash, estado,
codigo_curto, ua, geo, tentativas, local_id, configuracao_versao, aprovado_por, aprovado_em;
`efrat_correcao` ganhou estado, marcacao_id, valor_anterior, valor_proposto, sessao_evento;
`efrat_equipe` ganhou local_id.

**Não existe coluna `apelido`** — de propósito. Usa `descricao`, que já existia. O campo da
API continua `apelido`.

Padrão dos webhooks que funcionam, para os novos seguirem: `allowedOrigins:'*'` **no webhook**
(é o que faz o preflight OPTIONS passar; sem isso a chamada não chega e não aparece execução
no histórico — o sintoma é "sumiu", não "deu erro"); `responseCode` lendo `_status` do próprio
item; `executeOnce:true` nos Data Table que não dependem do item de entrada.

## O que ainda vai tocar a produção do cliente — combinar com ele antes

1. Publicar os 6 workflows v3 (eu faço, com `validate_workflow` + `create_workflow_from_code`).
2. **Virar `efrat/carga-v3` para `efrat/carga`.** É o corte que desliga a entrega da biometria
   da unidade inteira para cada celular. O path v3 coexiste de propósito para a virada ser
   reversível.

## Fatos que custaram caro para descobrir — não redescubra

- **O R1 está rodando em produção agora.** Li o Code node de `iykvFQQfkNv4jIxM`: ele calcula
  as unidades a partir das equipes do aparelho e devolve a unidade inteira; o filtro por
  equipe é só o campo `minha:true`, decidido no celular. Qualquer aparelho pareado hoje baixa
  nome, matrícula e biometria de toda a unidade. Não era hipótese arquitetural.
- **O bug do fail-open.** A primeira versão do fluxo novo liberava a porta quando a checagem
  de estado falhava por falta de rede, inclusive para aparelho nunca aprovado — ponto batido
  sem verificação nenhuma. Corrigido com `ultimo_estado` persistido + reconfirmação antes de
  abrir a câmera. **É o candidato número um a voltar.** Se `acesso.spec.js` não estiver
  provando isso com um teste que reprova quando o gate quebra, exija.
- **Três bugs de integração, todos a mesma família:** duas metades certas que não se conhecem.
  Fontes sem `<link>`; `servidor-falso.js` com dois donos; `fontes.css` copiado envelhecido.
  Nenhum apareceu para quem escreveu o código; nenhum teste isolado pegava. Os três viraram
  guarda de CI (3, 6, 7) e não podem voltar.
- **Tamanho de fonte é decisão de privacidade**, não estética. O aparelho é compartilhado e
  quem está atrás na fila lê a tela. Mono em todo número; corpo grande só no que é público
  por natureza (hora, contador, KPI agregado).

## Regra de condução que funcionou

O que virou teste não voltou. O que dependeu de eu lembrar, voltou. Quatro vezes.
Ao retomar: antes de aceitar qualquer cartão, pergunte "isso está provado por um teste que
alguém já viu reprovar?". Se não, o cartão não está pronto.

Não responda confirmação de recebimento entre agentes — custa contexto e não produz nada.
