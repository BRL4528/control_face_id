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

---

# Atualizacao — integracao provada

## Branch `integra/v3`

Criado de `main`, com DevOps + Arquiteto + Full-Stack mesclados. **56 unitarios / 56 passando
e 23 e2e / 23 passando com a CSP ativa.** E a prova de que as quatro entregas compoem.

Fechou por medicao, nao por leitura, o achado 2 da auditoria de integracao: a funcao
`extrairCspDeHeaders` (nascida no branch do DevOps, absorvida pelo Arquiteto) e o teste que
a importa (`tests/unit/estaticos.test.js`, do DevOps) nunca tinham rodado juntos. Rodaram, passou.

**Conserto feito na integracao:** o Full-Stack trouxe `css/fontes.css` e os woff2 do branch do
DevOps com `git checkout`, mas pegou a versao pre-poda — 18 arquivos com `latin-ext`, 224 KB.
Reverteria o D1 em silencio, porque as duas versoes sao internamente consistentes e nenhum
teste distingue. Alinhado para 8 arquivos, 103 KB, nos commits `c4e6a97` e `aa8d8e7`.

**Nao esta em `integra/v3` ainda** (commitado depois do merge): `tests/e2e/offline.spec.js`
(24o e2e, prova offline real com `setOffline`), a guarda 6 do DevOps, os seeds do Arquiteto
(`7920cc9`) e os 3 SDKs com CORS (`89bdd89`). Re-integrar quando o proximo lote fechar.

## Cartoes concluidos (8)

ADR de acesso v3 · threat model + invariantes · privacidade da tela compartilhada ·
auditoria de integracao · fontes/CSP/cache · guardas de CI + offline · design system/tema.

## Em andamento

- **T-607E5A Full-Stack — caminho critico.** Fluxo do colaborador sem token. Todo o resto
  do Revisor depende desta tela existir.
- **T-E1B1CB Arquiteto.** 3 de 6 SDKs prontos e validados no CLI (`registrar`, `estado`,
  `carga-v3`). Faltam `identificar` e os dois de gestor. `carga-v3` usa path temporario de
  proposito, para coexistir com o ativo — a virada e combinada comigo.
- **T-38A7C1 Revisor.** Fazendo os 3 testes do RH com seed direto; o resto bloqueado pela UI.

## Licao operacional desta rodada

Tres bugs de integracao, todos da mesma familia: duas metades certas que nao se conhecem.
Fontes sem `<link>`; `servidor-falso.js` editado por dois donos; `fontes.css` copiado
envelhecido. **Nenhum apareceu para quem escreveu o codigo, e nenhum teste isolado pegava.**
Os dois que viraram teste (guarda 3 e guarda 6) nao podem voltar. O terceiro depende de eu
lembrar — e por isso vai voltar. Se sobrar orcamento, virar teste tambem: comparar
`css/`+`vendor/` entre branches antes de mesclar.

## Backend n8n — o R1 confirmado em producao

Li o Code node do workflow ativo `iykvFQQfkNv4jIxM`. Ele calcula as unidades a partir das
equipes do dispositivo e devolve `equipesUnidade`/`idsUnidade` — **a unidade inteira**, com
o filtro por equipe apenas no campo `minha:true`, decidido no cliente. O R1 do Revisor nao
era hipotese: esta escrito e rodando. `carga-v3` escopado no servidor e o conserto.

Padrao dos webhooks ativos, para os novos seguirem: `allowedOrigins:'*'` no webhook (e o que
faz o preflight OPTIONS passar — sem ele a chamada nao chega e nao aparece execucao),
`responseCode` lendo `_status` do proprio item, e `executeOnce:true` nos Data Table nodes
que nao dependem do item de entrada.
