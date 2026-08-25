# Véspera do teste em produção · 25/08/2026 (Orquestrador)

## O reenquadramento que desfez o maior risco

Eu estava tratando amanhã como **virada**. Não é: é **teste**. A distinção
derruba a migração das Data Tables do caminho crítico — um teste não precisa do
histórico do cliente, precisa de um aparelho, uma equipe, algumas pessoas. A
frota de produção não se mexe; quem bate ponto em v2 continua em v2, intocado.

## Escopo: 8 rotas, e a oitava salvou o teste

Lista: `registrar`, `estado`, `rh/sal`, `rh/aparelhos`, `rh/aparelho/aprovar`,
`rh/face/cadastrar`, `carga`, `marcacoes`.

A oitava entrou por achado do Designer, que **perguntou em vez de escrever o
roteiro em cima da suposição**: reconhecimento usa `carga.pessoas`, e pessoa só é
reconhecida se vier com vetor de rosto. Nenhuma das 7 cadastrava rosto — o
colaborador chegaria na câmera e não seria reconhecido por ninguém, com tudo
"funcionando". E semear vetor não salva: os que temos são de fixture, nenhum
humano real casa com eles.

## O melhor momento do dia: um número forte que era vazio

O Full-Stack reportou "25 concorrentes, 1 vencedor" contra o adaptador em
memória. O QA chamou de **vazio, não preliminar**: em memória a janela entre ler
e gravar tem largura **zero** (uma thread, nenhum `await` no meio), então a
corrida não pode reprovar — daria o mesmo verde com a pior implementação
possível.

Não derrubou com argumento: mediu com o número do próprio Full-Stack e mostrou
que o **mesmo `if/else`, byte por byte, dá 25 vencedores** quando só muda onde o
dado mora. Virou `memoria-nao-mede.test.js`, com as asserções **invertidas** de
propósito.

E o corolário que impede alguém de comprar a garantia rodando mais forte:
aumentar de 20 para 200 concorrentes **não ajuda** — nenhuma concorrência abre
janela que não existe.

Era a frase que eu teria repetido ao cliente.

## O risco de amanhã está isolado numa peça só

O QA me disse que o veredito de concorrência dependia do adaptador do
Persistência, foi atrás, descobriu que não dependia, e entregou: repositório
**híbrido** (só os métodos atômicos disputados apontando para Postgres real, o
resto em memória — legítimo porque a janela de corrida mora inteira neles).

Medido contra banco real, nas duas rotas que gateiam amanhã:

| | atômico | ingênuo |
|---|---|---|
| `enviarLote` (marcacoes) | 0/5 quebradas | 5/5, pior caso 8 aceitos |
| `aprovar` (rh/aparelho/aprovar) | 0/5 quebradas | 5/5, pior caso 8 aprovações |

**Consequência:** a camada de rota do API-4 está correta, medida e não opinada. Se
amanhã essas duas falharem por corrida, o lugar de olhar é a **DDL e o adaptador
do Persistência** — não a camada de rota, já descartada como suspeita.

## Os três requisitos de DDL, todos com medição por trás

1. índice único em `marcacao.id_cliente` + `INSERT ... ON CONFLICT DO NOTHING`
2. `aprovarDispositivoPorCodigo` como `UPDATE ... WHERE codigo_curto=$1 AND
   estado='pendente' AND criado_em>$2 RETURNING`, rowcount decide
3. índice único **parcial** em `dispositivo(codigo_curto) WHERE estado='pendente'`

O (3) veio de um comentário que alguém deixou em `servidor-falso.js:1288`
declarando que `CODIGO_AMBIGUO` "só existiria com outro armazenamento (banco
real)". **Amanhã é essa condição.** Num Map a impossibilidade é de graça; no banco
vira escolha de DDL. Sem o índice, dois pendentes nascem com o mesmo código curto
e aprovar pode ativar **o aparelho errado**, com o operador vendo sucesso normal.

Lição registrada: **"sem caminho de teste no servidor falso" não é "impossível na
API"**. Há outras ocorrências dessa família; varredura fica para depois do teste.

## Decisões minhas neste bloco

- **Rollback cancelado** (VersionError do IndexedDB) — em `16afdb6`.
- **Cartão T-B7ECAC retirado.** Eu tinha mandado estreitar o `bin/pista` depois de
  verificar que os PIDs eram de outro projeto. O QA se corrigiu e me corrigiu: o
  recurso disputado é CPU/navegador, que é da **máquina** — estreitar teria
  removido um sinal correto e liberado rodada sob contenção sem aviso, em cima do
  problema de falso-vermelho por margem apertada.
- **(A) sobre (B) para o QA:** portão das 8 antes de endurecer invariantes que não
  gateiam amanhã. Ele perguntou duas vezes; a demora foi minha.
- **`rh/face/cadastrar` sem teste de corrida**, aceitando o julgamento do QA: sem
  invariante de versão por desenho, duas telas geram dois templates **pendentes**,
  e §4.3 já exige humano antes de qualquer um valer. Não há dano silencioso.

## Bloqueios que não são nossos

- **Pista tomada por outro projeto.** 29 processos de navegador + 1 servidor órfão
  de 2h15, **todos do `vizuFlow`**; nenhum do `control_face_id`. Os 174 e2e seguem
  não rodados. Escalado ao usuário — não derrubo processo de outro projeto dele.
- **`vercel deploy --prod` e `vercel rollback` barrados** pelo classificador para o
  DevOps. O teste de amanhã depende de deploy, e esse é o único item que nenhum
  dos nove destrava sozinho.

## O que está de pé, e em que grau

| grau | o quê |
|---|---|
| **medido contra banco real** | atomicidade de `marcacoes` e `aprovar` |
| **medido** | 8 rotas existem e respondem no formato do contrato (fumaça HTTP); 107 unitários; 16/16 contrato |
| **não rodado** | os 174 e2e — pista tomada |
| **não existe ainda** | adaptador Postgres do Persistência; semente do banco; deploy |

## Próximo passo

ETA do Persistência. Com o adaptador, o QA roda o completo por HTTP em minutos e
aí — e só aí — dá para dizer se as 8 estão de pé.
