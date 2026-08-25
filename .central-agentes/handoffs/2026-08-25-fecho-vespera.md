# Fecho da véspera · 25/08/2026 (Orquestrador)

## A correção que reenquadra o dia inteiro

Eu disse "a produção do cliente está morta" para a equipe e para o usuário desde
cedo. O Especialista n8n mediu o uso real: **9 marcações em toda a história da
tabela**, em 3 dias (14, 17 e 21/08), a última há 4 dias — **antes do v3 subir**.

Não existe empresa batendo ponto que parou. É piloto com atividade esparsa, já
parado antes de qualquer coisa que aconteceu hoje.

**Era verdade sobre as ROTAS e falso sobre o DANO**, e eu nunca medi a segunda
parte antes de repetir. Nada do trabalho muda — as rotas estavam quebradas, o
hotfix era impossível, a API continua certa. A pressa é que era minha.

Pendente com o cliente: existe registro de ponto real por outro canal (outra
instância, papel, planilha)?

## Estado medido, sem arredondar

| camada | grau |
|---|---|
| rota (API-4), casos de uso | MEDIDA contra Postgres |
| adaptador (API-3), caminho de código | MEDIDO contra Postgres em container |
| adaptador, driver e banco reais | MEDIDO contra Neon gerenciado |
| pilha HTTP: função Vercel, roteador, auth, CORS | **NÃO MEDIDA** |

A última fica aberta e escrita. Depende da env de preview, barrada pelo
classificador.

Corridas, nas duas rotas que gateiam: **0/5 quebradas** com o código atômico,
**5/5 com até 8 vencedores** com ler-depois-gravar.

## O bug que pagou o dia

`neon()` não aceita a forma `sql(texto, params)` — só template tag. O Persistência
usava a forma inexistente em **7 métodos, incluindo `aprovarDispositivoPorCodigo`**.
Teria estourado na **primeira aprovação do teste, com o cliente na frente**.

Conferência por leitura nunca teria pego: o SQL estava certo; errado era como o
código chamava o driver. O que mandou olhar foi a distinção **"SQL certo e
adaptador certo são coisas diferentes"**.

## Três vezes um número forte se revelou vazio

1. `25 concorrentes, 1 vencedor` do Full-Stack — contra memória a corrida **não
   pode** reprovar; o mesmo `if/else` dá 25 vencedores em banco.
2. `roiInputSize` como bug vivo, meu — o campo só é lido em `Face.iniciar()`, que
   a origem pública nunca carrega.
3. Os três números de DDL do Persistência — eram do SQL escrito à mão, não do
   caminho do adaptador.

Nos três casos quem mediu derrubou o próprio número antes de alguém cobrar.

## Uma inversão da regra da casa

Este projeto tem escrito que **contenção produz falso vermelho**. Em teste de
**corrida** é o contrário: contenção fecha a janela, o ingênuo para de perder, e a
calibração dá **falso verde**. Corrigido com `--test-concurrency=1`.

## A suíte é instável, nas duas árvores

Extraída 173·173·174; linha de base 174·173·174. As duas produzem os dois
resultados — não há efeito diferencial. Instabilidade **anterior**, do cliente,
com mecanismo lido em `js/fila.js`. Cartada em T-B47AB7.

Do Arquiteto, e vale como regra: **"uma rodada 174/174 não é 'a suíte passa', é 'a
suíte pode passar'."**

## Decisões que tomei

- Rollback cancelado (VersionError do IndexedDB).
- Plano B (workflows v3 de marcacoes/cadastro) **não construído** — a API está
  mais perto, e o Plano B escreveria em `efrat_pessoa`/`efrat_template` vivos.
- Escopo do aparelho **não vale para escrita**, e o meio-caminho de
  `requer_revisao` **não é adotado**: o que barra marcação alheia é a biometria,
  não o escopo, e taxar o remanejado treina o RH a limpar a fila sem olhar.
- `inserirUsuarioRh` **fora da interface**; semente por SQL direto.
- Critério do API-1 revisado: a forma literal que escrevi não era cumprível nem
  antes da extração.
- Escopo de amanhã: **8 rotas**, com `rh/face/cadastrar` entrando por achado do
  Designer — sem ela ninguém é reconhecido e o teste morre no passo 3.

## Regra de processo que o dia produziu

**Decisão comunicada a uma pessoa é decisão que volta.** `inserirUsuarioRh` foi
recusado por mim e reentrou por DevOps → Persistência → Arquiteto, chegando como
necessidade técnica em vez de decisão já tomada. O motivo é a parte que viaja mal.

E o Arquiteto completou o par: **"aditivo" desligou a conferência do CUSTO; vir de
dois saltos desligou a conferência da DECISÃO.** Cada uma sozinha ele teria pego.
A regra tem de ser sobre o CAMINHO da informação, não sobre o tamanho da mudança.

## O que depende do usuário

1. **Deploy** — `vercel deploy --prod` barrado. Sem ele não há teste.
2. **Env de preview** — barrada. Sem ela a linha "pilha HTTP" fica NÃO MEDIDA,
   o que é aceitável se estiver escrito.
3. **Pista** — `vizuFlow` com navegador e 3 servidores órfãos. Ninguém derrubou
   processo de outro projeto, de propósito.
4. **Existe ponto real por outro canal?**

## Falta antes do teste

Portão do Full-Stack (174 contra as 8 rotas, com `--retries=1`) · semente
verificada **por login de verdade** · runbook com a seção dos comandos barrados.
