# API-1 · Extração do núcleo, e duas corridas do cliente que ela não causou

Cartão **T-C8316C** (Arquiteto). Ramo `central/f1bd74a96b/24596bca6d-control_face_id`.
Commits: `49d23c1` interface · `4599c36` fatia vertical · `e72345c` adição +
rascunho de aparelho · `c7bc729` `inserirUsuarioRh`.

## O que foi extraído

`tests/e2e/servidor-falso.js` deixou de ser a implementação das rotas e passou a
ser o que sempre deveria ter sido: um servidor **de teste** (estáticos,
`_headers`, semeadura, latência simulada, contadores, o objeto `estado`). A
regra mora em `nucleo/`. Detalhe da forma em `nucleo/LEIA-ME.md`.

Servida pelo núcleo nesta rodada: **`/efrat/marcacoes`**. As outras seguem no
código antigo, intocadas, para a migração ser rota a rota.

## A prova de que a extração não mudou comportamento

Três medições, em ordem de força:

1. **Diff de resposta, 18 cenários, byte a byte idêntico.** Mesmos payloads
   contra as duas árvores (a extraída e uma de linha de base em `49d23c1`, com
   o `servidor-falso` pré-extração). O diff compara a resposta HTTP *e* o
   estado gravado — `requer_revisao`, `motivo_codigo`,
   `aparelho_estado_no_envio`, `foto_auditoria` — mais o contador de retidas.
   Cobre: fora de escopo, gestor, manual, veredito de dúvida, deriva nos dois
   lados de 2 min, duplicado entre lotes e dentro do lote, pessoa inativada
   antes e depois do envio, pessoa desconhecida, campos ausentes em três
   formas, revogado (retido / teto de 500 / janela de 30 dias), pendente,
   negado, lote misto e lote vazio.
2. **Linha de base completa: 174/174.**
3. **107 unitários verdes**, incluindo a guarda que grepa o limiar 0,45 dentro
   de `servidor-falso.js` — o limiar não se mudou de lugar.

## As duas corridas, e por que não são da API

Duas rodadas completas na árvore extraída deram **173/174**, com testes
**diferentes** falhando. Cada um passa isolado (5/5 nas duas árvores).

### `acesso.spec.js:67` — `Fila.candidato` ainda não é `null`

`js/fila.js:390` chama `this.comprovante(m, pessoa)`; **a linha 391** é que
chama `this.sincronizar()`. Dentro de `comprovante()`, o `.cartao.ok` entra no
DOM (`:407`) e `this.candidato = null` acontece ~20 linhas abaixo, **no mesmo
bloco síncrono, sem `await` no meio**.

Logo: *"`.cartao.ok` está no DOM"* implica *"`candidato` já é `null`"*. O
navegador não roda o `page.evaluate` do teste no meio de um bloco síncrono. A
asserção não pode depender do servidor — **a rede ainda nem foi chamada**
quando ela já é verdadeira.

O único jeito de `candidato` voltar a não ser nulo é um reconhecimento novo
setando-o (`js/fila.js:224`) depois do comprovante. Território de **T-122B55**
(a câmera reabre sobre quem continua na frente).

### `fluxo.spec.js:291` — p-carla em nenhuma das duas listas

O único caminho que tira um item da fila **sem** pôr em `enviadas` é
`rejeitado`: `itensRecusados` (`js/regras.js:97`) → `Store.recusar` →
`tirarDaFila` (`js/api.js:227-238`). `aceito`, `duplicado` e `retido` vão para
`enviadas` **antes** de sair da fila, nessa ordem — não há janela.

Ou seja: aquele teste só falha se o servidor **recusou** a marcação de
p-carla. E a medição 1 acima mostra as duas árvores respondendo `aceito` para
exatamente esse cenário.

### Conclusão

São corridas **pré-existentes do cliente**. A extração não as cria; no máximo
mexeu nas probabilidades por carga de CPU. Nenhuma das duas mora em `nucleo/`.

## Lacuna de contrato encontrada de passagem (não é regressão)

**`/efrat/marcacoes` não confere se a pessoa pertence às `equipes_ids` do
aparelho.** Nem no núcleo, nem no `servidor-falso` pré-extração — `equipes_ids`
não aparece uma vez na decisão. Aparelho escopado em `eq-1` envia marcação de
p-carla (`eq-2`) e recebe `aceito`, idêntico nas duas árvores.

E é **deliberado e testado**: `/efrat/identificar` ranqueia sobre *todas* as
pessoas ativas e devolve `fora_do_escopo_offline`; `fluxo.spec.js:291` asserta
que essa pessoa marca. O escopo do aparelho foi desenhado como escopo da
**galeria offline**, não como autorização de escrita.

Consequência real, levantada pelo Especialista n8n: para escrita o escopo é
decorativo — credencial na mão errada grava ponto de qualquer pessoa da
empresa. Como o servidor falso é a fonte da verdade do comportamento, **o
porte está certo e a lacuna é de contrato**. Meio-caminho a considerar quando
virar cartão: aceitar fora do escopo **com `requer_revisao`** — não recusa,
não confia.

`/efrat/rh/face/cadastrar` não tem escopo de aparelho a conferir: autentica por
usuário + chave de RH e não recebe credencial de aparelho. RH é papel global
por desenho. A pergunta equivalente ali seria "existe RH com escopo por
unidade?", e hoje não existe.

## Erro meu, registrado

No rascunho de `registrar()`, ramo de migração do token legado, eu chamei
`inserirDispositivoSeAusente` e **ignorei o retorno**. `consumirTokenLegado` já
garante migração única, então não é corrida — e foi por isso que me convenci de
que estava seguro. Não estava: se aquele `dispositivo_id` já tivesse linha de
outro fluxo, o insert não gravava nada e a rota respondia `200 migrado:true`
sobre uma linha que não era a dela. Achado pelo Full-Stack, corrigido para
`DISPOSITIVO_CONFLITO`.

Vale registrar a ironia: a interface que eu escrevi diz que `inserido:false` é
informação que quem chama **tem** de ler, e no primeiro uso eu joguei fora.

## Limites conhecidos, escritos como limites

- **Idempotência** (`T-692AE3`): `lerIdempotencia`/`gravarIdempotencia` é
  ler-e-depois-gravar, igual ao servidor falso. Duas requisições simultâneas
  com a mesma chave executam as duas. O que segura as escritas perigosas são as
  operações `ATOMICO` por baixo — e isso é verdade que nenhum teste prova.
- **`nucleo/` importa `js/coerencia.js` e `js/regras.js`** (fonte única das
  funções puras que o cliente também usa). Decisão adiada até o DevOps fechar a
  forma do deploy.
- **CI**: a guarda "Sintaxe de todos os módulos" varre só `js/*.js` e
  `tests/e2e/*.js` — `nucleo/` nasce sem checagem. E `.vercelignore` só ignora
  `publico/`, então `nucleo/*.js` seria publicado como estático na origem do
  app. Ambos são do DevOps; nenhum foi tocado.
