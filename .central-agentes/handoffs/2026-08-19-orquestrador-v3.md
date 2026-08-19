# Checkpoint — Orquestrador — 2026-08-19

Rodada "lapidar v3": tirar o token digitado, gestor por face, RH admin, design do mockup.
Briefing unico e a fonte de verdade: `docs/plano-v3.md`.

## Concluido

| Cartao | Dono | Estado | Commit |
|---|---|---|---|
| T-66191D ADR de acesso v3 | Arquiteto | **done**, 6 emendas conferidas no diff | `8442ad4` + `35f7bbc` |
| T-0F4F85 Threat model + invariantes | Revisor | **done** | `a5a44fa` `39a13b0` `c790ebd` `6dad166` |

Decisoes do cliente, fechadas e transmitidas por broadcast:
1. **Carga escopada no servidor** por `equipes_ids`. O "buscar na unidade" offline morre;
   remanejado depende de rede via `/efrat/identificar`. Custo aceito explicitamente.
2. **Sessao do RH fica para depois.** A chave PBKDF2 como bearer eterno e divida
   documentada, ~2,5-3 dias, cartao proprio na proxima rodada. Ninguem toca `js/cripto.js`.

Correcoes de rumo que eu fiz nesta rodada, para nao se perderem:
- **R1 (do Revisor):** trocar a autenticacao do aparelho sem escopar a carga nao reduzia
  exposicao nenhuma — `fluxo-operacional.md:65` entrega a unidade inteira. Virou bloqueante.
- **Codigo de pareamento (do Revisor):** o ADR o especificava derivavel do UUID *e*
  exibido ao RH. Prova de posse era teatro. Agora CSPRNG no servidor, invisivel ao painel.
- **Oraculo do `/identificar` (meu):** faltava rate limit e resposta minima; sem isso
  refazia o R1 em formato de consulta repetivel.
- **Impacto de FLUXO nos e2e (meu):** o Revisor mediu so a troca de autenticacao (4 testes).
  `grep -c "abrirFila(page)"` = 16 → 14 testes distintos afetados. Custo real confirmado:
  1 helper novo + ajuste pontual em 5-6, porque `js/regras.js` nao muda.

## Arquivos

Cada agente no seu branch `central/50bbfbf909/<id>-control_face_id`.
- Meu (`f9024bcab1`): `docs/plano-v3.md`, este checkpoint.
- Arquiteto (`72b3e79015`): `docs/adr-acesso-v3.md`, nota v2 em `docs/api-piloto.md`.
- Revisor (`a7f15f0974`): `docs/ameacas-v3.md` (385 linhas).
- DevOps (`41fa23ad22`): `vendor/fontes/` (18 woff2), `css/fontes.css`, `vendor/chart.umd.min.js`,
  `sw.js` v6, `_headers`, `vercel.json`, `js/config.js`, `tests/unit/estaticos.test.js`.
- Full-Stack (`c9bb844c20`): T-057A05 em curso, ainda nao entregou.

**Propriedade de arquivo na fase 2, para nao colidirem:** `tests/e2e/servidor-falso.js` e do
Arquiteto; `tests/e2e/fluxo.spec.js` e do Revisor; `index.html` e `css/tema.css` sao do
Full-Stack; `sw.js`/`_headers`/`vendor/` sao do DevOps.

## Testes

Baseline confirmado por mim em worktree limpo: **47 unitarios e 23 e2e, 23/23 em 1.6 min**.
O README anuncia 19 e 37 — desatualizado, corrigir quando alguem mexer nele.
Se der `playwright: not found`, e `node_modules` ausente no worktree: `npm install` e
`npx playwright test`. Browsers ja estao no cache do sistema.

## Pendencias

- **T-97088E DevOps, devolvida para doing.** D1: fontes 224 KB contra orcamento de 180 —
  cortar `latin-ext` (~108 KB, portugues esta inteiro no subset `latin`) e IBM Plex Mono 700.
  **D2, a que importa:** a CSP nunca foi executada. Os servidores de teste nao mandam header,
  o CI roda sem politica. `vendor/face-api.js` tem runtime emscripten com `new WebAssembly.Module`
  e wasm em `data:` — sob `script-src 'self'` isso e bloqueado. Fazer os dois servidores de
  teste mandarem a CSP real do `_headers` e rodar o e2e com ela ligada; se quebrar,
  `wasm-unsafe-eval` documentado. D3: documentar no `js/config.js` que trocar `apiBase`
  agora exige editar `_headers`.
- **T-057A05 Full-Stack**, tema, em curso.
- **T-E1B1CB Arquiteto**, endpoints n8n + servidor falso, comecou agora.
- **T-64668A Revisor**, privacidade da tela compartilhada (o que quem esta atras na fila ve).
- **T-38A7C1 Revisor**, em `ready`, bloqueada de proposito ate o servidor falso falar o
  contrato novo.
- Ressalva para a implementacao no n8n: em `CODIGO_COLISAO` o servidor deve tentar outro
  codigo internamente, nao empurrar o problema para o aparelho e deixar pendente orfa.
- Backlog nao iniciado: T-607E5A colaborador sem token, T-8FB792 painel do gestor,
  T-D9CDF8 painel RH admin.

## Proximo passo

Nenhum especialista deve ser reiniciado: os quatro estao escrevendo ou rodando teste agora.
Ao retomar: colher T-97088E (as 3 correcoes) e T-057A05 (tema), conferir o diff de cada um
como fiz com o ADR, e so depois liberar T-607E5A para o Full-Stack. A fase 2 do frontend
depende do servidor falso do Arquiteto estar falando o contrato novo — cobrar isso primeiro.
