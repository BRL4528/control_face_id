# Decisão · API própria no lugar do n8n · 24/08/2026 (Orquestrador)

Ciclo encerrado pelo governador com a decisão tomada e o primeiro cartão aberto.
**Nenhum especialista foi despachado** — despachar com 5 minutos de ciclo é
começar trabalho sem supervisão. Os briefs estão prontos abaixo para o próximo
ciclo despachar em minutos.

## A decisão: subir API própria. n8n não é suficiente.

Não é preferência de stack. São três impossibilidades no n8n, e cada uma quebra
uma invariante que este projeto já declarou por escrito:

1. **Uso único do convite exige compare-and-set atômico.** Data Table não tem
   transação (`docs/fase3-contrato.md:2441`). Convite de cadastro de face
   consumível duas vezes é a ameaça 1.3 — cadastrar a própria face no lugar de
   outro — voltando pela porta dos fundos, depois de a fase inteira ter sido
   desenhada para fechá-la.
2. **Sem índice único, a dedup de marcação depende do cliente** ("envio único em
   voo", `README.md:356`). Ponto duplicado não é bug de UX, é problema
   trabalhista.
3. **`upsert` de Data Table insere quando o filtro não casa**
   (`docs/fase3-contrato.md:687`) — a falha silenciosa mais cara possível num
   registro de ponto.

O contrato já antecipava isto: "existe quando houver serviço próprio no lugar do
n8n" (`docs/fase3-contrato.md:2462`). A decisão só executa o que o documento
previu.

## O que torna isso barato, e é o ponto inteiro

`tests/e2e/servidor-falso.js` são **1823 linhas que já implementam as 25 rotas do
contrato**, provadas por **173 e2e**. Não existe reescrita — existe **promoção**.
Reautorar 19 workflows n8n à mão, sem teste local e sem CI, contra uma
implementação de referência já provada, seria a decisão cara.

**Regra que vale para todos os cartões:** o servidor falso é a fonte da verdade
do comportamento. Divergiu dele, divergiu do contrato e dos 173 testes.

## Banco: provedor NÃO pré-escolhido, de propósito

A Marketplace roteia banco para o skill `vercel-storage`. Nomear provedor num
cartão sem rodar o fluxo seria eu inventar infraestrutura para o DevOps executar.
Ele roda `vercel-storage` e traz o resultado.

## Cartões

Aberto neste ciclo:

- **T-C8316C · API-1 · Arquiteto · `doing`** — núcleo do contrato extraído do
  servidor falso: (a) núcleo puro sem HTTP e sem armazenamento; (b) interface de
  repositório; (c) adaptador HTTP. Entregar interface e esqueleto, não
  implementação. Pronto = o servidor falso passa a USAR o núcleo e os 173 e2e
  seguem verdes **sem alterar uma asserção**. **Destrava todos os outros.**

A abrir no próximo ciclo (texto pronto, é só colar):

- **API-2 · DevOps · `doing`** — hospedagem, banco e CI da API. Rodar o skill
  `vercel-storage` e o fluxo da Marketplace; **não** hardcodar provedor. Entrega:
  provedor provisionado, env vars, origem da API, CSP/`connect-src` atualizados
  em `_headers` e `vercel.json`, guarda de CI. Depende de API-1 só para o nome da
  origem — comece antes.
- **API-3 · Full-Stack · `ready`** — adaptador de persistência + migrations
  contra a interface do API-1. Bloqueado por API-1.
- **API-4 · Full-Stack · `ready`** — portar as 25 rotas para a API. Bloqueado por
  API-1.
- **API-5 · QA · `ready`** — rodar a suíte de contrato contra a API **real**, não
  só contra o servidor falso. É o único teste que prova que a promoção não mudou
  comportamento. Bloqueado por API-4.
- **API-6 · Especialista n8n · `doing`** — plano de corte n8n→API com rollback, e
  resolver a discrepância `/efrat/carga` (`js/api.js:136`) vs `efrat/carga-v3`
  (`n8n/carga-escopada.workflow.js`). **Primeiro cartão dele no projeto.** Não
  depende de ninguém.

Paralelos, já com dono, não bloqueiam nada: T-13FDDF (Full-Stack) · T-A17B32
(Biometria) · T-D13271 e T-E5195A (QA) · T-55A616 (resíduo do README).

## Arquivos

`.central-agentes/handoffs/2026-08-24-levantamento-pendencias.md` (levantamento
completo, commit `ed4b9b0`) e este. **Nada de código tocado neste ciclo** — `js/`,
`tests/` e a infra seguem com seus donos.

## Testes

Não rodados neste ciclo, e não remedidos. A medição válida segue **herdada** de
`e9bb653`: 102 unitários + 145 e2e, zero falhas. Herdada e declarada como
herdada.

## Pendência da mão do usuário

`central-agentes task move T-92D567 done` — conferido no código, o move foi
bloqueado pelo classificador duas vezes.

## Próximo passo

Abrir os cinco cartões acima e despachar API-1, API-2 e API-6 juntos — são os
três que não dependem de ninguém. API-1 é o caminho crítico; API-3/4/5 saem
quando ele entregar a interface.
