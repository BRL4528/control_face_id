# Handoff — Engenheiro Full-Stack (branch c9bb844c20)

Leia primeiro `.central-agentes/handoffs/2026-08-19-orquestrador-v3.md` (branch f9024bcab1) —
contexto mestre da rodada, divisão de arquivos, decisões do cliente, IDs das tabelas n8n.

## Estado do meu branch: tudo commitado, nada pendurado

```
9abfc2a  Traz de volta o harness dos 5 critérios de segurança como tests/e2e/acesso.spec.js
6b1958f  T-607E5A: fluxo do colaborador sem token (docs/adr-acesso-v3.md)
9574f40  F1/F2 do review: linka as fontes do DevOps e extrai o tema pra css/tema.css
3ca8f61  Aplica o design aprovado (T-057A05): tokens de cor, tipografia e layout
```

`git status --short` limpo neste momento. Nenhum arquivo aberto, nenhum trabalho em voo.

## O que está pronto

- **T-057A05 (CONCLUÍDO)**: design system extraído do mockup, `css/tema.css` +
  `css/fontes.css` linkados, classes utilitárias documentadas
  (`.topbar .sidebar .nav-item .kpi .tabela .pilula .btn .num`).
- **T-607E5A (em REVISÃO, aceita pelo Orquestrador)**: fluxo v3 sem token completo —
  cadastro de aparelho (UUID + credencial 256bit), tela `#aguardando` com polling no
  intervalo do servidor, migração de token legado, fila de um botão, fallback
  `/efrat/identificar`, gancho "ver minha equipe" pro gestor. Os 5 critérios de
  privacidade/segurança do Revisor estão implementados E testados em
  `tests/e2e/acesso.spec.js` (6 testes, todos verdes; o 5b foi provado vermelho de
  propósito antes de commitar, ver mensagem do commit `9abfc2a`).
- **48/48 testes unitários passando.**
- Os 23 testes de `tests/e2e/fluxo.spec.js` estão **vermelhos de propósito** — pareamento
  foi removido, o Revisor reescreve esse arquivo. Não é regressão, não mexi nele, não
  "consertar" restaurando pareamento.

## O que falta / onde exatamente eu parei

- **T-8FB792 (EM ANDAMENTO, atribuída a mim)** — Painel do gestor por face. **Ainda não
  comecei nenhum arquivo.** Nenhuma linha escrita, nenhum arquivo tocado.
- Instruções que já recebi pra essa tarefa (do Orquestrador, ainda não lidas a fundo
  contra o ADR):
  - Ler `docs/plano-v3.md` § privacidade da tela compartilhada de novo antes de começar:
    painel NÃO abre automático (link discreto já existe em `js/fila.js`, `#linkVerEquipe`,
    hoje só mostra um toast — é o gancho a completar); quando abrir, abre **agregado**
    primeiro ("em jornada 8 · intervalo 2 · ausentes 1"); nome individual só num
    **segundo toque**; lista de **ausentes antes de presentes**; corpo pequeno em tudo
    que não for hora/contador.
  - Contrato: `POST /efrat/gestor/equipe-hoje` e `POST /efrat/gestor/ajustar` — já
    implementados no `tests/e2e/servidor-falso.js` do Arquiteto (branch `72b3e79015`),
    conferir se é a versão atual antes de codar contra ela (`git checkout
    central/50bbfbf909/72b3e79015-control_face_id -- tests/e2e/servidor-falso.js`, como fiz
    nas duas rodadas anteriores — não editar esse arquivo, é dele).
  - Ajuste do gestor é **proposta**, vira pendência do RH (`estado: pendente_rh`),
    **nunca** altera a marcação direto.
  - Sessão de gestor: veio no `resultado.sessao_gestor` da resposta de
    `/efrat/identificar` quando `papel==='gestor'` e `distancia < limiarAceite` — ainda
    não guardada/usada em lugar nenhum do client. Precisa persistir (só em memória —
    TTL de 10min absoluto / 5min inatividade é regra do ADR, não é pra persistir em
    IndexedDB) e usar como Bearer nas duas rotas novas.

## Primeira coisa a fazer ao retomar

1. Ler o handoff mestre do Orquestrador.
2. Reler `docs/adr-acesso-v3.md` § "Sessão facial do gestor" (TTLs exatos) e
   `docs/plano-v3.md` § privacidade — já lidos nesta sessão, mas relê antes de tocar
   código pra não trabalhar de memória.
3. Trazer a versão atual de `tests/e2e/servidor-falso.js` do Arquiteto (comando acima).
4. Só então abrir `js/fila.js` (onde `#linkVerEquipe` mora) e `js/rh.js` (referência de
   como uma tela de painel já é montada neste projeto) para desenhar a tela do gestor.
