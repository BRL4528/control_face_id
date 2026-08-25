# Runbook — publicar e conferir o teste em produção

Escrito para quem **não acompanhou o dia**. Cole os comandos na ordem. Cada
passo tem o que rodar, o que esperar ver, e o que fazer quando não vier isso.

**Regra deste documento:** nenhum passo depende de julgamento na hora. Onde
houver decisão, está escrito **PARE E CHAME A EQUIPE**. Isso não é fraqueza do
runbook — é a única resposta honesta quando a decisão não cabe num comando.

Antes de começar:

```bash
cd <raiz-do-repo>
git log --oneline -1     # confira que está no commit combinado, NÃO em `main`
```

> O ponteiro `main` local deste projeto está desatualizado e **não** é o que está
> publicado. Use o commit que a equipe indicar.

---

## LEIA PRIMEIRO — o que só você consegue rodar

Os comandos desta seção são **barrados no ambiente dos agentes** por um
classificador de permissão local. Não é limitação da Vercel nem da conta. Nós
preparamos tudo até a borda deles; a execução é sua.

**Descobrir isso um a um amanhã custa uma parada por descoberta.** Por isso está
aqui em cima, com a consequência de cada um — elas não são iguais, e é isso que
diz onde gastar seu tempo primeiro.

### 1. Publicar a API em produção — SEM ISSO NÃO HÁ TESTE

> **ANTES DE PUBLICAR, A SAÚDE DE PRODUÇÃO MENTE — e mente dizendo `ok:true`.**
>
> Se você conferir agora, vai ver o formato **velho**, de um deploy anterior:
>
> ```json
> {"ok":true,"banco":"ok","servidor_hora":"..."}          ← MUNDO VELHO
> ```
>
> Esse `ok:true` **não significa nada**: ele diz só que a função subiu e falou
> com o banco. Não diz que existe rota nenhuma. Foi exatamente esse tipo de
> `200` que fez cinco pessoas concluírem que o conjunto estava de pé quando
> nada estava publicado.
>
> Depois de publicar, o formato é outro:
>
> ```json
> {"ok":true,"banco":"ok","nucleo":"ok","rotas":8,...}    ← MUNDO NOVO
> ```
>
> **Como saber em qual mundo você está, sem decorar nada:** procure os campos
> `nucleo` e `rotas`. Se eles **não aparecem**, a resposta veio do deploy velho
> e você ainda não publicou. Não existe `ok:true` legítimo sem `rotas`.

```bash
cd servidor && npm run publicar:prod && cd ..
```

Confira:

```bash
curl -s https://control-face-id-api.vercel.app/api/saude
```

**Esperado:** `{"ok":true,"banco":"ok","nucleo":"ok","rotas":8,...}`
**Se `rotas` vier `0`:** a API subiu sem rota nenhuma. **PARE E CHAME A EQUIPE.**
**Se não rodar:** não há API. O teste não acontece. **Prioridade máxima.**

> `npm run publicar:prod` copia o núcleo do domínio e publica **no mesmo
> comando**, de propósito: copiar hoje e publicar amanhã é como se fabrica uma
> cópia velha.

### 2. Publicar o app do operador em produção — SEM ISSO NÃO HÁ TESTE

> **A ORDEM AQUI NÃO É PREFERÊNCIA, É DEPENDÊNCIA.** O app agora aponta para a
> origem própria da API (`js/config.js`), não mais para o n8n. Se você publicar
> o app **antes** do passo 1, ele vai falar com uma API que ainda não tem rota
> nenhuma — e o sintoma no aparelho é "não consegui conectar", que não aponta
> para a causa.
>
> Só publique o app depois de o passo 1 responder `"rotas":8`.

```bash
vercel link --yes --project control-face-id --scope brl4528s-projects
vercel deploy --prod --yes
```

Confira:

```bash
curl -sI https://control-face-id.vercel.app/ | grep -i content-security-policy
```

**Esperado:** um `connect-src` contendo `https://control-face-id-api.vercel.app`.
**Se não rodar:** o cliente abre a versão antiga do app. O teste não acontece.

### 3. Rotacionar o segredo de Protection Bypass — DEPOIS do teste

O QA expôs esse segredo no terminal ao inspecionar `vercel curl -v`. Ele avisou
por conta própria e **não o commitou**. Risco baixo (é preview, e o banco atrás
é o descartável), mas é segredo e tem dono conhecido.

No painel: **control-face-id-api → Settings → Deployment Protection → Protection
Bypass for Automation → Regenerate**.

**Não faça antes do teste:** é a única forma de o arnês do QA alcançar o preview,
e rotacionar agora tira a medição sem ganho nenhum.
**Se não rodar:** um segredo de preview segue válido. Não afeta o teste.

### 4. Desligar Deployment Protection do preview — OPCIONAL

Só se o QA pedir. Hoje ele já alcança o preview pelo bypass.
**Se não rodar:** nada. Já está resolvido por outro caminho.

### O que NÃO precisa da sua mão

Já foi feito e conferido: banco provisionado e migrado, credenciais de teste,
banco descartável do arnês, CSP nas três origens, guardas de CI, rewrites de
rota. Você só publica e confere.

---

## Se você fez um merge antes de publicar — leia isto

**Depois de qualquer merge, PUBLIQUE e confira por curl antes de confiar.**
Teste de unidade, fumaça e até a saúde da API passam por cima da classe de
defeito abaixo.

Aconteceu na madrugada de 25/08 e está cartado como **T-99A2E3**. A forma:

Duas pessoas editaram `servidor/persistencia/postgres.js` em **linhas
diferentes** — uma corrigiu a leitura da chave do RH, a outra corrigiu o caminho
de um `import`. O git resolveu o merge **limpo**, sem conflito, sem avisar
ninguém. Só que uma das versões trazia o caminho de import antigo, e o resultado
publicado foi:

```
todas as 8 rotas   → FUNCTION_INVOCATION_FAILED
/api/saude         → 200, "ok":true, "rotas":8
```

A saúde ficou verde porque **ela não passa pelo adaptador de banco**. O sinal
mais tranquilizador possível apontando para o lugar errado.

**O que fazer:** depois de integrar qualquer coisa, rode o passo 5 (a varredura
das 8 rotas) e olhe o **corpo**, não só o status. Se as 8 responderem
`FUNCTION_INVOCATION_FAILED` com a saúde verde, é exatamente este caso —
**PARE E CHAME A EQUIPE**, e diga que é a T-99A2E3.

---

## O mapa: três origens, e elas não são a mesma coisa

| | Projeto Vercel | Onde | Publica o quê |
|---|---|---|---|
| App do operador | `control-face-id` | `https://control-face-id.vercel.app` | raiz do repo |
| **API** | `control-face-id-api` | `https://control-face-id-api.vercel.app` | `servidor/` |
| Página pública | *(ainda não existe)* | — | `publico/` |

Confundir duas delas desfaz o isolamento **sem quebrar nada visivelmente**. Se um
comando abaixo parecer estar no projeto errado, pare.

---

## Passo 0 — Você precisa estar logado na Vercel

```bash
vercel whoami
```

**Esperado:** o nome da conta (ex.: `brl4528`).
**Se falhar:** `vercel login`. É interativo e abre o navegador.

---

## Passo 1 — Semear o banco da demo

**Este passo vem antes de publicar.** Se a API subir com o banco vazio, o RH não
consegue entrar e o teste para no passo 2 do roteiro.

Escolha a senha do RH **com quem vai operar o RH amanhã**, antes de rodar. Ela
não é recuperável: o servidor guarda só a chave derivada.

```bash
cd servidor
vercel link --yes --project control-face-id-api --scope brl4528s-projects
vercel env pull .env.local --yes
npm install
node persistencia/migrar.js
cd ..
SENHA_RH='<a-senha-combinada>' node servidor/semear.mjs --repo pg
```

**Esperado**, nesta ordem:

```
aplicando: 0001_init.sql
migracoes em dia.
...
  +  equipe Equipe Um
  +  equipe Equipe Dois
  +  pessoa Ana Souza
  +  pessoa Bruno Lima
  +  pessoa Carla Dias
  +  pessoa Gestor Piloto
  +  usuario de RH "rh" (SQL direto — excecao documentada)
  +  chave do RH conferida por re-derivacao (150000 iteracoes)

  aparelho: NENHUM — o codigo curto nasce no proprio aparelho, no passo 1
  rosto:    NENHUM — entra ao vivo pelo RH, pela camera do PC
  marcacao: NENHUMA — o roteiro nao depende de historico
```

Rodar de novo é seguro: o que já existe aparece como `= (ja estava)`.

**Os três `NENHUM` são o desenho, não falta de dado.** O aparelho pede liberação
no passo 1 do roteiro; o rosto entra ao vivo pelo RH; o roteiro não usa histórico.

### Por que o usuário de RH nasce por SQL direto

Nenhuma das 8 rotas cria usuário de RH, de propósito — abrir esse método poria
na produção uma capacidade privilegiada de escrita que nenhum caminho de produto
exercita. **Não é rota faltando.** Quem repetir este ambiente precisa rodar
`semear.mjs`; não existe tela para isso.

### Se der errado

| Sintoma | O que é | O que fazer |
|---|---|---|
| `falta SENHA_RH no ambiente` | você não passou a senha | releia o comando acima |
| `SENHA_RH com menos de 8 caracteres` | senha curta demais | escolha outra |
| `iteracoes gravado = N, e o cliente de producao usa 150000` | semente dessincronizada do cliente | **PARE E CHAME A EQUIPE.** O login do RH falharia dizendo "usuário ou senha inválidos" com a senha certa |
| `a chave gravada NAO bate com a que js/cripto.js deriva` | idem | **PARE E CHAME A EQUIPE** |
| `nao achei o adaptador de Postgres` | falta o código do API-3 no commit | **PARE E CHAME A EQUIPE** |
| `relation "efrat_..." does not exist` | a migration não rodou | rode `node servidor/persistencia/migrar.js` e repita |

---

## Passo 2 — Publicar a API

```bash
cd servidor && npm run publicar:prod && cd ..
```

**Esperado:** primeiro `nucleo/ copiado da raiz: N arquivos`, depois
`readyState: "READY"` e `target: "production"`.

Não use `vercel deploy --prod` direto: ele publica **sem** o núcleo do domínio.

### Conferir

```bash
curl -s https://control-face-id-api.vercel.app/api/saude
```

**Esperado, literalmente:**

```json
{"ok":true,"banco":"ok","nucleo":"ok","rotas":8,"servidor_hora":"..."}
```

Os três campos respondem coisas diferentes, e **todos** precisam estar certos:

| campo | o que prova | se estiver errado |
|---|---|---|
| `"banco":"ok"` | a função **executou uma consulta** no Postgres | `"indisponivel"` → HTTP 503 |
| `"nucleo":"ok"` | o núcleo do domínio foi **copiado no build e carrega** | `"ausente"` → publicou sem `npm run publicar:prod` |
| `"rotas":8` | há **8 rotas registradas** | `0` → API vazia, e a resposta é 503 |

**`"rotas":0` é 503 de propósito.** Uma origem de API sem rota nenhuma não está
saudável, está vazia — e uma saúde que respondia `200` com zero rota foi
exatamente o que escondeu, por horas, que nada estava publicado.

### A PERGUNTA VEM ANTES DO CAMPO

Os campos não têm todos o mesmo peso, e **qual deles manda depende do que você
está perguntando**. Decida a pergunta primeiro:

| Você quer saber | Quem responde |
|---|---|
| **"isto está funcionando?"** | `banco`, `nucleo`, `rotas` — eles observaram o que está executando |
| **"isto é a versão que eu acabei de publicar?"** | **só** `commit` e `ref` |

Para **"está funcionando"**, quando dois campos discordarem, acredite no
primeiro grupo. Se `rotas:8` está verde e o `commit` parece estranho, o que
está no ar funciona — investigue o carimbo, não a API.

Para **"é a versão certa"**, o primeiro grupo é **mudo — e mudo não é
concordar.** `rotas:8` diz que o roteador resolveu um caminho **neste**
artefato. Não diz que este é o artefato **certo**. Um build antigo pode servir e
responder `rotas:8` verde, porque ele funciona — só não é o que você publicou.

> **É exatamente o estado de produção antes do passo 1.** A API responde com um
> build anterior: nada confuso, nada quebrado, só velho. Aplicar a regra de
> "está funcionando" a uma pergunta de versão faz você concluir "está tudo
> certo" e parar de procurar — no único cenário em que precisa continuar.

E uma armadilha no `arvore_suja`: **`true` é informação boa; `false` não é
atestado.** Ele só diz que o repositório não tinha mudança não commitada no
momento do carimbo — não diz nada sobre a montagem do artefato ter deixado
arquivo para trás, que já aconteceu neste projeto. Não pare por causa dele.

> Produção **não** revela o nome do banco, e isso é proposital. Um preview
> revela (`"banco_nome":"arnes"`), porque lá a pergunta "estou no banco
> descartável?" precisa de resposta antes de alguém gravar marcação.

### Se der errado

| Sintoma | O que fazer |
|---|---|
| `HTTP 503` com `"banco":"indisponivel"` | a API está no ar mas não alcança o Postgres. Repita o `vercel env pull` do passo 1 e republique. Se persistir, **PARE E CHAME A EQUIPE** |
| `HTTP 401/403` ou um redirecionamento | Deployment Protection ligada nesse projeto. **PARE E CHAME A EQUIPE** — desligar é no painel |
| `"banco":"sem_configuracao"` | `DATABASE_URL` não chegou. **PARE E CHAME A EQUIPE** |

---

## Passo 3 — Publicar o app do operador

**Não inverta com o passo 2.** Se o app subir antes da API, o aparelho que abrir
nesse intervalo tenta registrar contra uma origem que ainda não responde,
recebe erro de rede e mostra falha de conexão. Não corrompe nada — mas é
exatamente o susto que não se quer com o cliente na frente.

```bash
vercel link --yes --project control-face-id --scope brl4528s-projects
vercel deploy --prod --yes
```

### Conferir

```bash
curl -s https://control-face-id.vercel.app/js/config.js | grep apiBase
curl -sI https://control-face-id.vercel.app/ | grep -i content-security-policy
```

**Esperado:** a linha do `apiBase`, e um `connect-src` que contenha
**`https://control-face-id-api.vercel.app`**.

Se o `connect-src` não citar a origem da API, o navegador **bloqueia toda
chamada** e a tela não diz por quê — o erro só aparece no console. É a única
coisa aqui que quebra calada.

---

## Passo 4 — Provar o login do RH por HTTP

**Faça isto antes de chamar o cliente.** Linha no banco não prova que a chave
casa; só o login prova.

```bash
curl -s -X POST https://control-face-id-api.vercel.app/efrat/rh/sal \
  -H 'Content-Type: application/json' -d '{"usuario":"rh"}'
```

**Esperado:** `{"ok":true,"sal":"...","iteracoes":150000}`

**Se `iteracoes` não for 150000: PARE E CHAME A EQUIPE.** O navegador vai
derivar com esse número e produzir uma chave que o servidor não reconhece.

Agora o login completo, com a senha do passo 1:

```bash
SENHA_RH='<a-senha-combinada>' node -e '
  const { derivar } = await import("./js/cripto.js");
  const base = "https://control-face-id-api.vercel.app";
  const s = await (await fetch(base + "/efrat/rh/sal", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usuario: "rh" }) })).json();
  const chave = await derivar(process.env.SENHA_RH, s.sal, s.iteracoes);
  const r = await fetch(base + "/efrat/rh/aparelhos", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usuario: "rh", chave }) });
  console.log(r.status, (await r.text()).slice(0, 120));
' --input-type=module
```

**Esperado:** `200` seguido de um corpo com `"ok":true`.

| Resposta | O que significa | O que fazer |
|---|---|---|
| `200` | a semente presta e o RH entra amanhã | siga |
| `401` | **semente dessincronizada**, não senha errada — a senha aqui veio da mesma variável que semeou | reveja o passo 1; se repetir, **PARE E CHAME A EQUIPE** |
| `404` | a rota não está publicada nessa origem | **PARE E CHAME A EQUIPE** |

> Guarde a distinção: amanhã o operador vai ver **"usuário ou senha inválidos"**
> nos dois casos, e o conserto é oposto. Este `curl` é o que separa os dois.

---

## Passo 5 — Conferir a coluna do primeiro turno

```bash
for r in dispositivo/registrar dispositivo/estado rh/sal rh/aparelhos \
         rh/aparelho/aprovar rh/face/cadastrar carga marcacoes; do
  printf '%-26s ' "$r"
  curl -s -o /dev/null -w '%{http_code}\n' -m 20 -X POST \
    "https://control-face-id-api.vercel.app/efrat/$r" \
    -H 'Content-Type: application/json' -d '{}'
done
```

**Esperado:** **nenhum `404`.** Corpo vazio é pedido inválido, então `400`, `401`
ou `422` são respostas **boas** aqui — provam que a rota existe e recusou.

**`404` significa rota ausente.** Anote qual e **PARE E CHAME A EQUIPE**.

---

## O caminho de volta

### Se o teste correr mal, **NÃO faça rollback do app**

O app v2 abre o IndexedDB na versão 1 e o v3 na versão 2. Abrir com versão menor
que a existente lança `VersionError` — falha dura, por especificação. Num
aparelho que já rodou o v3, **o app v2 não sobe**, e a credencial fica dentro do
banco inalcançável. O rollback trocaria um erro por um app que não abre.

### O que fazer em vez disso

**Volta simples e verdadeira: não mexer no app, só apontar o `apiBase` de volta
para o n8n.**

1. Em `js/config.js`, `apiBase` volta a `https://n8n.samasc.com.br/webhook`.
2. `vercel deploy --prod --yes` na raiz.
3. Confirme: `curl -s https://control-face-id.vercel.app/js/config.js | grep apiBase`

**A CSP não precisa mudar** — `connect-src` já libera as duas origens ao mesmo
tempo, exatamente para esta volta ser um passo só. Se o rollback exigisse
republicar CSP, não seria rollback.

### O que essa volta NÃO conserta

A frota está partida desde 20/08: quem nunca ativou o service worker v3 continua
em v2 e nunca parou; quem ativou está com o app v3. Apontar o `apiBase` de volta
serve os aparelhos v2. **Aparelho que já virou v3 não volta por aqui** — isso é
trabalho de equipe, não de runbook. **PARE E CHAME A EQUIPE.**

### O que nunca fazer sozinho

- **Não desligue workflow do n8n.** São 79 workflows naquela instância e só uma
  fatia é do ponto. Os workflows v2 estão sustentando a frota v2 agora.
- **Não apague linha de `efrat_marcacao`.** Por contrato a marcação nunca é
  alterada; ela é o livro de ponto.

---

## O que precisa da sua mão, e por quê

Os comandos `vercel deploy --prod` e `vercel rollback` são **barrados no
ambiente dos agentes**. Não é limitação da Vercel nem da conta — é o
classificador de permissão local. Por isso este runbook existe: os passos 2 e 3
não podem ser executados por nós, só por você.

Se a origem da API para o arnês do QA precisar ficar acessível por HTTP simples,
**Protection Bypass for Automation** é uma configuração de painel
(Settings → Deployment Protection) e também precisa da sua mão.
