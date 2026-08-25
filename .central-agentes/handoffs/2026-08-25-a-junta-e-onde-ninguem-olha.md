# A junta é onde ninguém olha · 25/08/2026 (Orquestrador)

## O padrão do dia, em sete instâncias

Todas a mesma forma: **cada peça medida corretamente no próprio pedaço, e o
defeito na junta entre elas**. Nenhuma foi descuido; todas foram invisíveis de
dentro do escopo de quem mediu.

1. **As 8 rotas não publicadas.** `servidor/` tinha quatro `.js` e nenhum era
   handler. QA chamava casos de uso direto, Full-Stack fazia fumaça in-process,
   Persistência media o adaptador, DevOps media `/api/saude`. Todos verdes.
2. **`/api/saude` mentindo.** Respondia `ok:true` com zero rota publicada — o
   sinal mais tranquilizador possível apontando para o lugar errado.
3. **`api/[...rota].js`.** Colchetes são sintaxe de framework; este projeto é
   zero-config. O arquivo existiria, o deploy sairia **verde**, e só a requisição
   revelaria. O DevOps publicou os dois nomes lado a lado e mediu.
4. **`copiar-nucleo.sh` sem os imports de `js/`.** `dominio.js` não carregaria.
   Achado em paralelo pelo Full-Stack (testando a própria entrega pelo caminho da
   Vercel) e pelo Arquiteto (tentando publicar).
5. **O prefixo não caía.** `caminhoDaRequisicao` devolve `/webhook/efrat/carga`;
   a tabela registra `/efrat/carga`. As 8 dariam **404 com tudo o resto certo**.
6. **O app não chama a API.** `js/config.js:24` ainda aponta para o n8n. Com tudo
   de pé, o aparelho de teste falaria com o v2 — e o sintoma mandaria todo mundo
   procurar no n8n de novo.
7. **`chave_hash` vs `chave`.** Login de RH dando 401 **com a senha certa**, e as
   três rotas de RH inalcançáveis. Achado por três pessoas em paralelo.

E duas dentro dos próprios instrumentos:

- **O portão do QA aceitava a proteção da Vercel como sucesso.** Com Deployment
  Protection, tudo responde 401 — inclusive rota inexistente. Como 401 era o caso
  de sucesso, o portão daria verde para **qualquer string na lista**.
- **A saúde conferia arquivo e não import**, então dizia `nucleo:ok` com o núcleo
  inutilizável.

## O que fecha essa classe, e não é atenção

O QA nomeou a armadilha no cabeçalho de um arquivo e caiu nela **no arquivo
seguinte**. Se quem nomeia cai, não se evita por cuidado. O que fechou:

- **Controle negativo no alvo vivo** — antes de julgar as 8, pedir uma rota que
  certamente não existe e **exigir 404**; senão a rodada é **anulada, não
  aprovada**. Generaliza contra proteção, rewrite catch-all, WAF, proxy.
- **Saúde por construção** — monta o roteador real e resolve um caminho vindo de
  `roteador.caminhos()[0]`. Sem lista que possa desatualizar, porque não há lista.
- **Script por construção** — lê todo import que escapa de `nucleo/` e aborta se
  não souber resolver. Sabotado de três jeitos, os três quebraram o build.
- **`memoria-nao-mede.test.js`** — asserções invertidas: exige verde em memória e
  vermelho em banco.

## Estado medido

```
rota (caso de uso) do API-4 ......... MEDIDA contra Postgres
adaptador do API-3 .................. MEDIDO em container e em Neon real
as 8 rotas publicadas ............... MEDIDO — 8/8, em PREVIEW
corridas por HTTP na pilha completa . em curso
PRODUÇÃO ............................ 404 nas oito, saúde no formato velho
```

Corridas nas duas rotas que gateiam: **0/5 quebradas** atômico, **5/5 com até 8
vencedores** ingênuo.

## Decisões deste bloco

- **`apiBase` trocado direto**, revertendo minha restrição de que a frota não se
  mexeria: a medição do n8n mostrou 9 marcações em toda a história e 2 aparelhos
  de piloto. A restrição protegia uso que não existe. Reversível barato —
  `config.js` é runtime, editável sem republicar.
- **CSP viaja no mesmo deploy.** Medi: `_headers` e `vercel.json` do meu worktree
  listam só o n8n. `apiBase` novo com CSP velha = navegador bloqueia tudo e o
  sintoma não aponta a causa.
- **Preview contaminado mantido**, contra minha posição inicial: derrubá-lo
  cegaria o QA, único medindo a pilha completa, na véspera. O Arquiteto pôs a
  etiqueta no `LEIA-ME`, onde quem mexe no núcleo lê primeiro. Depois o DevOps
  apagou tudo e republicou do zero — a mina morreu, não foi contornada.
- **Oráculo de enumeração em `/rh/sal` adiado** (T-7B0D12): mexer em resposta de
  autenticação na véspera troca risco de exposição por risco de indisponibilidade,
  e só um dos dois quebra o teste.

## A falha minha que se repetiu três vezes

**Decisão comunicada a uma pessoa é decisão que volta**, e eu escrevi essa regra
hoje de manhã. Depois: não avisei o Full-Stack ao dar o adaptador ao Arquiteto
(quase dois no mesmo arquivo), e não designei dono do conserto do login antes de
o QA avisar dois em paralelo (três consertando o mesmo arquivo).

Escrever a regra não é executá-la sob pressão.

## O que depende do usuário

1. **Publicar a API** e **publicar o app** — nessa ordem, com o `apiBase` novo já
   dentro. Sem isso não há teste.
2. **A pista** — `vizuFlow` ocupando; ninguém derruba processo de outro projeto.
3. **Existe registro de ponto real por outro canal?**

## A frase que resume, do Arquiteto

> O verde que existe hoje prova que **o código está certo** — não que o pipeline
> funciona, nem que o cliente vai usar.
