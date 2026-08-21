# Folha de execução — DNS da origem pública

Para quem opera a zona de DNS. **Um registro.** Cinco minutos, mais o tempo de
propagação.

## Antes de começar, dois valores

| | |
|---|---|
| Subdomínio escolhido | `ORIGEM-PUBLICA-A-DEFINIR` |
| Domínio | a zona onde o registro vai entrar |

`ORIGEM-PUBLICA-A-DEFINIR` é placeholder de propósito: enquanto a string não for
decidida, ela não está escrita em nenhum arquivo de código.

**Atenção:** este é um subdomínio **novo**, diferente do endereço onde o
aplicativo de ponto já roda hoje. São dois endereços distintos de propósito — o
motivo está na seção seguinte. O registro abaixo é só para o endereço novo; **não
mexa no endereço do aplicativo**.

## Por que existe um subdomínio novo

A página onde o colaborador cadastra o rosto **não pode** ficar no mesmo endereço
do aplicativo de ponto. Não é preferência de organização: o navegador separa
dados guardados por **endereço**, não por pasta. No mesmo endereço, aquela página
alcançaria a credencial do aparelho que bate ponto. Em endereço próprio, não
alcança — e não é preciso confiar em nenhuma regra de configuração para isso.

---

## Caminho curto — se os nameservers do domínio já são da Vercel

**Nada a fazer.** A Vercel cria o registro sozinha quando adicionarmos o domínio
ao projeto. Vá direto para *Como confirmar*.

Para saber em que caso você está:

```bash
dig +short NS SEUDOMINIO
```

Se a resposta contiver `vercel-dns.com`, é o caminho curto.

---

## Caminho normal — um CNAME

Na zona do domínio, crie:

| Campo | Valor |
|---|---|
| Tipo | `CNAME` |
| Nome / Host | só o subdomínio (ex.: `cadastro`) — **não** o domínio inteiro |
| Valor / Aponta para | `cname.vercel-dns.com` |
| TTL | o padrão do painel |
| Proxy / CDN | **desligado** (ver abaixo) |

Nada além deste registro.

### Certificado HTTPS: não faça nada

Não precisa comprar, gerar, enviar nem instalar certificado. A Vercel emite e
renova sozinha depois que o CNAME resolve. Sem custo. Se alguém sugerir subir um
certificado manualmente, não é necessário.

### Se a zona está no Cloudflare — o erro mais comum

O registro tem de ficar **DNS only**: ícone de nuvem **cinza**, não laranja.

Com o proxy ligado (nuvem laranja), acontece um destes dois, e nenhum diz
claramente que a causa é o proxy:

- **O certificado nunca fica pronto.** No painel da Vercel o domínio fica preso
  em "Invalid Configuration" ou em emissão perpétua. Causa: o desafio de emissão
  é respondido pelo Cloudflare, não pela Vercel, e a validação não fecha.
- **O site abre, mas errado** — 404, ou a página de outro projeto. Causa: o
  proxy reescreve o cabeçalho `Host`, e é por ele que a Vercel decide qual
  projeto responde.

Correção: abrir o registro e desligar o proxy. Depois, aguardar alguns minutos.

## Como confirmar

Na ordem. Se um passo falhar, não siga para o próximo.

```bash
# 1. o nome resolve e aponta para a Vercel?
dig +short ORIGEM-PUBLICA-A-DEFINIR
#    esperado: um CNAME/endereço da Vercel. Vazio = registro não criado ou
#    ainda propagando.

# 2. o HTTPS responde com certificado válido?
curl -sI https://ORIGEM-PUBLICA-A-DEFINIR/ | head -1
#    esperado: HTTP/2 200
#    erro de certificado = certificado ainda não emitido; se persistir mais de
#    ~15 min, quase sempre é o proxy do Cloudflare ligado.

# 3. é o projeto certo que está respondendo?
curl -s https://ORIGEM-PUBLICA-A-DEFINIR/ | grep -io '<title>.*</title>'
#    esperado: o título da página de cadastro de rosto.
#    Se aparecer o título do aplicativo de ponto, o Host está sendo reescrito
#    (proxy ligado) ou o domínio foi adicionado ao projeto errado.
```

No painel da Vercel, o projeto da origem pública é o que tem **Root Directory
`publico`**. O aplicativo de ponto é outro projeto, e este domínio **não** deve
ser adicionado nele.

## Depois do DNS falta uma coisa

O DNS não é o último passo. Falta liberar a origem nova no n8n — veja
[`cors-n8n-origem-publica.md`](cors-n8n-origem-publica.md). Sem isso a página
abre bonita e **não consegue salvar nenhuma foto**.
