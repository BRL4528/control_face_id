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

## Por que a Parte 1 é mais do que proteção

Síntese do Orquestrador, e ela reordena o resto deste documento.

O desenho original tinha **duas camadas com chaves diferentes**: regra de produto
na rota, chaveada no convite; e guarda de volume **fora** da aplicação, chaveada em
endereço. Quando o cliente confirmou que não há proxy, a guarda de volume foi
empurrada para dentro da rota — segunda escolha, e o teto passou a compartilhar
destino com aquilo que protege.

A Parte 1 põe a Vercel na frente exatamente das duas rotas anônimas. Ou seja: **a
Vercel passa a ser o proxy que não existia, de graça, só nas rotas que esta fase
acrescenta.** A camada de volume volta para fora da aplicação, que é onde ela
sempre devia estar. A Parte 1 não é uma proteção nova — é a arquitetura projetada
antes de sabermos da topologia.

### O que a Parte 1 NÃO toca (para ninguém se assustar)

- **`pedidos_da_mesma_rede_1h` continua válido.** O `ip_hash` que ele conta é
  gravado no **registro de aparelho**, e é exibido por `/efrat/rh/aparelhos` —
  ambas rotas do app do operador e do RH, que na Parte 1 continuam falando direto
  com o n8n. O endereço real continua chegando ali. Só a Parte 2 quebraria isso.
- **O risco do `sw.js` é exclusivo da Parte 2.** A origem pública **não tem
  service worker, por desenho** (e há guarda de CI para isso). A Parte 1 não
  encosta no handler de fetch.

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

### A armadilha de latência — é da Parte 2, não da Parte 1

`regions` tem **`iad1` (Washington) como padrão**, e o n8n está no Brasil. Sem
fixar região, cada chamada atravessaria para os Estados Unidos e voltaria.
Correção: `"regions": ["gru1"]` (São Paulo).

**Mas isso vale para Function, não para `rewrite`.** Medido na sonda: o
`x-vercel-id` da requisição proxiada veio `gru1::…`, ou seja o `rewrite` resolveu
na borda mais próxima de quem chamou e saiu do Brasil. Então a Parte 1, feita com
`rewrites`, **não tem essa armadilha** — ela aparece no instante em que o caminho
passa a ser uma Function, que é o cenário da Parte 2.

Fácil de esquecer, e o sintoma seria "o ponto ficou lento" sem causa aparente.

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

   **E o pior está uma camada acima disto.** O teste unitário que existe hoje —
   `o service worker não intercepta chamadas de outra origem` — **deixa de ser
   suficiente nesse mundo, e continua verde**. Ele afirma exatamente a propriedade
   que a mudança remove: "não intercepta outra origem" é verdadeiro e irrelevante
   quando a API passa a ser da mesma origem. Um revisor veria o teste passando e
   concluiria que a API está protegida do cache. **Não estaria.**

   É o mesmo padrão que esta fase passou a semana caçando — teste verde que não
   mede o que promete — só que projetado no futuro, num mundo que ainda não
   existe. Se a Parte 2 for aprovada algum dia, reescrever essa guarda é
   pré-requisito, não detalhe de implementação.

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

## O endereço de origem: MEDIDO, não suposto

Subi uma sonda descartável na Vercel com um `rewrite` externo, medi o que o
upstream recebe, e apaguei o projeto. O que chega de fato:

```
forwarded:               for=45.174.156.40;host=...;proto=https
x-vercel-forwarded-for:  45.174.156.40
x-vercel-proxied-for:    45.174.156.40
x-forwarded-for:         AUSENTE
x-vercel-id:             gru1::...
x-vercel-proxy-signature: Bearer <assinatura>
```

(`45.174.156.40` era o endereço público real de quem chamou, confirmado antes.)

**O endereço real do colaborador CHEGA.** Isso desmente a suposição de que o n8n
veria só o endereço da Vercel — mas com duas ressalvas que decidem o desenho:

**1. Não chega em `X-Forwarded-For`.** Chega no `Forwarded` padrão (RFC 7239) e em
cabeçalhos próprios da Vercel. A maioria dos servidores e bibliotecas — n8n
incluso, quando se liga "trust proxy" — lê `X-Forwarded-For`. Então **por padrão
o n8n não vai enxergar o endereço real**, e vai atribuir tudo a um só. Funciona,
mas só com configuração deliberada para ler `Forwarded` ou
`X-Vercel-Forwarded-For`.

**2. E ler esse cabeçalho é confiar em quem manda.** Na Parte 1 o n8n **continua
público**. Qualquer pessoa pode chamar o n8n direto, por fora da Vercel, e mandar
o `Forwarded` que quiser. Um limite chaveado nesse valor é **contornável em uma
linha de `curl`** — a menos que o n8n também verifique que a requisição veio da
Vercel.

### Conclusão para o limite por IP dentro da rota

**Ele tem de sair**, e a conclusão sobrevive à medição — mas pelo motivo certo:
não porque o endereço real não chegue (ele chega), e sim porque **na Parte 1 esse
valor é forjável**, já que o n8n segue alcançável por fora. Um limite que o
atacante escolhe a chave é pior que não ter limite, porque parece proteção.

Fica: o limite por convite na rota (não depende de endereço nenhum), mais o que a
Vercel oferece de graça na frente.

### Um achado que muda a Parte 2

A Vercel **assina** a requisição proxiada: `x-vercel-proxy-signature` e
`x-vercel-proxy-signature-ts`. Se o n8n puder verificar essa assinatura, ele
distingue "veio pela Vercel" de "veio direto" **sem segredo compartilhado e sem
Static IPs** — o que atacaria o custo de US$ 200/mês da Parte 2 pela raiz, e
também tornaria o limite por IP confiável de novo.

Registrado como **pista, não conclusão**: não confirmei como se verifica essa
assinatura nem se o esquema é documentado e estável. É a segunda pergunta para a
Vercel, junto com a dos Static IPs.

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
