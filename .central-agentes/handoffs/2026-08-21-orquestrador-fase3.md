# Checkpoint · Orquestrador · FASE 3 (21/08/2026)

## Concluído neste ciclo

- Worktree trazido de `main` para **`integra/v3-r3`** (estava 81 commits atrás).
- App rodando no servidor falso; **59/59 unitários** verdes.
- **Causa do bloqueio do cliente encontrada**, e não é o navegador da Central:
  o produto nasce trancado. O aparelho pede liberação ao RH e **não existe rota
  nem tela onde o RH libere** — `ApiRh` (js/api.js:39) tem sal/dados/equipe/
  colaborador/decidir e nada de aparelhos; as abas do painel (js/rh.js:74) são
  painel/pendências/pessoas/equipes/registros. Daí a tela "Aguardando liberação
  do RH" pedir uma ação sem contraparte, e o fluxo do colaborador e do gestor
  ser inalcançável no navegador.
- Demanda do cliente especificada e commitada em `docs/fase3-rh-pessoas.md`
  (commit `fdd1ea8`, já em `integra/v3-r3`), com 6 decisões fechadas.
- Sexto membro aberto na grade: **Designer de Interface e Texto** (`750f40fef8`),
  justificado pelo requisito explícito de texto e layout profissionais para leigos.
- Seis cartões criados; quatro despachados com brief completo.

## Arquivos

- `docs/fase3-rh-pessoas.md` — novo, fonte única da fase.
- Nada mais tocado pelo Orquestrador. `js/`, `index.html`, `tests/` estão com o
  Full-Stack; `vercel.json`, `_headers`, `sw.js`, `.github/` com o DevOps.

## Testes

`npm run test:unit` → 59 pass / 0 fail. E2E não rodado neste ciclo (exige
`npm install` do Playwright; `node_modules` está vazio no worktree).

## Em andamento (não reiniciar enquanto escrevem)

- T-87615C · Full-Stack · liberação de aparelho + tela de espera + e2e do ciclo.
- T-65D806 · Arquiteto · contrato de dados e rotas (doc).
- T-AED04B · QA/Security · threat model do link público (doc).
- T-AABCC9 · DevOps · CSP, cache, rota e guarda de CI; fecha também T-B1D7F6.
- Designer · `docs/fase3-interface-e-texto.md`.

## Pendências

- T-8188C6 (equipes com membros, colaborador com telefone e edição) e T-D30529
  (face por link / câmera do PC / 3 fotos) ficam em **backlog de propósito**:
  destravam quando o contrato T-65D806 chegar em review.
- Flag **NAVEGADOR** desabilitada para o Orquestrador (`522882f9d7`) — sem ela eu
  não abro o app no navegador embutido para conferir na mão.
- T-8FB792 e T-38A7C1 seguem em andamento da FASE 2; conferir se colidem com a 3.

## Próximo passo

Receber os quatro relatórios, ler o contrato do Arquiteto contra o threat model do
QA antes de liberar T-8188C6 e T-D30529, e rodar o e2e do ciclo de liberação —
é ele que prova ao cliente que a tela do colaborador ficou alcançável.
