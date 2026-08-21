# Pôr a Vercel na frente do n8n — custo e viabilidade

Ideia do Arquiteto (contexto: o cliente confirmou que **não há proxy**, então o
limitador de volume compartilha destino com o que protege). Este documento é
**custo e viabilidade, não recomendação**. Números da documentação da Vercel,
consultada em 21/08/2026, não de memória.

## Resumo em três linhas

1. **Passar as duas rotas anônimas do convite pela Vercel: barato, incremental e
   reversível.** Duas regras de `rewrites`. Não requer nada pago.
2. **Tirar o n8n da internet pública: caro e tudo-ou-nada.** Exige *Static IPs*
   (**US$ 100/mês por projeto**, e temos dois projetos), força usar Function em vez
   de `rewrites`, e obriga a mexer no `sw.js` sob pena de bug silencioso em
   marcação de ponto.
3. As duas coisas são **independentes**. A 1 não é o primeiro passo da 2 — a 2
   troca o mecanismo.

---

## Parte 1 — Só as rotas do convite (n8n continua público)

**Mecanismo:** duas regras de `rewrites` em `publico/vercel.json` com destino em
URL externa (a documentação confirma: `destination` aceita "an absolute pathname
or external URL").

**Custo:** nenhuma taxa. As requisições passam a contar como CDN Requests e Fast
Data Transfer da Vercel. O envio do convite carrega três fotos em base64 —
**megabytes por cadastro** — e esse tráfego hoje vai direto para o n8n.

**O que ganha:** mitigação automática de DDoS, bloqueio por IP e regras próprias,
**gratuitos em todos os planos**; tráfego barrado nessa camada não conta como
requisição nem transferência. *Rate limiting* da WAF existe, mas é **recurso
pago**. E o CORS da página pública desaparece, porque as chamadas viram mesma
origem.

**O que NÃO ganha:** nada para as rotas do app do operador, que continuam diretas.

**Reversível:** apagar duas regras e devolver o CORS. Nada migra.

---

## Parte 2 — Tirar o n8n da internet pública

### O mecanismo obrigatório, e o preço

Para o n8n aceitar só a Vercel, ele precisa de um conjunto **estável** de
endereços de origem para permitir. Por padrão a Vercel tem IP de saída dinâmico. A
opção documentada é **Static IPs**:

| | |
|---|---|
| Planos | Pro e Enterprise |
| Preço | **US$ 100,00/mês por projeto** + *Private Data Transfer* a preço regional |

**Por projeto.** Temos dois (app do operador e origem pública). Se os dois têm de
alcançar um n8n fechado, são **US$ 200/mês** mais transferência.

*Secure Compute* (VPC dedicada, peering) e *Bring Your Own Cloud* são **add-on de
Enterprise** — fora de escopo para este piloto.

### Isto força Function em vez de `rewrites` — e é o ponto que mais muda o custo

Duas consequências que andam juntas:

- **`rewrites` não injeta cabeçalho de requisição.** A chave `headers` do
  `vercel.json` adiciona cabeçalho **na resposta**, não no pedido que sai para o
  upstream. Logo um `rewrite` não consegue carregar um segredo compartilhado nem
  aplicar lógica de limite.
- **Static IPs é descrito em termos de Functions** ("data transfer costs kick in
  for all traffic to or from your Vercel Functions"). Um `rewrite` puro resolve na
  borda.

> **A confirmar com a Vercel antes de qualquer compromisso:** um `rewrite` externo
> sai pelos Static IPs, ou só uma Function sai? Todo o modelo de custo depende
> disso. Não achei a resposta na documentação e **não vou supor**. Se só a Function
> sair pelos IPs fixos, a Parte 2 obriga escrever e manter código de proxy — com
> invocação, Active CPU e transferência por chamada, para *todo* o tráfego do
> produto, inclusive marcação de ponto.

### A armadilha de latência, confirmada na documentação

`regions` **tem `iad1` (Washington) como padrão**. O n8n está no Brasil. Sem fixar
região, cada chamada atravessaria para os Estados Unidos e voltaria. Correção:
`"regions": ["gru1"]` (São Paulo). Barato de fazer, fácil de esquecer, e o sintoma
seria "o ponto ficou lento" sem causa aparente.

### O que quebra no app do operador — e o risco sério está no `sw.js`

Hoje o app fala direto com o n8n (`apiBase` em `js/config.js`). Com o n8n fechado,
**todas** as rotas do operador têm de passar pelo proxy. Isso implica:

1. `apiBase` passa a apontar para a própria origem do app.
2. A CSP pode **soltar** o host do n8n de `connect-src` — isso é um ganho, fecha
   mais a política.
3. **`sw.js` precisa de desvio explícito para a API, senão vira bug de dados.** O
   handler de fetch hoje deixa passar tudo que não é da mesma origem
   (`if (url.origin !== location.origin) return`) — e é exatamente isso que hoje
   mantém a API fora do cache. O comentário no topo do arquivo diz por quê:
   *"As chamadas de API nunca passam por aqui: resposta de marcação em cache seria
   mentira sobre o que o servidor recebeu."*

   Tornando a API **mesma origem**, ela cai no handler, que é **cache-first**.
   Sem um desvio novo, uma resposta de marcação poderia ser servida do cache —
   o app diria "registrado" para algo que o servidor nunca recebeu. É a pior
   classe de defeito que este produto pode ter, e não faria barulho.

   O teste unitário que existe hoje (`o service worker não intercepta chamadas de
   outra origem`) **deixa de ser suficiente** nesse mundo: ele afirma justamente a
   propriedade que a mudança remove.

### Incremental?

- **Parte 1: sim.** Duas rotas anônimas primeiro, resto igual, reversível.
- **Parte 2: não.** No instante em que o n8n fecha, todo chamador tem de estar
  passando pelo proxy. Não há meio-caminho: um cliente que ficou de fora
  simplesmente para de funcionar.

### Reversibilidade e risco corrente

Reverter é configuração, não migração — mas a Parte 2 cria duas coisas que não
existiam: uma **dependência dura** (proxy ou Vercel fora = nenhum aparelho fala
com o servidor; a fila offline absorve marcação, o painel do RH não) e um **custo
mensal recorrente**. E se o conjunto de Static IPs mudar sem o n8n ser atualizado,
o n8n recusa tudo.

---

## Verificar ANTES de decidir: o endereço de origem

Vale para a Parte 1 e para a Parte 2, e é o item que mais pode mudar a decisão.

Com a Vercel no meio, **o n8n passa a ver o endereço dela**, não o do colaborador
— a menos que o endereço real venha repassado em cabeçalho (`X-Forwarded-For`) e o
n8n esteja configurado para lê-lo e confiar nele.

Duas coisas que a equipe acabou de decidir dependem disso:

- o **limite de volume por IP dentro da rota** (o limite generoso, que substituiu
  o limite apertado por IP justamente por causa de NAT de operadora);
- o aviso de **`pedidos_da_mesma_rede_1h`** na tela do RH.

Se o endereço real não chegar, os dois passam a ver **um endereço só, para todo
mundo**. O limite por IP vira um limite global compartilhado por todos os
colaboradores, e o aviso de "muitos pedidos da mesma rede" acende sempre. É
**exatamente o mesmo modo de falha** que fez a equipe rejeitar chavear por IP em
população com NAT de operadora — o caminho barato o reintroduz por outra porta.

Não afirmo que quebra nem que funciona: não encontrei documentação que fechasse a
questão para `rewrite` externo. Um `curl` pelo caminho novo, olhando o que o n8n
registra como origem, resolve em minutos. **Essa verificação vem antes da decisão,
não depois dela.**

## Um meio-caminho mais barato, para comparação

Function na frente adicionando um **segredo compartilhado** em cabeçalho, e o n8n
recusando quem não o traz. Custa **US$ 0 de rede** — sem Static IPs.

O que compra: nenhuma requisição anônima chega a executar workflow.
O que **não** compra: o n8n continua aceitando conexão, portanto uma inundação
determinada ainda consome recurso dele. Recusa barata não é recusa gratuita.

Ou seja: resolve abuso, **não** resolve volume — que é exatamente o que a ideia do
Arquiteto queria resolver. Registro por honestidade de opções, não como
equivalente.

## Uma observação de proporção

As rotas do operador exigem credencial de aparelho; as do convite são **anônimas**.
O que esta fase acrescenta de exposição é a superfície anônima. A Parte 1 cobre
exatamente essa superfície, de graça e reversível. A Parte 2 estende a proteção às
rotas que já exigem credencial, ao preço de US$ 200/mês, de código de proxy no
caminho da marcação de ponto, e de uma mudança no `sw.js` que, se feita errada,
mente sobre ponto registrado.

Fato, não recomendação: a decisão é do cliente.
