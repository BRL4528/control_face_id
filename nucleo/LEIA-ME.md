# `nucleo/` — a API própria, extraída do servidor falso

Isto **não é uma API nova**. É `tests/e2e/servidor-falso.js` — 1823 linhas que
já implementavam as 25 rotas do contrato, provadas por 174 e2e — separado em
três peças. A prova de que a separação não mudou comportamento é que os 174
e2e continuam verdes **sem uma asserção alterada**.

Decisão e motivo: `.central-agentes/handoffs/2026-08-24-decisao-api-propria.md`.
Contrato: `docs/fase3-contrato.md`.

## As três peças

| peça | onde | o que pode importar |
|---|---|---|
| **(a) núcleo puro** | `dominio.js` | nada além de `js/coerencia.js` e `js/regras.js` (funções puras compartilhadas com o cliente) |
| **(b) interface de repositório** | `repositorio.js` | nada |
| **(c) adaptador HTTP** | `http.js` (sem transporte) e `http-node.js` (ponte com `node:http`) | (a) e (b) |

E mais duas que ligam as três:

- `contexto.js` — o que todo caso de uso recebe (`ctx`, `req`) e devolve
  (`{status, corpo, cabecalhos}`), mais a chave de idempotência.
- `casos/` — um arquivo por área. **Aqui mora a orquestração, nunca a regra.**
- `memoria.js` — implementação em memória de (b), sobre o `estado` que os e2e
  leem e escrevem. É o que o servidor falso usa, e a referência contra a qual
  API-3 confere a de banco.

## A regra que não se dobra

**Nenhum caso de uso fala com armazenamento a não ser por `repositorio.js`.**
Sem SQL, sem `Map`, sem `fetch`, sem `fs` em `casos/` nem em `dominio.js`.

E **`dominio.js` não chama `Date.now()`**. O instante entra por `req.agoraMs`.
Duas razões: regra testável sem congelar relógio, e a API e o servidor falso
nunca discordarem por causa de dois relógios.

## Onde está a razão de a API existir

Duas operações, e elas são o cartão inteiro:

1. `inserirMarcacaoSeAusente` — **índice único** em `id_cliente`. A dedup de
   marcação deixa de depender de "envio único em voo" no cliente.
2. `trocarEstadoConvite` — **compare-and-set** com o estado anterior *e a
   expiração* na cláusula do `UPDATE`. É o uso único do convite de face.

Mais quatro do mesmo molde estão marcadas `ATOMICO` na interface. Antes de
implementar qualquer uma, leia a doc **do método**, não `memoria.js`: em
memória a atomicidade é de graça e um `SELECT`+`INSERT` pareceria correto.

## Como acrescentar uma rota

1. A decisão pura, se houver, vai para `dominio.js`.
2. O que o armazenamento precisa fazer vai para `repositorio.js` **primeiro** —
   e se for escrita disputada, como *uma* operação, não como olhar-e-escrever.
   Implemente em `memoria.js`.
3. O caso de uso vai para `casos/<area>.js`: `async (ctx, req) => {status, corpo}`.
4. Registre na tabela de rotas com a política de autenticação
   (`AUTH.*`) e a de CORS (`CORS.*`). Ninguém nasce aberto por esquecimento.
5. Apague a rota antiga de `tests/e2e/servidor-falso.js` e rode os 174.

## Estado da migração

Servida pelo núcleo: `/efrat/marcacoes`.
As outras 24 seguem no código antigo de `tests/e2e/servidor-falso.js`,
intocadas, até API-4 portar — rota a rota, com os 174 verdes a cada passo.

---

## ⚠️ `nucleo/` NÃO CARREGA SOZINHO NA ORIGEM DA API (aberto em 25/08)

`nucleo/dominio.js` importa `../js/coerencia.js` e `../js/regras.js` — as
funções puras compartilhadas com o cliente, fonte única de propósito.
`servidor/copiar-nucleo.sh` copia **só `nucleo/`**. Dentro de `servidor/`, esses
imports resolvem para `servidor/js/coerencia.js`, **que não existe**:

```
Cannot find module .../servidor/js/coerencia.js
        imported from .../servidor/nucleo/dominio.js
```

Consequência: nada que importe `dominio.js` carrega — e `aparelho.js` e
`marcacao.js` importam. A API sobe e toda rota falha.

**E o sinal mentia:** `/api/saude` reportava `"nucleo":"ok"` porque conferia que
os **arquivos** estavam lá, não que o domínio **importa**. Quarta ocorrência da
mesma família num dia. Conferir arquivo não prova nada; `await
import('nucleo/dominio.js')` prova.

### O preview de 25/08 está CONTAMINADO — não confie nele

O preview `control-face-id-cli25ofks` só carrega porque **`servidor/js/` foi
criado à mão**, na máquina de quem publicou:

```
mkdir -p servidor/js && cp js/coerencia.js js/regras.js servidor/js/
```

Isso **não** está em `copiar-nucleo.sh`, **não** é versionado e **não** se
reproduz. Qualquer redeploy de outra máquina — inclusive o de produção — volta a
quebrar, e volta a quebrar com `/api/saude` dizendo `nucleo: ok`.

**Não commite `servidor/js/`.** Ele é contorno, não conserto. O conserto é no
`copiar-nucleo.sh` (dono: DevOps), e tem de ser **por construção** — copiar o
que `nucleo/` de fato importa — e não uma lista de dois arquivos que a próxima
dependência fura em silêncio.

Enquanto isso: um verde nesta origem mede **o código**, e não **o deploy**.
