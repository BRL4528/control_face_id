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

Se você não sabe onde essa configuração está hoje, procure por
`Access-Control-Allow-Origin` no proxy na frente do n8n (nginx, Traefik,
Caddy) ou nos nós de resposta dos workflows.

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

## Quando fazer

Depois do DNS ([`dns-origem-publica.md`](dns-origem-publica.md)) e **antes** de
mandar o primeiro link para um colaborador de verdade.
