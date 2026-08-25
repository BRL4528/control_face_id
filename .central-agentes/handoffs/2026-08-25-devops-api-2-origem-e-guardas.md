# T-A4AAFD · API-2 · Origem própria da API, banco e guardas de CI · 25/08/2026

## Provedor: Neon Postgres — escolhido pelo fluxo, e **verificado no banco real**

O handoff mandou não hardcodar provedor. Rodei `vercel-storage` + o fluxo da
Marketplace (`categorize` → `discover` → `install`).

`vercel integration discover --category storage` devolveu 17 produtos; filtrando
pelo que o contrato exige (SQL relacional com transação e índice único) e pelo
que dá para provisionar **sem a conta do cliente**, sobram Prisma Postgres, Nile,
Supabase e Neon — as duas opções AWS (Aurora DSQL e Aurora PostgreSQL) exigiriam a
conta AWS do cliente, e a DSQL nem suporta chave estrangeira.

Decidiu o skill `vercel-storage`, que é a autoridade para storage (a própria
skill da Marketplace roteia storage para ela): *"Relational data, SQL queries →
Neon Postgres"*, e Neon é o caminho "Vercel-managed" preferido. Somam-se dois
motivos de projeto: driver simples (`@neondatabase/serverless`, sem ORM imposto,
e este repo não tem build step) e **branching**, que dá banco próprio por preview
— é o que o cartão API-5 vai precisar para rodar a suíte de contrato contra a API
real sem sujar produção.

### As três impossibilidades foram MEDIDAS, não aceitas do documento

Rodei contra o banco provisionado, antes de fechar a escolha:

| O que a Data Table não fazia | Resultado no Neon |
|---|---|
| Uso único do convite exige compare-and-set atômico (ameaça 1.3) | Dois `UPDATE … WHERE estado='aberto'` concorrentes → **exatamente 1 vencedor** |
| Dedup de marcação dependia do cliente ("envio único em voo") | `unique (id_cliente)` → segundo `INSERT` **recusado pelo banco** |
| `upsert` insere quando o filtro não casa | `UPDATE` sem casar → **0 linhas, nada inserido** |

Tabelas de sonda criadas e removidas no mesmo script.

## A terceira origem

| | |
|---|---|
| Projeto | `control-face-id-api` |
| Origem | `https://control-face-id-api.vercel.app` |
| Root Directory | `servidor` |
| Região | `gru1` (confirmado por `x-vercel-id: gru1::…`) |

Região importa: `docs/vercel-na-frente-do-n8n.md` registra que o padrão é `iad1`
(Washington) e que sem fixar região cada chamada atravessaria para os EUA. O
sintoma seria "o ponto ficou lento", sem causa aparente.

Verificado por curl em produção, não pelo painel:

```
GET /api/saude                     → 200 {"ok":true,"banco":"ok",…}
Origin: https://control-face-id.vercel.app  → access-control-allow-origin: (essa origem)
Origin: https://atacante.example            → SEM access-control-allow-origin
```

`/api/saude` toca o banco de verdade (`select 1`). Saúde que não toca o banco
fica verde com o banco fora.

**Env vars**: Neon injetou `DATABASE_URL` e as `POSTGRES_*`/`PG*` em `production`,
`preview` e `development`. Mais `ORIGENS_PERMITIDAS`. Nenhum valor ecoado.

## Por que a API é origem separada (e não `/api` no app)

Não é organização de pastas. `sw.js` é cache-first e só ignora a API porque ela é
**outra origem**. Mesma origem a poria dentro do handler, e uma resposta de
marcação servida do cache diria "registrado" para algo que o servidor nunca
recebeu. Pior: o teste que existe hoje — *"o SW não intercepta chamadas de outra
origem"* — **continuaria verde**, afirmando uma propriedade que virou irrelevante.

## CSP

`connect-src` ganhou `https://control-face-id-api.vercel.app` em **`_headers`,
`vercel.json` e `publico/vercel.json`**. Os três, e o n8n **continua liberado de
propósito**: durante a janela de corte, rollback é trocar o `apiBase` de volta, e
rollback que exige republicar CSP não é rollback. Quando o corte do API-6 fechar,
o n8n sai e a política fica **mais** fechada.

## Guardas de CI

`origens.json` declara as três origens numa fonte só — a tabela do
`publico/LEIA-ME.md` existia só em prosa.

**O furo que fechei, e ele era maior do que "checa o host antigo":** três guardas
extraíam o apiBase assim —

```
grep -oE "apiBase:\s*'https?://[^/']+" js/config.js
```

Isso lê o **literal escrito no arquivo**, não o valor que o navegador usa. É a
lição do T-F1E72A onde ela ainda não tinha chegado: `config.js` faz
`Object.assign({default}, window.EFRAT_CFG || {})`, então qualquer coisa que
defina `EFRAT_CFG` antes vence. Dava para apontar o app para outra origem com as
guardas de CSP **verdes e cegas**. Agora o valor é avaliado como o navegador
avalia (`.github/scripts/origens.mjs`).

Passo novo `guarda-origens.mjs`. **Sete sabotagens, todas pegas:**

1. origem pública = origem do app → pega (é a falha que não quebra nada visivelmente)
2. apiBase efetiva para host não declarado → pega
3. ordem do `Object.assign` invertida → pega
4. host estranho no `connect-src` → pega
5. `.vercelignore` sem `servidor` → pega
6. CORS com `*` → pega
7. `nucleo/` nasce sem passo de cópia → pega

Outras mudanças:

- **Sintaxe exaustiva por construção.** Varria `js/*.js tests/e2e/*.js` — duas
  pastas nomeadas à mão. `nucleo/` nasceu sem checagem e a guarda seguiu verde
  dizendo "todos os módulos". Agora: todo `.js`/`.mjs` versionado. 55 arquivos.
- **Varredura de segredo alcança `servidor/`** — a única parte do repo que lê
  credencial de ambiente. Mais um passo novo: nenhum `.env` versionado.
- **`.vercelignore` alinhado com o que as guardas já assumiam.** A guarda "no que
  vai ao ar" montava a lista excluindo `tests/`, `docs/`, `n8n/` — o repo já
  tratava essas pastas como fora do deploy e o `.vercelignore` discordava em
  silêncio. A guarda varria um conjunto e a Vercel publicava outro, maior.

## As duas decisões que o Arquiteto passou

**1. `nucleo/` não vai ao deploy do app.** É domínio de servidor; o navegador
nunca o carrega. Entrou no `.vercelignore`.

**2. `nucleo/` chega na API por cópia de build**, igual a
`publico/copiar-assets.sh`, com *Include source files outside of the Root
Directory* ligado. Fonte de verdade única na raiz, porque
`tests/e2e/servidor-falso.js` também o usa — o servidor falso e a API têm de
executar **o mesmo código**, não dois códigos parecidos.

Não montei a cópia porque `nucleo/` não existe nesta árvore, e um script que
tolera a ausência é exatamente a "falha silenciosa do passo de cópia" que o
contrato registra como dívida 7. No lugar: **guarda que acende no dia em que
`nucleo/` aparecer sem o passo de cópia**. O requisito não depende de alguém
lembrar.

## Pendente do cliente / de outros cartões

- **Origem pública não existe** (T-600DD4). `origens.json` tem `"origem": null`
  e a guarda pula essa linha sem afrouxar as outras. Quando existir: criar o
  projeto e **acrescentá-la a `ORIGENS_PERMITIDAS`** — senão a página pública
  não grava face nenhuma.
- **Domínio próprio das três origens**: decisão do cliente. Hoje tudo é
  `*.vercel.app`, que é real e nosso.
- **`vercel deploy --prod` e `vercel rollback` são barrados** pelo classificador
  de permissão deste ambiente. Precisam da mão do usuário.

## Comando de rollback do P0 — anotado, NÃO executado

Cancelado pelo Orquestrador: `js/store.js` v2 abre o IndexedDB na versão 1 e o v3
na 2; abrir com versão menor lança `VersionError` por especificação. O rollback
trocaria 401 por app que não sobe.

Se a frente-pra-frente falhar, ele volta à mesa **acompanhado de um conserto do
`VersionError`**:

```bash
vercel rollback https://control-face-flxxf8ubg-brl4528s-projects.vercel.app \
  --yes --scope brl4528s-projects
# alvo: 269cd42, 14/08 14:06 UTC, sw efrat-ponto-v5 — último antes do v3
```
