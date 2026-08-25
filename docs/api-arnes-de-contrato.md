# Arnês de contrato da API própria (T-7A35B5 · API-5)

> Como apontar a suíte de contrato para uma **API real com banco real**, e por
> que verde contra o servidor falso não conta.

## O problema, em uma frase

O servidor falso está sendo **promovido a API**. Ele é o réu. Se ele também for
o juiz, a promoção se aprova sozinha.

E não é uma objeção de princípio — é mecânica. `tests/e2e/servidor-falso.js`
guarda tudo em `Map`, e num `Map` "olhar e depois gravar" é atômico **de graça**:

```js
if (estado.marcacoes.has(m.id_cliente)) { /* duplicado */ }   // :946
...
estado.marcacoes.set(m.id_cliente, ...)                       // :963
```

Não há `await` entre as duas linhas. O Node é uma thread só, ninguém entra no
meio, e o resultado é **correto pelo motivo errado**. As duas propriedades que a
API existe para garantir — dedup de marcação e uso único do convite — são
exatamente as que ele ganha de brinde por ser um `Map`.

Num banco, com driver de verdade, há E/S entre ler e gravar. A mesma linha de
código passa a perder a corrida. Por isso a medição tem de acontecer **onde a
propriedade custa**.

## O que o arnês mede

Dois alvos, os dois sob **concorrência real** (8 requisições simultâneas, 5
rodadas). Sequencial não prova nada: sequencial, qualquer implementação acerta.

| Alvo | Contrato | Onde mora |
|---|---|---|
| Marcação duplicada | um `aceito`, resto `duplicado`, **uma linha** no banco | `tests/contrato/corrida-marcacao.test.js` |
| Convite consumido 2× | um `200 recebido`, resto `409 CONVITE_CONSUMIDO`, **um template** | `tests/contrato/corrida-convite.test.js` |
| Aprovação de aparelho 2× | uma aprovação, resto `404 CODIGO_NAO_ENCONTRADO`, e **o escopo gravado é de quem recebeu o 200** | `tests/contrato/corrida-aprovacao.test.js` |

Marcação e aprovação estão nas **8 rotas do primeiro turno** e portanto gateiam o
teste. Convite **não** — `/face/convite/enviar` é o link do celular, fora da
lista; ali a corrida fica como guarda de regressão.

### A corrida de aprovação mede outra coisa, e é de propósito

Nas duas primeiras o dano é uma linha a mais. Nesta o aparelho é um só em
qualquer caso — o dano é **o servidor mentir para o operador**. `/rh/aparelho/aprovar`
recebe `equipes_ids` no corpo e grava `aprovado_por`. Duas telas de RH digitando
o mesmo código, cada uma com o seu escopo: com ler-depois-gravar **as duas
recebem 200**, o aparelho fica com o escopo de uma, e a outra pessoa acredita
ter liberado o aparelho para a equipe dela. A auditoria passa a ter duas
respostas para "quem deixou este aparelho entrar".

Por isso a asserção decisiva aqui é **coerência**, não contagem: `aprovado_por`
e `equipes_ids` persistidos têm de pertencer a quem recebeu o 200. Um teste que
só perguntasse "o aparelho ficou ativo?" daria verde exatamente no caso em que a
prova de posse deixa de provar.

### Cada corrida confere DUAS metades, e isso não é zelo

- **Só contar linhas no banco** aprova a implementação que tem índice único e
  código ler-depois-gravar: o índice segura o dado, mas quem perde a corrida
  leva violação de unicidade → **500**. E 500 não é `duplicado`: o aparelho não
  tira a marcação da fila e **reenvia para sempre**.
- **Só conferir respostas** aprova a implementação sem índice nenhum, que
  responde `aceito` duas vezes com ar de normalidade e **grava o ponto duas
  vezes**.

Cada metade sozinha tem um cego que a outra enxerga.

## A prova de que os testes sabem reprovar

`tests/contrato/calibracao.test.js` roda as duas corridas contra **três**
implementações e exige o resultado de cada uma. Nas duas ingênuas, **passar é
falhar** — a asserção é `quebrou === true`.

Medido nesta máquina (Postgres 16 em container, 8 simultâneas, 5 rodadas):

| Implementação | Marcação | Convite | Aprovação |
|---|---|---|---|
| `atomica` — índice único + compare-and-set | **0/5** | **0/5** | **0/5** |
| `ingenua` — ler-depois-gravar, sem índice | **5/5** — até **8 linhas** para o mesmo `id_cliente` | **5/5** — até **8 templates** de um convite | **5/5** — código de uso único aceito até **8×** |
| `ingenua-com-indice` — ler-depois-gravar, com índice | **5/5** — dado íntegro (1 linha), mas **500** no lugar de `duplicado` | (usa a ingênua) | (usa a ingênua) |

Taxa de detecção medida para a corrida de aprovação, a menos determinística das
três: **39 de 40 rodadas** (8 execuções × 5 rodadas; pior execução 4/5). A
calibração exige ≥1 rodada quebrada em 5, então um falso verde exigiria as 5
sobreviverem — ~1 em 10⁸. As outras duas quebraram 5/5 em toda execução.

Mesmo arnês, mesma concorrência, mesmo teste. A única variável é a
implementação — que é o que um teste de corrida precisa mostrar para valer
alguma coisa.

A terceira variante existe porque é **a mais provável de nascer sem querer**: o
API-3 põe o índice único na migration (a interface manda) e o API-4 porta a rota
copiando o `if (existe)` do servidor falso (ele é a fonte da verdade do
comportamento). Cada metade está certa sozinha.

### "Você não plantou o `await` que faz o ingênuo perder?"

Não. O `await` está lá porque `pg` fala TCP: no ingênuo há uma ida e volta de
rede de verdade entre o `SELECT` e o `INSERT`, e é ela que solta o event loop.
Não existe `setTimeout`, `sleep` nem `yield` em nenhuma variante ingênua.

Foi por isso que o arnês roda em **Postgres e não em `node:sqlite`**: a API do
`node:sqlite` é síncrona, o intervalo entre ler e gravar não existiria, e o
ingênuo passaria — repetindo, num banco, a mesma atomicidade de graça do `Map`.
O arnês mediria o instrumento errado uma camada abaixo.

## Como rodar

```bash
npm run test:contrato      # tudo: as duas corridas + a calibração
npm run test:calibracao    # só a aferição do instrumento
npm run test:contrato:api  # A MEDIÇÃO QUE VALE (exige API-4; veja abaixo)
```

Não usa Playwright e não usa navegador — **não disputa a pista** (`bin/pista`).
Sobe um `postgres:16-alpine` descartável, ou usa `ARNES_PG_URL` se ela existir.

Sem Docker e sem `ARNES_PG_URL`, os testes **pulam com motivo declarado** e não
contam como `pass`. Em CI isso ainda sairia com código 0 e pintaria a esteira de
verde sem ter medido nada, então a esteira roda com **`ARNES_EXIGIR_BANCO=1`**,
que troca o pulo por reprovação.

Não existe modo `falso`, de propósito. Ver a primeira seção.

## O plugue: o que o API-4 precisa me entregar

```bash
ARNES_ALVO=api  API_BASE=https://<origem-da-api>  ARNES_PG_URL=postgres://...
```

`ARNES_PG_URL` **não é opcional** no modo `api`: sem ler o banco, a corrida
perde a metade que enxerga escrita dupla e fica cega justamente para o dano.

### Contrato de saída que as rotas têm de manter

| Rota | Resposta conferida |
|---|---|
| `POST /webhook/efrat/marcacoes` | `200` · `resultados[].status ∈ {aceito, duplicado}` |
| `POST /webhook/efrat/face/convite/enviar` | `200 {estado:'recebido'}` · ou `409 {erro:{codigo:'CONVITE_CONSUMIDO'}}` |

São as mesmas do servidor falso — o arnês não inventou formato novo, e é por
isso que os testes escritos hoje rodam contra o API-4 **sem reescrever uma
asserção**.

### A costura que precisa de acordo — leia, API-3

Hoje o arnês **semeia e conta por SQL direto**, com o esquema mínimo que eu
mesmo criei para a aferição:

```sql
marcacao   (id_cliente, pessoa_id, marcado_em, requer_revisao, recebido_em)
convite    (convite_id, pessoa_id, token_hash, estado, expira_em, consumido_em)
recadastro (template_id, pessoa_id, convite_id, criado_em)
```

**Se a migration do API-3 usar estes nomes de tabela e coluna, o arnês pluga com
zero edição.** Se divergir, o ajuste é local (`tests/contrato/arnes/alvo.js`,
funções `semearConviteAberto`, `contarMarcacoes`, `contarRecadastros`) — mas
alguém precisa fazê-lo, e é melhor decidir agora que descobrir na véspera.

Alternativa considerada e **não** implementada: semear pela rota real de RH
(`/rh/face/convite`). É mais honesto por não depender do esquema interno, mas
exige autenticação de RH e eu não embarco código que não consigo exercitar hoje.
Fica registrado como a evolução natural quando o API-4 existir.

## Achado de lado: um erro de contrato que o servidor falso não consegue testar

`servidor-falso.js:1288` registra, no próprio código, que **`CODIGO_AMBIGUO`
(409, §1.3) fica sem caminho de teste** — `codigosPendentes` é um `Map` indexado
pelo próprio código, então dois pendentes com o mesmo código curto são
estruturalmente impossíveis ali. O comentário até nomeia a condição: "a colisão
só existiria com outro armazenamento (banco real)".

Num banco real essa impossibilidade deixa de ser de graça e vira **escolha de
DDL**: é o índice único **parcial** em `codigo_curto` onde `estado='pendente'`
(que a interface do Arquiteto já exige em `inserirDispositivoSeAusente`). Sem
ele, dois aparelhos pendentes podem nascer com o mesmo código, e aprovar por
código passa a poder ativar **o aparelho errado** — com o operador vendo sucesso.

O arnês já cria esse índice na variante `atomica`. Não há corrida escrita para
ele ainda; fica registrado como o próximo alvo natural, e como um lembrete de
que "sem caminho de teste no servidor falso" e "impossível na API" são
afirmações diferentes.

## Limite conhecido, declarado e não redescoberto

**Idempotência continua ler-depois-gravar** (`nucleo/repositorio.js`,
`lerIdempotencia`/`gravarIdempotencia`): duas requisições simultâneas com a
mesma chave executam as duas. É **decisão de contrato do Orquestrador**, não
descuido do Arquiteto — fechar exigiria reservar a chave por índice único antes
de executar, o que muda o que a segunda requisição vê. Vira cartão próprio.

O arnês **não** mede isso e não deve passar a medir sem que a decisão mude:
teste que reprova por uma escolha deliberada é teste que alguém vai desligar.

## O que este arnês NÃO cobre

Escopo honesto, para ninguém ler garantia onde não há:

- Só **3 das 25 rotas**. São as que justificam a existência da API e as que gateiam o teste; as
  outras 22 seguem provadas pelos e2e contra o servidor falso — o que, para
  elas, é adequado, porque não dependem de atomicidade.
- Autenticação, limite de volume, coerência das 3 fotos e idempotência **não
  passam** pela API de aferição. Quem as porta é o API-4.
- A API de aferição (`tests/contrato/arnes/api-referencia/`) é **instrumento, não
  produto**. Não deve ser promovida, copiada nem importada pelo API-3/API-4.
  Instrumento de aferição que vira produto deixa de aferir.
