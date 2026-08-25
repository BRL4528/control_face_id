# Roteiro do teste em produção — Control Face ID

Este documento é para quem vai testar o sistema amanhã: RH, gestor de equipe e
quem participar como colaborador na frente da câmera. Não é preciso entender
nada de tecnologia para seguir — cada passo diz o que fazer, o que a tela deve
mostrar quando dá certo, e o que fazer se aparecer outra coisa.

## Leia isto antes de começar

**Amanhã é um teste, não a virada para todo mundo.** O teste roda num
aparelho separado, com uma equipe e algumas pessoas cadastradas só para
isso — ninguém que já bate ponto hoje é afetado, e nada aqui muda o que já
está funcionando para o resto da empresa. Se algo não sair perfeito amanhã,
isso não tira o ponto de ninguém que já trabalha com o sistema atual.

Este roteiro cobre só o que o sistema novo já sustenta com segurança para
esse teste: aparelho pedindo liberação, RH liberando, RH cadastrando o rosto
do colaborador na hora, colaborador marcando o próprio ponto. Deixei de fora
(numa seção própria, mais abaixo) partes do sistema que existem mas que não
estão garantidas para amanhã, para não prometer tela que pode não estar de
pé no dia.

Este aviso se autoinvalida, ou seja, ele para de valer sozinho quando a
condição abaixo deixar de ser verdade — não tem uma data para sumir:

> Enquanto a equipe técnica não confirmar que as oito chamadas que este
> teste usa (a que cadastra o aparelho, a que confere se ele foi liberado, a
> que faz login do RH, as duas que liberam aparelho pela aba Aparelhos, a
> que salva o rosto cadastrado pela câmera do RH, a que carrega a equipe no
> aparelho e a que envia a marcação de ponto) estão todas respondendo de
> verdade, tentar qualquer passo abaixo pode travar com erro de conexão —
> não é falha de quem está testando, nem defeito do aparelho. **Antes de
> começar o teste, pergunte à equipe técnica se essa confirmação já saiu.**
> Se sim, ignore este aviso e siga o roteiro normalmente.

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

## Passo 3 — RH cadastra o rosto do colaborador (câmera do computador)

Antes de alguém conseguir bater ponto pela câmera, o rosto dela precisa estar
cadastrado. No teste de amanhã isso acontece **na hora**, feito pelo RH, num
computador com câmera — não é a câmera do aparelho de ponto do Passo 1/2, é
outra câmera (do notebook/computador que o RH está usando).

**O que fazer:** o RH abre a aba **Colaboradores**, escolhe a pessoa e toca
em **"Cadastrar biometria"**. Aparece a pergunta "Como cadastrar o rosto?"
com duas opções — escolha **"Câmera do computador"**. Com a pessoa sentada
de frente para essa câmera, sem boné, óculos escuros ou máscara, o RH toca em
**"Capturar 1/3"**, pede para a pessoa mexer um pouco a cabeça, e repete até
completar as 3 capturas. Por fim, toca em **"Salvar biometria"**.

**O que a tela DEVE mostrar:** a cada captura aparece uma miniatura da foto
tirada, e o botão passa de "Capturar 1/3" para "2/3", depois "3/3" e por fim
"Completo". O botão "Salvar biometria" só fica clicável depois das 3 fotos.
Ao salvar, aparece o aviso **"Biometria salva"** e a tela fecha sozinha —
diferente do cadastro por link (ver "Fora do escopo de amanhã"), este **não**
fica esperando aprovação de ninguém: como foi o próprio RH que viu a pessoa
na captura, o rosto já vale a partir daqui, pronto para o Passo 4.

**Se vier diferente:**
- Aparecer "Nenhum rosto — tire óculos escuros ou máscara" ao tentar
  capturar → é só o aviso de qualidade; peça para tirar o acessório e tentar
  de novo.
- Aparecer "Qualidade insuficiente: [algum motivo]" → a foto ficou escura,
  desfocada ou de lado demais. Tente de novo com mais luz e a pessoa olhando
  para a câmera.
- Aparecer "As 3 fotos não deram certo — pareceram de pessoas diferentes.
  Tire as 3 de novo com calma; se continuar assim, avise o RH." → alguma
  captura pode ter pego outra pessoa passando atrás, ou a pessoa se mexeu
  demais entre uma foto e outra. Repita as 3 com calma.
- Aparecer "As 3 fotos ficaram iguais demais. Mova um pouco a cabeça entre
  as capturas e tente de novo." → a pessoa ficou parada igual nas 3. Peça
  para virar levemente a cabeça entre uma captura e outra.
- Aparecer "As fotos não ficaram boas pra usar. Tire as 3 de novo, com boa
  luz e o rosto bem visível." → problema técnico na foto em si (luz, foco).
  Refaça com mais luz.

## Passo 4 — Colaborador marca o próprio ponto

**O que fazer:** com o aparelho já liberado e o rosto já cadastrado no Passo
3, a pessoa fica de frente para a câmera do aparelho de ponto, olhando para
ela. **Ninguém digita nada nem escolhe o próprio nome** — o sistema reconhece
o rosto sozinho.

**O que a tela DEVE mostrar:** primeiro "Identificando…", depois um cartão
com o nome da pessoa, se é entrada ou saída, e um botão grande **"CONFIRMAR
ENTRADA"** (ou "CONFIRMAR SAÍDA"). A própria pessoa que está na câmera toca
nesse botão para confirmar — ninguém confirma em nome de outra pessoa. Depois
de confirmar, aparece o comprovante na tela (✓ ENTRADA/SAÍDA, hora e um
código de comprovante) por alguns segundos, e a câmera volta a ficar pronta
para a próxima pessoa sozinha.

**Se vier diferente:**
- Aparecer "Rosto não reconhecido" para alguém que passou pelo Passo 3 →
  não tente resolver testando de novo várias vezes; avise quem está
  coordenando o teste, porque pode ser a pessoa errada na equipe carregada
  no aparelho (ver a escolha de equipes do Passo 2), não um problema da
  câmera. Depois de algumas tentativas seguidas sem reconhecer, aparece o
  botão "Registrar manualmente" — é a saída de segurança: **o ponto nunca é
  negado**, mesmo quando o reconhecimento falha.
- Aparecer "[Nome] já marcou agora há pouco" → é o sistema evitando marcar a
  mesma pessoa duas vezes seguidas por engano (por exemplo, se ela passar de
  novo na frente da câmera sem querer). Normal, não é erro.
- O cartão vier marcado como "vai para conferência" → a marcação foi aceita
  mesmo assim, só que o RH vai revisar essa marcação depois com calma, antes
  dela virar ponto definitivo. Isso é esperado em alguns casos (por exemplo,
  quando quem marca é o próprio gestor) e não trava o colaborador.

---

## Fora do escopo de amanhã

Duas partes do sistema **existem no código**, mas não fazem parte do que
está garantido para o teste de amanhã — cito aqui só para ninguém estranhar
a ausência nem tentar forçar algo que não vai responder:

- **Painel "Ver minha equipe" do gestor.** Depois de marcar o próprio ponto
  (igual a qualquer colaborador), o gestor pode ver um link "Ver minha
  equipe" que abre um resumo de quem já marcou no dia. Essa tela usa uma
  parte do sistema que não está na lista garantida para amanhã — se o link
  não aparecer, ou o painel não carregar, não é falha do teste.
- **Cadastro de rosto pelo celular (link) durante o teste.** O caminho normal
  para cadastrar alguém que ainda não tem rosto registrado é o RH mandar um
  link para o celular da pessoa; ela tira 3 fotos e o cadastro fica pendente
  até o RH aprovar. Essa aprovação também não está garantida para amanhã.
  Combine com a equipe técnica se isso vai poder ser demonstrado no teste ou
  se fica para depois.

## Duas coisas que provavelmente vão estranhar

### 1. O primeiro cadastro de rosto por link fica sempre pendente

*(Contexto para entender o sistema — ver "Fora do escopo de amanhã" acima:
isso pode não dar para demonstrar ao vivo no teste de amanhã, mas vale saber
como funciona, porque é comportamento do sistema, não do teste.)*

Quando alguém ainda não tem o rosto cadastrado, o caminho é o RH mandar um
link para o celular da pessoa. Ela abre o link, vê o próprio nome ("Oi,
[Nome]!"), toca em "Começar" e tira 3 fotos. No final aparece "Pronto" e a
instrução para fechar a página.

**Isso não ativa o reconhecimento na hora.** O cadastro entra numa fila de
espera do RH ("Primeiro cadastro", na aba Pendências) e só passa a valer
depois que alguém do RH olhar as fotos e aprovar. Enquanto isso, a pessoa
ainda não é reconhecida pela câmera (ela cai no caso "Rosto não reconhecido"
do Passo 4, e pode registrar manualmente enquanto espera).

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
| RH não consegue salvar a biometria (Passo 3) | Refaça as 3 fotos variando um pouco a posição da cabeça entre elas |
| Rosto não reconhecido na câmera (Passo 4) | O Passo 3 foi feito pra essa pessoa antes? Ela está na equipe escolhida no Passo 2? |
| Ponto aceito mas foi para conferência | Normal para ponto do próprio gestor ou reconhecimento incerto — não é falha |
| "Ver minha equipe" não aparece pro gestor | Sem internet no momento da marcação dele |

<!--
NOTA INTERNA — não é para o cliente, não apagar antes de revisar.

Atualizado em 2026-08-25 depois do reenquadramento do Orquestrador: o
escopo de amanhã não é mais "as 7 rotas do primeiro turno" contra
n8n/v2 — é 8 rotas contra a API própria (registrar, estado, rh/sal,
rh/aparelhos, rh/aparelho/aprovar, rh/face/cadastrar, carga, marcacoes),
porque sem cadastro de rosto ao vivo (rh/face/cadastrar) ninguém real
seria reconhecido no Passo 4 — semear vetor de fixture não resolve, não
casa com rosto de gente de verdade. Isso empurrou o Passo 3 (RH cadastra
biometria pela câmera) para dentro do roteiro numerado, antes do que era
"Passo 3" (agora Passo 4).

Gatilho de revisão desta nota: quando o Full-Stack (615dfda777) confirmar
as 8 rotas em produção de verdade (não só implementadas), revisar os
pontos abaixo contra os erros reais que a API devolve.

- Passo 1, mensagens "Este aparelho não foi liberado..." e "...acesso
  revogado...": vêm de `info.estado` (`/efrat/dispositivo/estado`).
- Passo 2, "Código inválido": é fallback do app (`r.erro || 'Código
  inválido'`) — se a API preencher `r.erro` com outra coisa, o texto real
  na tela muda.
- Passo 3, erro ao "Salvar biometria": FECHADO e confirmado por e2e (8/8
  verde, Biometria/bdf5f40f33, 2026-08-25) — `salvarBiometria()` em
  `js/rh.js` agora reusa o texto já aprovado de `js/fila.js`
  (COERENCIA_INSUFICIENTE/FOTOS_IGUAIS/VETORES_INVALIDOS). Texto do roteiro
  já é o real, sem ressalva pendente.
- `VETORES_INVALIDOS` no upload (js/rh.js) segue sem decodificar — combinado
  que fica pra depois por ser caminho quase inalcançável (client já bloqueia
  os 3 slots antes do botão habilitar). Não afeta o roteiro de amanhã
  (upload nem está no escopo garantido).
- Passo 3, "Biometria salva" e a ausência de fila de aprovação: confirmado
  no código (`servidor-falso.js`, origem `rh_camera` grava `estadoTemplate
  = 'ativo'` direto) — não é suposição, é como o contrato já fecha isso.
  Baixo risco de mudar na API nova, mas confirmar mesmo assim.
- Passo 4, "Rosto não reconhecido": condição de disparo depende de
  `carga` trazer `vetores` de verdade pra quem passou pelo Passo 3 —
  timing entre salvar a biometria e a próxima `carga` do aparelho pode
  importar (cache local?) se o aparelho não recarregar a galeria sozinho
  depois do cadastro.
- "Duas coisas que provavelmente vão estranhar" § 1 (cadastro por link
  pendente) e "Fora do escopo" (painel do gestor, link do celular): ambos
  usam rotas fora das 8 (`/efrat/cadastro` origem link, `rh/decidir`,
  `gestor/equipe-hoje`) — conferir se seguem fora do escopo perto da hora
  do teste, porque escopo mudou uma vez hoje e pode mudar de novo.
-->

