# FASE 3 · O RH administra pessoas

Demanda do cliente (21/08/2026). Empresa de engenharia, usuários leigos.
Este documento é a fonte única da fase: todo brief da equipe aponta para cá.

## Diagnóstico de abertura: por que a tela diz "Aguardando liberação do RH"

No v3 o aparelho não pede token: no primeiro acesso ele gera a própria identidade
(UUID + credencial de 256 bits) e **pede liberação ao RH** (`docs/adr-acesso-v3.md`).
A tela de espera mostra um código curto para o RH conferir.

**O problema:** não existe, em nenhum lugar, a tela onde o RH libera.
`ApiRh` tem `sal`, `dados`, `equipe`, `colaborador`, `decidir` — e nada de aparelhos.
O painel do RH tem as abas `painel · pendências · pessoas · equipes · registros`;
nenhuma delas lista aparelho pendente.

Consequência: **o app nasce trancado.** Quem abre no navegador fica na tela de
espera para sempre e a tela do colaborador e a do gestor são inalcançáveis. Não é
o navegador da Central que bloqueou o teste — é o produto.

Isso também explica por que o texto não se entende: ele pede uma ação ("mostre
este código para o RH") que não tem contraparte. Some-se que "liberação" e
"aparelho" são vocabulário nosso, não do eletricista que vai bater ponto.

## O fluxo que o cliente pediu

```
RH  ─┬─ Equipes      → cria equipe · abre a equipe · vê membros · adiciona · remove
     ├─ Colaboradores→ cadastra · edita · vincula equipe · define papel · TELEFONE
     │                 └─ cadastro de face por 3 caminhos:
     │                    1. link enviado ao celular do colaborador
     │                    2. câmera do PC, ali na tela do colaborador
     │                    3. upload de 3 fotos do colaborador
     └─ Aparelhos    → libera o aparelho que vai bater ponto   (faltava: destrava tudo)
```

## Lacunas, item por item

**A · Aparelhos (crítico, destrava o resto).** Aba nova no RH: aparelhos pendentes
com o código que a tela de espera exibe, aprovar / recusar / revogar; aparelhos
aprovados com último uso. Rotas novas no n8n e no servidor falso. A tela de espera
ganha texto de gente e um caminho visível para quem é do RH.

**B · Equipes.** Hoje a aba só cria equipe e conta pessoas. Falta abrir a equipe,
ver os membros, adicionar e remover membro, editar nome/unidade, inativar.

**C · Colaboradores.** Hoje só cria (nome, matrícula, equipe, papel). Falta:
- **telefone** — obrigatório: é por ele que o colaborador fala com o RH;
- **edição** do cadastro já existente, hoje inexistente;
- inativar e reativar sem apagar histórico;
- ver o detalhe da pessoa em vez de só a linha da lista.

**D · Cadastro de face, três caminhos.**
1. **Link para o celular.** Página pública mínima, uma pessoa por link, uso único,
   validade curta, revogável, sem dado pessoal na URL. Não é o app do operador:
   não vê IndexedDB, não vê painel, não vê ninguém além de si.
2. **Câmera do PC**, na própria tela do colaborador, para quem está ali na sala.
3. **Upload de 3 fotos.** Exatamente três, um rosto em cada. As três têm de ser a
   mesma pessoa — divergência acima do limiar de aceite recusa o lote em vez de
   gravar um template sujo. Referências medidas em `docs/validacao-biometrica.md`:
   mesma pessoa em pose diferente 0,094 · pessoas diferentes 0,61 e 0,80 · aceite 0,45.

**E · Acabamento profissional.** Texto sem jargão nosso, estado vazio que ensina o
próximo passo, erro que diz o que fazer e não só o que falhou, layout igual em
todas as abas. O usuário é leigo e o aplicativo é de trabalho, não de tecnologia.

## Decisões já tomadas (não reabrir sem motivo novo)

1. **Telefone é obrigatório** no cadastro de colaborador, validado no cliente e no
   servidor. Sem ele o canal com o RH não existe.
2. **O link de face é uma página separada**, fora do app do operador. Um alvo
   público dentro do app do RH seria a maior superfície de ataque do produto.
3. **Uso único e validade curta** para o link, com revogação pelo RH.
4. **Três fotos, coerência verificada** antes de gravar template.
5. **Papéis seguem dois** — colaborador e gestor. Papel novo só com pedido novo.
6. **A liberação de aparelho vem primeiro.** Sem ela nada do resto pode ser testado
   por quem pediu.
