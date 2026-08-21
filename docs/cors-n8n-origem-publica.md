# Folha de execução — liberar a origem pública no n8n (CORS)

Para quem administra o n8n. **Isto é obrigatório.** Sem ele a página de cadastro
de rosto abre normalmente e não consegue salvar uma única foto — e falha
**calada**: o erro aparece só no console do navegador do colaborador, não em log
do n8n, e o deploy continua verde.

## A boa notícia: você já faz isso hoje

O aplicativo de ponto **já** chama o n8n de outro endereço
(`https://n8n.samasc.com.br` é um host, o app é outro), então CORS já está
configurado e funcionando para ele. O que falta é **acrescentar um endereço à
lista que já existe** — não montar CORS do zero.

Como **não há proxy** na frente do n8n (confirmado por você), essa
configuração está no próprio n8n: na opção **Allowed Origins (CORS)** do nó
Webhook de cada rota, ou nos cabeçalhos que os nós de resposta devolvem. É lá que
o endereço novo entra — não há camada intermediária onde mexer.

## Os dois valores

| | |
|---|---|
| Endereço novo a liberar | `https://ORIGEM-PUBLICA-A-DEFINIR` |
| Endereço já liberado hoje | o do aplicativo de ponto — **mantenha** |

Com esquema (`https://`) e sem barra no final. `https://exemplo.com.br` e
`https://exemplo.com.br/` não são a mesma coisa para o navegador.

## Quais rotas

Só duas — as que a página pública chama:

| Rota | Método |
|---|---|
| `/webhook/efrat/face/convite/abrir` | `POST` e `OPTIONS` |
| `/webhook/efrat/face/convite/enviar` | `POST` e `OPTIONS` |

As outras rotas (`/efrat/rh/*`, `/efrat/marcacoes`, `/efrat/carga`, …) **não**
devem ser liberadas para esta origem: a página pública não tem nada que fazer
nelas. Liberar só as duas é parte da proteção, não excesso de zelo.

## O que responder

### 1. Ao `OPTIONS` (o "preflight")

Antes do `POST`, o navegador manda sozinho um `OPTIONS` na mesma URL. Se ele não
for respondido, **o `POST` nunca sai** — e o seu log não registra nada, porque a
requisição real não aconteceu.

Responda `204` (ou `200`), com corpo vazio e estes cabeçalhos:

```
Access-Control-Allow-Origin: https://ORIGEM-PUBLICA-A-DEFINIR
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, Idempotency-Key
Access-Control-Max-Age: 600
Vary: Origin
```

`Idempotency-Key` e `Authorization` **precisam** estar na lista: a página envia
os dois, e um cabeçalho não listado derruba o preflight inteiro.

### 2. Ao `POST`

```
Access-Control-Allow-Origin: https://ORIGEM-PUBLICA-A-DEFINIR
Vary: Origin
```

## Três regras que não são detalhe

**1. Lista de endereços, nunca `*`.** Com `*`, qualquer site da internet pode
mandar requisição para essas rotas com um token que tenha vazado. Com a lista,
só as nossas páginas podem. Havendo mais de um endereço permitido, compare o
`Origin` recebido com a lista e **devolva o valor recebido** — `Allow-Origin`
aceita um endereço só por resposta, não uma lista.

**2. `Vary: Origin` sempre.** Sem ele, um cache ou CDN entre o navegador e o n8n
guarda a resposta com o `Allow-Origin` de *outra* origem e serve para todos. O
sintoma é o pior possível: funciona para uns e falha para outros, sem padrão.

**3. Não mande `Access-Control-Allow-Credentials`.** O token vai no cabeçalho
`Authorization`, não em cookie. Ligar credenciais aumenta a superfície de ataque
sem comprar nada aqui — e é incompatível com `*`, o que costuma virar a
justificativa errada para afrouxar a lista.

## Como você confirma que aplicou certo

Rode daí, sem navegador. O primeiro é o que mais importa: é o preflight.

```bash
# 1. o OPTIONS é respondido e libera a origem nova?
curl -si -X OPTIONS \
  https://n8n.samasc.com.br/webhook/efrat/face/convite/abrir \
  -H 'Origin: https://ORIGEM-PUBLICA-A-DEFINIR' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type,authorization,idempotency-key' \
  | grep -iE '^HTTP/|access-control-|vary'
```

Esperado — as quatro linhas:

```
HTTP/2 204
access-control-allow-origin: https://ORIGEM-PUBLICA-A-DEFINIR
access-control-allow-methods: POST, OPTIONS
access-control-allow-headers: Content-Type, Authorization, Idempotency-Key
vary: Origin
```

Leitura dos erros:

| O que você vê | O que significa |
|---|---|
| `404` ou `405` | o `OPTIONS` não está sendo tratado nessa rota — a página não vai funcionar |
| `200`/`204` sem nenhum `access-control-` | a rota responde, mas não libera nada |
| `access-control-allow-origin: *` | funciona, mas contraria a regra 1 — corrija |
| falta `idempotency-key` na lista | `abrir` funciona e **`enviar` falha** — o erro aparece só no envio das fotos |
| sem `vary: origin` | funciona hoje e falha de forma intermitente depois |

```bash
# 2. a mesma coisa na rota de envio (é a que tem Idempotency-Key)
curl -si -X OPTIONS \
  https://n8n.samasc.com.br/webhook/efrat/face/convite/enviar \
  -H 'Origin: https://ORIGEM-PUBLICA-A-DEFINIR' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type,authorization,idempotency-key' \
  | grep -iE '^HTTP/|access-control-'

# 3. o POST de verdade também devolve o cabeçalho?
#    401/403 aqui é NORMAL e é sucesso para este teste: o token é inventado.
#    O que importa é a linha access-control-allow-origin estar presente.
curl -si -X POST \
  https://n8n.samasc.com.br/webhook/efrat/face/convite/abrir \
  -H 'Origin: https://ORIGEM-PUBLICA-A-DEFINIR' \
  -H 'Authorization: Bearer token-de-teste-invalido' \
  -H 'Content-Type: application/json' -d '{}' \
  | grep -iE '^HTTP/|access-control-allow-origin'

# 4. uma origem que NÃO está na lista continua barrada?
#    Este é o teste de que a lista é lista, e não `*`.
curl -si -X OPTIONS \
  https://n8n.samasc.com.br/webhook/efrat/face/convite/abrir \
  -H 'Origin: https://sitequalquer.exemplo' \
  -H 'Access-Control-Request-Method: POST' \
  | grep -i access-control-allow-origin
#    esperado: NADA, ou um endereço que não seja sitequalquer.exemplo.
#    Se ecoar `https://sitequalquer.exemplo`, a lista não está sendo conferida.
```

Passando os quatro, está aplicado. O teste 4 é o único que a maioria esquece, e é
o que diferencia lista de `*`.

## Não há proxy na frente do n8n: o que isso significa

Você confirmou que o n8n responde direto, sem proxy. Isso simplifica o passo
acima — não há duas camadas para manter em acordo. Vale registrar o outro lado,
porque esta fase muda uma coisa: **até agora todo mundo que chamava o n8n era um
aparelho de operador com credencial. A página de cadastro de rosto é a primeira
superfície pública do produto apontada para essa instância** — uma URL que
qualquer pessoa com o link abre.

### O que não existe hoje, em termos diretos

- **Não há WAF.** Não existe camada que recuse requisição por endereço, padrão ou
  volume *antes* de chegar ao n8n. Toda recusa é decisão de workflow, ou seja
  acontece depois que o n8n aceitou a conexão e começou uma execução.
- **Não há limite de volume independente da aplicação.** O teto que protege o n8n
  roda dentro do n8n. Ele impede abuso de *regra* — um link vazado sendo
  reenviado — e não impede esgotamento de *recurso*, porque cada recusa ainda
  custa uma execução.
- **Não há botão de desligar só o tráfego ruim.** O que existe é desativar
  workflow, que também para o tráfego bom daquele workflow.

Nada disso é defeito de instalação. É a topologia que você tem, e para um piloto
pode ser exatamente a escolha certa. O que segue é para você reconhecer o quadro
se acontecer, não para te convencer de nada.

### O que você veria, se a instância fosse inundada

- A lista de execuções do n8n enchendo com a mesma rota, e a fila crescendo.
- **O ponto continua sendo registrado.** O aplicativo do operador é offline-first:
  sem resposta do servidor, a marcação fica na fila do próprio aparelho e sincroniza
  depois. Você não perde marcação por causa disso — é o que o desenho já protege.
- **O painel do RH fica inutilizável**, e o sincronismo das marcações atrasa. É
  aqui que dói primeiro.
- A página de cadastro de rosto falha ao abrir ou ao enviar as fotos, e o
  colaborador liga para o RH — o canal que a fase está tentando desafogar.
- **Se essa instância de n8n roda outros workflows da empresa, eles degradam
  junto.** O alcance não para no produto de ponto.
- O histórico de execuções cresce rápido. Guardar cada execução de uma inundação
  é, com frequência, o que enche o disco antes de qualquer outra coisa.

### O que você poderia fazer no mesmo dia

1. **Desativar só os dois workflows do convite.** Isso remove a superfície pública
   e **o aplicativo do operador continua funcionando** — as rotas dele são outras.
   É o motivo prático de as rotas do convite serem separadas, e é o seu botão de
   emergência: custa nada e já está pronto. Vale saber onde ele fica antes de
   precisar.
2. **Revogar os convites em aberto** (`/efrat/rh/face/convite/revogar`), para que
   nenhum link já enviado continue valendo.
3. **Reduzir o custo por requisição:** desligar ou reduzir a gravação de execuções
   e limpar o histórico. Não estanca a entrada, mas compra tempo de disco.
4. **Último recurso:** tirar o nome do ar no DNS. Para tudo, inclusive o
   aplicativo do operador. Só faz sentido se o resto não bastou.

### Um caminho barato e reversível, se você quiser um

Existe, e o custo é honesto. **Não é recomendação** — é para você comparar.

A página de cadastro já vive num projeto da Vercel. Dá para fazer **as duas rotas
do convite passarem por lá** em vez de irem direto ao n8n: são duas regras de
`rewrites` no `publico/vercel.json` apontando para o endereço do n8n (a
documentação da Vercel permite destino em URL externa). Não vira projeto novo,
não move dado nenhum, e **só as duas rotas do convite** mudam de caminho — o
aplicativo do operador continua falando direto com o n8n, igual a hoje.

O que isso te daria:

- Mitigação automática de DDoS, bloqueio por IP e regras próprias — **gratuitos em
  todos os planos** da Vercel. Tráfego barrado nessa camada não conta como
  requisição nem como transferência.
- **O passo de CORS acima deixa de existir para a página pública**, porque as
  chamadas passam a ser da mesma origem dela.
- Limite de volume (*rate limiting*) da Vercel: existe, mas é **recurso pago** —
  ao contrário dos três acima.

O que isso te custaria:

- Essas requisições passam a contar no uso da Vercel. O envio das fotos carrega
  três imagens em base64, ou seja **megabytes por cadastro** — hoje esse tráfego
  vai direto para o n8n e não passa por lá.
- Um salto de rede a mais, portanto um pouco mais de latência no cadastro.
- **Atenção ao endereço de origem, e isto precisa ser verificado antes de
  confiar:** com a Vercel no meio, o n8n passa a ver o endereço *dela*, não o do
  colaborador — a menos que o endereço real venha repassado em cabeçalho e o n8n
  seja configurado para lê-lo. Duas coisas dependem disso: o limite de volume por
  IP dentro da rota, e o aviso de "muitos pedidos da mesma rede" na tela do RH.
  Ambos passariam a ver um endereço só. Um `curl` pelo caminho novo, olhando o que
  o n8n registra como origem, resolve a dúvida — não assuma nem que funciona nem
  que não.
- Reverter é apagar as duas regras e devolver o CORS. Nada migra.

### Se você não fizer nada

É uma escolha legítima para um piloto, e fica mais confortável quanto mais destes
for verdade: o volume esperado é baixo e conhecido, os links de cadastro saem em
lotes pequenos e controlados pelo RH, e essa instância de n8n **não** hospeda
outros processos críticos da empresa. Fica menos confortável na medida em que
qualquer um dos três não valer.

## Quando fazer

Depois do DNS ([`dns-origem-publica.md`](dns-origem-publica.md)) e **antes** de
mandar o primeiro link para um colaborador de verdade.
