# Origem própria da API

Esta pasta é o **Root Directory de um terceiro projeto da Vercel**
(`control-face-id-api`). Ela não é publicada junto com o app nem junto com a
página pública — `.vercelignore` na raiz a tira do deploy do app.

| | |
|---|---|
| Projeto | `control-face-id-api` |
| Origem | `https://control-face-id-api.vercel.app` |
| Root Directory | `servidor` |
| Framework Preset | Other |
| Região | `gru1` (São Paulo) |

A tabela das **três** origens, machine-readable, está em `origens.json` na raiz.
Há guarda de CI conferindo que elas são distintas entre si.

## Por que a API é uma origem separada, e não um caminho no app

Não é organização de pastas. São duas coisas concretas que a mesma origem
quebraria:

**1. O service worker do app é cache-first.** O handler de fetch do `sw.js` hoje
deixa passar tudo que não é da mesma origem (`if (url.origin !== location.origin)
return`), e é exatamente isso que mantém a API fora do cache. O comentário no
topo do arquivo diz por quê: *"resposta de marcação em cache seria mentira sobre
o que o servidor recebeu."* Tornando a API mesma origem, ela cai no handler, e o
app poderia dizer "registrado" para algo que o servidor nunca recebeu.

Pior do que o bug: **o teste que existe hoje continuaria verde.** Ele afirma que
o SW *não intercepta outra origem* — verdadeiro e irrelevante no instante em que
a API vira mesma origem. `docs/vercel-na-frente-do-n8n.md` desenvolve.

**2. `IndexedDB` isola por origem, não por caminho.** É o mesmo argumento que
motivou `publico/`, e vale aqui na direção inversa.

## CORS

A API é chamada **cross-origin** pelas outras duas, então ela decide quem entra.

A lista vem da env var `ORIGENS_PERMITIDAS` (separada por vírgula), **não** de
arquivo commitado: hostname de cliente muda sem republicar código. Hoje:

```
ORIGENS_PERMITIDAS = https://control-face-id.vercel.app
```

A origem pública entra nesta lista quando o projeto dela existir (T-600DD4).
**Enquanto não entrar, a página pública não consegue chamar a API** — é falha
alta e visível, que é o que se quer.

Nunca `*`. Com `*` o navegador nem envia credencial, e qualquer página da
internet passaria a poder chamar as rotas anônimas do convite a partir do
navegador do colaborador. Há guarda de CI conferindo que `*` não volta.

## Banco

**Neon Postgres**, provisionado pela Marketplace da Vercel
(`vercel integration add neon`), conectado a este projeto, com as env vars
injetadas em `production`, `preview` e `development`.

O provedor não foi escolhido por preferência de stack. O handoff da decisão
lista três coisas que a Data Table do n8n **não faz**, e cada uma quebra uma
invariante já declarada por escrito. As três foram **medidas no banco real**
antes de fechar a escolha, não aceitas do documento:

| O que o piloto não conseguia | Verificado |
|---|---|
| Uso único do convite exige compare-and-set atômico | Dois `UPDATE ... WHERE estado='aberto'` concorrentes: **exatamente 1 vencedor** |
| Dedup de marcação dependia do cliente ("envio único em voo") | `unique (id_cliente)`: o segundo `INSERT` é **recusado pelo banco** |
| `upsert` insere quando o filtro não casa | `UPDATE` sem casar afeta **0 linhas e não insere** |

Ambiente local:

```bash
cd servidor && vercel env pull
```

Nunca ecoe valor de segredo. `vercel env ls` mostra só nomes.

## O núcleo do domínio chega aqui por cópia de build

`nucleo/` (cartão API-1) é a fonte de verdade única, e vive **na raiz do repo**,
porque `tests/e2e/servidor-falso.js` também o usa — o servidor falso é a fonte da
verdade do comportamento, e ele e a API têm de executar o mesmo código, não dois
códigos parecidos.

Quando `nucleo/` existir, esta pasta o recebe por **cópia no build**, igual a
`publico/copiar-assets.sh`, com **Include source files outside of the Root
Directory** ligado no projeto.

Ainda não está montado, e isso é deliberado: `nucleo/` não existe nesta árvore.
**Há guarda de CI que falha no dia em que `nucleo/` aparecer e esta pasta ainda
não tiver o passo de cópia** — para o requisito não depender de alguém lembrar.

## Rotas

Só `/api/saude` existe. As 25 rotas do contrato são o cartão API-4, escritas
contra o núcleo do API-1.

`/api/saude` **toca o banco de verdade** (`select 1`). Saúde que não toca o banco
fica verde com o banco fora — é uma sonda que mente. Ela responde `200` com
`{"ok":true}` ou `503`, e não devolve nome de banco, host, versão nem contagem de
tabela: é pública e sem autenticação, então diz VIVO ou NÃO e nada sobre a
topologia.
