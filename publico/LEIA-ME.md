# Origem pública do cadastro de face

Esta pasta é o **Root Directory de um projeto separado da Vercel**. Ela não é
publicada junto com o app do operador — `.vercelignore` na raiz do repo a tira
do deploy do app.

## Por que uma origem separada, e não um caminho no mesmo domínio

Porque caminho não é fronteira. `IndexedDB`, `localStorage`, `Cache Storage` e
cookie isolam por **origem**, não por caminho. Na mesma origem, esta página
leria o banco `efrat-ponto` (`js/store.js`) e com ele a credencial de 256 bits
do aparelho que bate ponto.

Escopo de service worker também é prefixo de caminho: o `sw.js` do app cobre a
raiz, intercepta todo GET da origem e, sem rede, responde
`caches.match('./index.html')`. No mesmo domínio, o colaborador receberia o
shell do app do operador no celular dele.

A garantia aqui é **ausência do arquivo**, não acerto de configuração: uma regra
de rota protege só enquanto ninguém erra a regra.

## Hostname: ainda não definido

O hostname vive em **um único lugar**, com nome de placeholder proposital:

```
ORIGEM-PUBLICA-A-DEFINIR
```

Ele **ainda não está em nenhum arquivo de código**, porque quem monta o link é a
tela do RH (`js/`, do Full-Stack) e essa parte ainda não existe. Quando existir,
a chave é `origemCadastroPublico` em `js/config.js` — que é o arquivo de
configuração de runtime, editável no servidor sem republicar. Uma string, um
lugar.

Nada nesta pasta precisa saber o próprio hostname: a CSP é toda `'self'`.

---

# Execução: as folhas do cliente estão em docs/

Para não haver duas versões da mesma instrução, o passo a passo que o cliente
executa vive em `docs/` e não aqui:

- [`docs/dns-origem-publica.md`](../docs/dns-origem-publica.md) — o CNAME, o
  aviso do proxy do Cloudflare com o sintoma de quando está errado, e o caminho
  curto se os nameservers já forem da Vercel.
- [`docs/cors-n8n-origem-publica.md`](../docs/cors-n8n-origem-publica.md) — as
  duas rotas, os cabeçalhos, o `OPTIONS`, lista de origens em vez de `*`, e os
  quatro `curl` de confirmação.

## O que é nosso, aqui — criar o projeto na Vercel

Mesmo repositório, projeto novo:

| Campo | Valor |
|---|---|
| Repositório | o mesmo do app |
| Root Directory | `publico` |
| Framework Preset | Other |
| Build Command | `bash ./copiar-assets.sh` (já vem de `publico/vercel.json`) |
| Output Directory | `dist` (idem) |
| **Include source files outside of the Root Directory** | **LIGADO** |

A última linha é obrigatória. O motor (`vendor/face-api.js`), as fontes
(`vendor/fontes/`) e os modelos (`models/`) são **copiados no build** de
`../vendor` e `../models` — fonte de verdade única, nenhuma segunda cópia
commitada. Sem essa opção o build falha com `nao achei ../vendor`, e falhar alto
é o comportamento desejado: melhor build vermelho do que página no ar sem motor.

O domínio é adicionado **neste** projeto, nunca no do app.

## Verificação depois do primeiro deploy

```bash
# o motor e os modelos chegaram? (404 = a opção acima está desligada)
curl -sI https://ORIGEM-PUBLICA-A-DEFINIR/vendor/face-api.js | head -1
curl -sI https://ORIGEM-PUBLICA-A-DEFINIR/models/tiny_face_detector_model.bin | head -1

# a página de uso único não vem de cache e não é indexada?
curl -sI https://ORIGEM-PUBLICA-A-DEFINIR/ | grep -iE 'cache-control|x-robots-tag'
#   esperado: no-store, must-revalidate  /  noindex, nofollow

# os pesados vêm com cache longo?
curl -sI https://ORIGEM-PUBLICA-A-DEFINIR/models/tiny_face_detector_model.bin | grep -i cache-control
#   esperado: public, max-age=31536000, immutable

# a origem do app NÃO serve esta página (isolamento por ausência)?
curl -sI https://HOSTNAME-DO-APP/publico/ | head -1
#   esperado: 404. Se der 200, .vercelignore não pegou — pare e avise.
```

## O que NÃO pode entrar nesta pasta

Tudo com guarda de CI — as guardas rodam contra sabotagem, não contra boa fé:

- **Nenhum asset externo.** Nada de CDN, nada de Google Fonts, nenhum script de
  terceiro. As fontes e o motor vêm do build.
- **Nenhum service worker.** Página de uso único não ganha nada com offline, e
  um SW aqui reintroduziria o fallback-para-shell que motivou a origem separada.
- **Nenhuma cópia commitada** de `vendor/` ou `models/` — são build-time.
