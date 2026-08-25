# Roteiro do teste em produção — Control Face ID

Este documento é para quem vai testar o sistema amanhã: RH, gestor de equipe e
quem participar como colaborador na frente da câmera. Não é preciso entender
nada de tecnologia para seguir — cada passo diz o que fazer, o que a tela deve
mostrar quando dá certo, e o que fazer se aparecer outra coisa.

## Leia isto antes de começar

Este roteiro descreve o comportamento da versão publicada identificada pelo
commit `cadb6bc` (o "código de série" que o service worker mostra é
`efrat-ponto-v16` — é assim que a equipe confirma qual versão está no ar). Se
amanhã subir uma versão nova antes do teste (a equipe está trocando a parte
de dentro do sistema que fala com os aparelhos), confirme com a equipe
técnica se as telas abaixo continuam batendo antes de seguir o roteiro às
cegas — versão diferente pode ter tela diferente.

Este aviso se autoinvalida, ou seja, ele para de valer sozinho quando a
condição abaixo deixar de ser verdade — não tem uma data para sumir:

> Enquanto a equipe técnica não confirmar que o cadastro de aparelho novo
> (o que o Passo 1 usa por trás da tela) já está publicado de verdade,
> tentar o Passo 1 vai travar com um erro de conexão ou "aparelho não
> aprovado" — não é falha de quem está testando, nem defeito do aparelho.
> **Antes de começar o teste, pergunte à equipe técnica se essa confirmação
> já saiu.** Se sim, ignore este aviso e siga o roteiro normalmente.

---

## Passo 1 — Aparelho novo pede liberação

**O que fazer:** abra o aplicativo num aparelho que nunca foi usado antes
(celular ou tablet da empresa). Não é preciso digitar nada nem instalar nada.

**O que a tela DEVE mostrar:** a mensagem "Quase lá", um código curto de
letras e números bem grande na tela, e o texto "Mostre este código para quem
cuida do RH — é só isso, você não precisa fazer mais nada agora." A tela fica
sozinha nesse estado, esperando; ela muda de tela por conta própria assim que
o RH liberar, sem precisar recarregar nada.

**Se vier diferente:**
- A tela ficar em branco ou travada sem mostrar código nenhum → provavelmente
  o aparelho está sem internet. Confira o Wi-Fi/dados e espere alguns
  segundos; a tela tenta de novo sozinha.
- Aparecer "Este aparelho não foi liberado. Fale com quem cuida do RH." →
  alguém do RH já **recusou** esse pedido antes. Peça para o RH abrir de novo
  a tela de aparelhos e conferir.
- Aparecer "Este aparelho teve o acesso revogado. Fale com quem cuida do RH."
  → esse aparelho já tinha sido liberado antes e alguém do RH cancelou o
  acesso dele. Não é o caso normal de "aparelho novo" — se acontecer com um
  aparelho que você considera novo, avise a equipe.

## Passo 2 — RH libera o aparelho digitando o código

**O que fazer:** quem estiver com acesso de RH entra no aplicativo (botão
"Sou do RH", usuário e senha) e abre a aba **Aparelhos**. Existe uma caixa de
texto com o rótulo "Código do aparelho" — digite ali exatamente o código que
apareceu na tela do aparelho no Passo 1, e toque em "Liberar".

Importante: **não existe uma lista para escolher o aparelho clicando** — é
preciso digitar o código à mão, de propósito. Só quem está olhando para a
tela do aparelho consegue ler esse código, então digitá-lo prova que quem
está liberando realmente está na frente do aparelho certo, e não liberando o
aparelho errado por engano.

Depois de digitar o código certo, aparece uma segunda pergunta: **"Quem bate
ponto neste aparelho?"**, com a lista de equipes para marcar (pode marcar
mais de uma). É obrigatório marcar pelo menos uma equipe antes de confirmar
"Liberar" de novo. Só quem estiver nessa equipe vai ser reconhecido por esse
aparelho.

**O que a tela DEVE mostrar:** depois de confirmar, aparece o aviso "Aparelho
liberado" e o aparelho passa a aparecer na lista "Liberados", com o nome dele
e "ainda não usou". Ao mesmo tempo, no aparelho do Passo 1, a tela de "Quase
lá" desaparece sozinha e dá lugar ao botão **REGISTRAR PONTO**, sem precisar
mexer no aparelho.

**Se vier diferente:**
- Aparecer "Código inválido" → o código foi digitado errado, ou já mudou (o
  aparelho gera um código novo se ficar esperando tempo demais). Peça para
  olhar de novo a tela do aparelho e digitar com calma.
- O aviso "Selecione ao menos uma equipe antes de liberar o aparelho." →
  faltou marcar a equipe antes de confirmar a segunda tela. Marque pelo menos
  uma e tente de novo.
- O aparelho do Passo 1 não mudar de tela sozinho depois de liberado → pode
  levar alguns segundos (o aparelho confere de tempos em tempos, não na
  hora). Se passar de um minuto, feche e abra o aplicativo de novo nele.

## Passo 3 — Colaborador marca o próprio ponto

**O que fazer:** com o aparelho já liberado, qualquer pessoa da equipe fica
de frente para a câmera olhando para ela. **Ninguém digita nada nem escolhe
o próprio nome** — o sistema reconhece o rosto sozinho.

**O que a tela DEVE mostrar:** primeiro "Identificando…", depois um cartão
com o nome da pessoa, se é entrada ou saída, e um botão grande **"CONFIRMAR
ENTRADA"** (ou "CONFIRMAR SAÍDA"). A própria pessoa que está na câmera toca
nesse botão para confirmar — ninguém confirma em nome de outra pessoa. Depois
de confirmar, aparece o comprovante na tela (✓ ENTRADA/SAÍDA, hora e um
código de comprovante) por alguns segundos, e a câmera volta a ficar pronta
para a próxima pessoa sozinha.

**Se vier diferente:**
- Aparecer "Rosto não reconhecido" → a pessoa provavelmente ainda não tem o
  rosto cadastrado no sistema (ver a nota sobre cadastro por link, abaixo).
  Depois de algumas tentativas seguidas sem reconhecer, aparece o botão
  "Registrar manualmente" — é a saída de segurança: **o ponto nunca é
  negado**, mesmo quando o reconhecimento falha.
- Aparecer "[Nome] já marcou agora há pouco" → é o sistema evitando marcar a
  mesma pessoa duas vezes seguidas por engano (por exemplo, se ela passar de
  novo na frente da câmera sem querer). Normal, não é erro.
- O cartão vier marcado como "vai para conferência" → a marcação foi aceita
  mesmo assim, só que o RH vai revisar essa marcação depois com calma, antes
  dela virar ponto definitivo. Isso é esperado em alguns casos (por exemplo,
  quando quem marca é o próprio gestor — ver Passo 4) e não trava o
  colaborador.

## Passo 4 — Gestor confere

O gestor marca o próprio ponto exatamente como qualquer outro colaborador
(Passo 3) — não existe um botão separado "confirmar ponto da equipe". A
diferença aparece **depois** do comprovante do gestor: surge um link discreto
"Ver minha equipe", que só aparece para quem o sistema reconheceu como
gestor, e só depois de tocar nele mesmo.

**O que fazer:** depois de marcar o próprio ponto, o gestor toca em "Ver
minha equipe".

**O que a tela DEVE mostrar:** um painel com o resumo da equipe (quem já
marcou, quem falta) para aquele dia — é aqui que o gestor confere a situação
do turno, sem precisar aprovar marcação por marcação.

**Se vier diferente:**
- O link "Ver minha equipe" não aparecer depois do comprovante do gestor →
  normal se a marcação dele não tiver sido feita com internet no momento
  (o reconhecimento de gestor depende de uma confirmação com o sistema). Não
  trava o ponto do gestor, só o painel de equipe fica indisponível daquela
  vez.
- O painel abrir vazio ou travado em "Carregando…" → sem conexão no momento;
  espere ou tente de novo com internet.

---

## Duas coisas que provavelmente vão estranhar

### 1. O primeiro cadastro de rosto por link fica sempre pendente

Quando alguém ainda não tem o rosto cadastrado, o caminho é o RH mandar um
link para o celular da pessoa. Ela abre o link, vê o próprio nome ("Oi,
[Nome]!"), toca em "Começar" e tira 3 fotos. No final aparece "Pronto" e a
instrução para fechar a página.

**Isso não ativa o reconhecimento na hora.** O cadastro entra numa fila de
espera do RH ("Primeiro cadastro", na aba Pendências) e só passa a valer
depois que alguém do RH olhar as fotos e aprovar. Enquanto isso, a pessoa
ainda não é reconhecida pela câmera (ela cai no caso "Rosto não reconhecido"
do Passo 3, e pode registrar manualmente enquanto espera).

Isso **é de propósito, não é bug**: é a defesa contra alguém cadastrar o
próprio rosto no lugar de outra pessoa pelo link. Por isso o RH sempre vê o
aviso "Confira se é a pessoa certa. Este cadastro veio pelo celular do
colaborador e ninguém do RH acompanhou a captura." e só consegue aprovar
depois de marcar que conferiu a foto — nunca existe um "aprovar todos".

### 2. O sistema não julga se a pessoa está com a cabeça inclinada

Esta é a mesma explicação que está no README do projeto, palavra por
palavra, para não haver duas versões da mesma coisa:

> O cadastro não recusa uma foto por "queixo baixo" isolada — só compara a
> pose das 3 fotos entre si. Medir se uma cabeça está inclinada, sozinha,
> exigiria assumir um valor de referência do que é "olhar reto pra frente",
> e esse valor muda de pessoa pra pessoa (formato de rosto, idade). Cravar
> esse valor recusaria mais gente com um formato de rosto do que com outro
> — e faria isso sem ninguém decidir que era essa a intenção. Por isso o
> sistema não tenta: ele é cego a inclinação absoluta de cabeça, igual para
> todo mundo, de propósito. O que ele checa é diferente: se as 3 fotos do
> mesmo cadastro têm pose parecida entre si — se uma foto vier com a cabeça
> muito mais baixa que as outras duas, o cadastro pede para repetir as 3
> fotos.

Na prática: ninguém vai ser recusado no cadastro por "olhar torto" sozinho —
só se as 3 fotos não baterem entre si.

---

## Resumo rápido — em que passo travou?

| Se travou em... | O que checar primeiro |
|---|---|
| Aparelho não mostra código nenhum | Internet do aparelho |
| RH digita o código e dá "Código inválido" | Releu o código na tela do aparelho? Ele pode ter mudado |
| Aparelho liberado não vira "REGISTRAR PONTO" sozinho | Espere até 1 minuto; senão, feche e abra o app |
| Rosto não reconhecido na câmera | A pessoa já tem cadastro aprovado pelo RH? Ver seção "primeiro cadastro" acima |
| Ponto aceito mas foi para conferência | Normal para ponto do próprio gestor ou reconhecimento incerto — não é falha |
| "Ver minha equipe" não aparece pro gestor | Sem internet no momento da marcação dele |

<!--
NOTA INTERNA — não é para o cliente, não apagar antes de revisar.

Gatilho de revisão desta nota (Orquestrador, 2026-08-25): quando o
Full-Stack (615dfda777) entregar as rotas da API própria substituindo o
n8n/v2, os pontos abaixo têm texto de tela que hoje vem do backend v2/n8n e
pode mudar de wording ou de condição de disparo. Marcado agora para não
precisar reler o documento inteiro depois — conferir cada um contra os
erros reais da API nova antes de atualizar a linha do build no topo.

- Passo 1, mensagens "Este aparelho não foi liberado..." e "...acesso
  revogado...": vêm de `info.estado` (`/efrat/dispositivo/estado`). A API
  nova pode devolver estados/textos diferentes.
- Passo 2, "Código inválido": é fallback do app (`r.erro || 'Código
  inválido'`) — se a API nova preencher `r.erro` com outra coisa, o texto
  real na tela muda.
- Passo 2, "Aparelho liberado" / fluxo de 2 telas (código → escolher
  equipes): a mecânica é do app (`js/rh.js`), deve sobreviver à troca de
  backend, mas os erros de digitação/repetição podem vir com mensagens
  novas da API.
- "Duas coisas que provavelmente vão estranhar" § 1 (cadastro por link
  pendente): depende do contrato de `/efrat/rh/dados` (campo
  `recadastros`) continuar igual na API nova — mecanismo já fechado em
  contrato (FASE 3), risco baixo, mas conferir mesmo assim.
- Passo 3, "Rosto não reconhecido": condição de disparo depende de
  `/efrat/identificar` responder dentro do tempo esperado — API nova pode
  mudar latência/timeout e mudar com que frequência esse caso aparece.
-->

