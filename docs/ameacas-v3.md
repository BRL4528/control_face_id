# Ameaças v3 — tirar o token, entrar auto-provisionamento + face como credencial

Parecer de segurança sobre a direção arquitetural proposta em `docs/plano-v3.md`
(seção "Direção arquitetural proposta"), rodando em paralelo com a T-ARQ (T-66191D).
**Documento apenas — zero código, zero teste.** Baseado no estado real do repo em
`central/50bbfbf909/a7f15f0974-control_face_id` (`js/app.js`, `js/api.js`,
`js/store.js`, `js/fila.js`, `js/face.js`, `docs/api-piloto.md`,
`docs/fluxo-operacional.md`, `docs/validacao-biometrica.md`).

## Veredito direto

**Fecha o buraco que motivou a pergunta? Não fecha — desloca.**

A preocupação original é: "`/efrat/carga` devolve nome, matrícula e descritor
facial 128d de todos os colaboradores da unidade, isso é dado biométrico, hoje um
token protege". A proposta troca *como* um aparelho prova que tem direito a chamar
essa rota (token digitado → `dispositivo_id` auto-gerado + aprovação do RH). Ela
**não muda nada sobre o que a rota entrega depois que o aparelho está autorizado**:
`docs/fluxo-operacional.md:65` já documenta que "o aparelho baixa a unidade
inteira: templates + miniatura de referência + nomes", e `docs/api-piloto.md`
confirma que o filtro por `minha:true` é **só client-side** — o servidor manda
tudo. Isso continua igual nos dois modelos.

Ou seja: a proposta resolve um problema real (token digitado é fraco — trafega em
grupo de WhatsApp, é reaproveitado entre aparelhos, nunca gira sozinho) mas troca
por um mecanismo de confiança **mais fraco no momento de estabelecer a confiança**,
sem tocar no problema que motivou a pergunta (raio de exposição de um aparelho
comprometido = 100% dos descritores biométricos da unidade, sempre). Ver
cenário 3 e a recomendação R1 abaixo — é o ponto que fecharia de fato o que foi
perguntado.

## Por que "mais fraco no momento de estabelecer confiança": três cenários concretos

### Cenário 1 — flood da fila de aprovação (fadiga de aprovação, estilo MFA-bombing)

`POST /efrat/dispositivo/registrar` precisa ser **público** por definição — é o
primeiro contato do aparelho, antes de qualquer credencial existir. Nada no plano
limita quantas linhas `efrat_dispositivo` um IP anônimo pode criar.

Ataque: no dia em que a obra está recebendo um totem novo (o RH está de fato
esperando um pedido de aprovação), um atacante na mesma rede Wi-Fi da obra —
credencial de convidado, sinal vazando para a rua — dispara dezenas de
`registrar` com `apelido` plausível ("Totem Portaria", "Tablet RH 2",
"Recepção — substituição"). O RH, sob a mesma pressão que faz MFA-bombing
funcionar contra humanos, aprova a linha errada. `apelido`, `ua` e `geo` são
**todos autodeclarados pelo próprio aparelho que está pedindo aprovação** — nenhum
deles prova nada, são só texto que o atacante escolhe.
**Consequência: o atacante fica com um `dispositivo_id` ativo e ganha exatamente
o que o token de hoje protege — carga completa da unidade.**

### Cenário 2 — código curto sem vínculo de presença física

O plano usa "código curto derivado do `dispositivo_id`" só para o RH **achar** o
aparelho pendente na lista — não para o RH **confirmar** que está aprovando o
aparelho que tem na frente. Não há passo em que o código seja digitado de volta
no aparelho, escaneado, ou comparado por um canal que o atacante não controla.
Compare com o modelo atual: o token é *transmitido fora de banda* (alguém da TI
entrega por um canal separado) — interceptar exige acesso a essa transmissão
específica. O código curto do v3 é *mostrado na tela do próprio aparelho não
confiável* e a aprovação é feita **sem prova de posse**. Na prática, o Cenário 1
e o Cenário 2 são o mesmo furo: a etapa que deveria ser "prova de posse física"
vira "escolher a linha certa numa lista de nomes que o atacante também escreve".

### Cenário 3 — o raio de exposição não muda mesmo com aprovação legítima e sem ataque nenhum

Sem nenhum atacante: um totem aprovado corretamente, na obra errada, esquecido
ligado num canto, ou um funcionário que tira uma foto da tela em modo debug —
qualquer um desses já expõe 128d + miniatura de **toda a unidade**, não só da
equipe daquele aparelho. Isso é verdade **hoje** (com token) e continua verdade
**depois** (com aprovação do RH), porque o campo que muda é o de autenticação do
aparelho, não o de escopo do payload. É o argumento central do veredito acima —
ver R1.

### Cenário 4 (agravado pelo plano, não introduzido por ele) — spoofing de rosto vira escalação de privilégio, não só erro de ponto

`js/face.js` não tem nenhum desafio de vivacidade (confirmado: sem
`blink`/`challenge`/`liveness` no código). Isso já é uma decisão de risco
**documentada e aceita** em `docs/validacao-biometrica.md:135`, mas aceita para
um modelo de ameaça específico: *"a ameaça aqui é buddy punching... liveness
passivo é suficiente e proporcional para esse modelo"* — ou seja, o pior caso
hoje é um colega batendo ponto por outro, que fica retido para revisão (foto de
auditoria) e é corrigido pelo RH sem alterar a marcação original.

O plano v3 usa **o mesmo reconhecimento sem vivacidade** para decidir se quem
está na frente do aparelho é gestor e libera "ver minha equipe" + ajuste de
registro — uma tela de admin. Isso muda o modelo de ameaça de `validacao-biometrica.md`
sem revisitar a decisão de risco: uma foto do gestor no celular de outra pessoa
(a mesma classe de ataque já catalogada como aceitável no §3 daquele documento)
deixa de custar "um ponto errado, corrigível" e passa a custar "acesso a status
da equipe e a um caminho de ajuste de registro". O mesmo vale, em grau menor,
para a "sessão pessoal" do colaborador (banco de horas, histórico) citada como
ponto em aberto no plano: se ela abre só com reconhecimento facial e sem TTL
definido, um FAR (falso aceite) ou uma sessão que não fecha sozinha no aparelho
compartilhado vaza dado pessoal de RH para quem está na fila atrás.

## O que falta para fechar (concreto, não checklist genérica)

- **R1 — Escopar `/efrat/carga` no servidor, não no cliente.** O aparelho
  aprovado deveria receber só os descritores das `equipes_ids` vinculadas a ele
  em `efrat_dispositivo`, e a "busca na unidade" (remanejamento, hoje resolvida
  com o dump completo pré-carregado) devia virar uma chamada explícita,
  sob demanda e auditável — não um preload de 100% da biometria em todo
  aparelho. **Esta é a mudança que de fato reduz o raio de exposição perguntado
  pelo cliente; trocar só a autenticação do aparelho, sem isso, não reduz.**
- **R2 — Prova de posse física no aprovisionamento**, não só "achar na lista":
  o código exibido no aparelho pendente devendo ser digitado *no painel do RH*
  (ou lido por QR pelo navegador do RH) antes do `ativo=true` — transforma
  "escolher a linha certa" em "provar que está de frente para o aparelho".
- **R3 — Rate limit em `/efrat/dispositivo/registrar`** por IP/janela, para que
  flood de pedidos de pareamento não vire ataque de fadiga de aprovação nem
  esgote a Data Table.
- **R4 — Revisitar a decisão de liveness do `validacao-biometrica.md` para o
  caso gestor/admin especificamente**, já que o documento aceitou o risco para
  "buddy punching", não para autenticação de função privilegiada. Não precisa
  ser a mesma solução (AWS Face Liveness etc.) do documento original — precisa
  ser uma decisão explícita, porque hoje é uma decisão implícita herdada de um
  contexto de risco diferente.
- **R5 — TTL definido e visível para a sessão pessoal** (gestor e colaborador)
  no aparelho compartilhado, com retorno automático à tela de ponto — o próprio
  plano já sinaliza isso como pendente para a T-ARQ; este documento reforça que
  é requisito de segurança, não só de UX.
- **R6 — Revogação (`ativo=false`) e cache offline.** Hoje a carga expira só no
  fim do dia (`expira_em`); um aparelho revogado que ficou offline continua
  operando com a carga antiga até o próximo sync bem-sucedido. Isso já é verdade
  hoje com token e não piora com o plano — mas comprometer o aparelho compromete
  esse mesmo intervalo, então vale confirmar que o time aceita esse SLA de
  revogação sem redesenhar (não é bloqueador do v3, é um "já sabíamos").

## Parte 5 — Invariantes: cenário → protege contra → testes e2e afetados

**Nota que muda o dimensionamento da fase de testes:** `docs/plano-v3.md` cita
"19" testes e2e. O arquivo real `tests/e2e/fluxo.spec.js`, na branch atual e em
`main`, tem **23** testes (`grep -c "^test(" tests/e2e/fluxo.spec.js` → 23). O
número no plano está desatualizado — a tabela abaixo usa a contagem real. Isso
também corrige a expectativa: **não são 19 (nem a maioria dos 23) que morrem.**
Da varredura teste a teste, só os que dependem de digitar/validar token morrem
de fato; o resto (identificação, fila, offline, RH, painel) independe de como o
aparelho se autenticou e sobrevive sem alteração.

> **SUPERSEDIDA PELA SEÇÃO "Correção de escopo — a mudança de FLUXO" (mais
> abaixo).** A tabela logo a seguir só mede a troca de **autenticação**. A linha
> "4–14 ... Sobrevivem sem alteração" está incompleta: os 11 testes dessa faixa
> — mais 3 da faixa "15–23" que só usam a fila pra gerar dado de RH — na
> verdade mudam por uma segunda razão, de **fluxo**: o helper `abrirFila` deixa
> de existir porque o colaborador passa a bater o ponto direto, sem o gestor
> abrir fila nenhuma. 14 testes ao todo. Quem for implementar a T-38A7C1 deve
> ler a seção de fluxo antes de agir com base só nesta tabela.

| # | Teste atual (`tests/e2e/fluxo.spec.js`) | Depende do token digitado? | Destino no v3 |
|---|---|---|---|
| 1 | `porta comeca bloqueada ate o aparelho ser pareado` | Sim — checa tela de pareamento por token | **Morre.** Vira "porta bloqueada até o aparelho ter `ativo=true`" |
| 2 | `token invalido nao pareia` | Sim — testa rejeição de token errado | **Morre.** Vira teste de estado `pendente`/rejeitado do `dispositivo_id` |
| 3 | `depois de pareado a porta libera o registro de ponto` | Sim — pareamento é via token | **Modificado.** Mesmo objetivo, gatilho muda para "depois de aprovado pelo RH" |
| 4–14 | identificação de gestor, cooldown, fila, offline, dedupe, envio único em voo, colaborador inativo, registro manual, busca na unidade | Não — dependem só de `token` já presente em `Store`/`ctx`, não de como ele chegou lá | **Sobrevivem** sem alteração, exceto nota abaixo |
| — | `rosto fora da galeria oferece manual e busca na unidade` | Não diretamente, mas **o resultado da busca muda se R1 for adotado** | **Sobrevive, mas o fixture muda**: hoje a carga de teste já vem com a unidade inteira; se `/efrat/carga` passar a ser escopado por equipe (R1), este teste precisa simular a chamada explícita de busca, não mais um array já presente na carga |
| 15–23 | login RH, painel, criar equipe/colaborador, pendência, espelho, cards, gráfico | Não — autenticação de RH é `usuario`+`chave`, nunca tocou o token do aparelho | **Sobrevivem** sem alteração |

### Os 4 testes afetados, nome exato e o que passam a afirmar

Referência para quem for mexer sem quebrar sem saber (fase 2 / T-38A7C1, ainda
travada até o ADR fechar). Assertivas já refletem as correções desta rodada:
código de pareamento gerado no servidor e nunca exposto por leitura do RH
(Novo 2), `/efrat/identificar` com resposta mínima + rate limit (Novo 1).

1. **`porta comeca bloqueada ate o aparelho ser pareado`**
   (`tests/e2e/fluxo.spec.js:83`) — **morre**, sem substituto 1:1 porque não
   existe mais campo de token. Vira teste novo (ver tabela abaixo):
   *"porta continua bloqueada enquanto o dispositivo está pendente/negado"*.

2. **`token invalido nao pareia`** (`tests/e2e/fluxo.spec.js:90`) — **morre**,
   sem substituto 1:1 porque não existe mais "digitar algo e errar". O
   equivalente de risco (aparelho tenta se passar por aprovado sem o RH ter
   confirmado) já está coberto pelo teste novo do item 1.

3. **`depois de pareado a porta libera o registro de ponto`**
   (`tests/e2e/fluxo.spec.js:96`) — **modificado**, mesmo nome de intenção,
   gatilho muda. Passa a afirmar: *dispositivo novo gera `dispositivo_id` e
   registra → tela mostra o código gerado pelo servidor → RH digita, no
   painel, o código que leu na tela do aparelho (não um valor que o painel já
   sabia) → `ativo` vira `true` → próxima `/efrat/carga` desse
   `dispositivo_id` libera `btnPonto`* — e o corpo da resposta passa a trazer
   só as equipes vinculadas ao dispositivo, não a unidade inteira (R1).

4. **`rosto fora da galeria oferece manual e busca na unidade`**
   (`tests/e2e/fluxo.spec.js:175`) — **não morre, fixture muda**. Hoje a
   "unidade inteira" já vem dentro da carga estática do teste. Passa a
   afirmar: *rosto fora da galeria local → app chama `POST /efrat/identificar`
   com o descritor → servidor-falso responde só `{nome, matricula, equipe_id}`
   (nunca vetor/miniatura, conforme requisito travado no contrato) → oferece
   "marcar remanejado"; sem rede ou sem match, cai em manual com foto, como já
   fazia*. **Correção:** este teste também usa `abrirFila` — está duplamente
   afetado (autenticação **e** fluxo). Ver seção seguinte.

**Testes novos que a fase 2 precisa cobrir (não substituem 1:1 — são invariantes
novos que não existiam porque o mecanismo não existia):**

| Cenário novo | Protege contra | Testes a criar |
|---|---|---|
| Aparelho não aprovado nunca recebe payload de `/efrat/carga` | Cenário 1/3 — vazamento de biometria para aparelho não confiável | `/efrat/carga` para `dispositivo_id` com `ativo=false` retorna só `{ok:false, estado:'pendente'}`, nunca `pessoas` |
| Fila de aprovação não afoga com registros falsos | Cenário 1 — fadiga de aprovação | N registros em curto intervalo do mesmo IP/UA são limitados ou marcados como suspeitos antes de aparecer pro RH |
| Aprovação exige confirmação bidirecional (R2) | Cenário 2 — aprovar a linha errada | RH só consegue `ativo=true` informando o código exibido no aparelho (não só clicando na lista) |
| Escopo por equipe no `/efrat/carga` (R1) | Cenário 3 — raio de exposição de aparelho comprometido | aparelho vinculado à equipe A não recebe descritores da equipe B; busca na unidade vira chamada auditada separada |
| Sessão do gestor/colaborador expira e volta sozinha (R5) | Cenário 4 — vazamento de dado pessoal no aparelho compartilhado | após TTL ou detecção de rosto diferente, a tela volta para "porta"/ponto sem exigir ação |
| Revogação (`ativo=false`) some da lista de aprovados imediatamente | Continuidade do controle que o RH já tem hoje (rotacionar token) | RH revoga um aparelho aprovado → próxima tentativa de `/efrat/carga` desse `dispositivo_id` volta a `pendente`/`negado` |

## Correção de escopo — a mudança de FLUXO, não só de autenticação

O Orquestrador apontou um furo real na análise acima: a tabela de 4 testes só
mediu a troca de **autenticação** do aparelho. Existe uma segunda mudança,
independente da primeira e que também está no plano — item 1+2 do objetivo do
cliente: o colaborador passa a bater o ponto direto, e a fila do gestor deixa
de ser o caminho de marcação de terceiros para virar painel de status. Isso
tem raio próprio nos testes.

`grep -c "abrirFila(page)" tests/e2e/fluxo.spec.js` → 16 (1 definição do
helper, `fluxo.spec.js:36-40`, + 15 chamadas). O helper espera três coisas que
só existem no modelo "gestor abre a fila para processar os outros":
`#fila:not(.hide)`, `Fila.gestor !== null` e `Fila.estado === 'armado'`. Nenhuma
das três sobrevive ao colaborador se auto-atender. **14 testes distintos**
dependem do helper (um deles, `reabrir a fila...`, chama duas vezes).

| Teste (linha) | Autenticação | Fluxo | Regra testada sobrevive? | O que muda de fato |
|---|---|---|---|---|
| `registrar ponto identifica o gestor e ja marca o ponto dele` (106) | não | **sim** | sim — reconhecimento marca o próprio ponto do gestor | Helper morre. `expect('#filaGestor')` também morre — não é só o helper, é a asserção, porque hoje ela verifica que a *fila* abriu; no fluxo novo o gestor é reconhecido pelo botão único e ganha um link "ver minha equipe" à parte. Seletor novo depende do contrato do ADR. |
| `ponto do gestor sempre carrega foto e vai para revisao` (122) | não | **sim** | sim — `gestorDeveMarcar` em `js/regras.js`, intocada | Só o helper. Asserção (`foto_auditoria` presente, vai pra revisão) não olha pra `Fila`, sobrevive igual. |
| `reabrir a fila no mesmo minuto nao marca o gestor de novo` (131) | não | **sim** | sim — cooldown/dedupe, regra pura | Helper (2x). `#btnSairFila` no corpo do teste pode não ter equivalente — se o retorno à porta for automático no fluxo novo, essa linha some, não só muda de seletor. |
| `a fila marca entrada e depois saida do colaborador` (146) | não | **sim** | sim — `tipoDaVez` em `js/regras.js` | Helper morre (não há gestor pra "abrir" nada). O ciclo identificar→propor→confirmar (helper `marcar()`) **não** depende de `Fila.gestor`/`estado`, então esse helper específico deve sobreviver quase igual — é o forte candidato a única peça reaproveitável 1:1. |
| `cooldown bloqueia a mesma pessoa em sequencia` (167) | não | **sim** | sim | Mesmo padrão do anterior. |
| `rosto fora da galeria oferece manual e busca na unidade` (175) | **sim (R1)** | **sim** | parcial — fallback manual sobrevive, "buscar na unidade" via array pré-carregado morre | Duplo impacto — o mais delicado da lista. Helper de entrada muda (fluxo) *e* o corpo do teste muda (chamada a `/efrat/identificar` em vez de achar num array já carregado). |
| `registro manual exige motivo e grava como manual` (187) | não | **sim** | sim — motivo obrigatório é regra pura | Helper de entrada muda; `#btnManual`/`#listaPessoas` provavelmente sobrevivem porque são do fallback de reconhecimento, não da fila em si. |
| `offline enfileira e sobe quando a rede volta` (211) | não | **sim** (helper só de contexto) | sim — fila offline em `store.js`/`api.js` | Só o helper, pra chegar no estado "pronto pra marcar". |
| `reenvio do mesmo id_cliente nao duplica` (225) | não | **sim** (idem) | sim — dedupe no servidor | Idem. |
| `envio unico em voo: nunca ha dois lotes simultaneos` (241) | não | **sim** (idem) | sim — cadeado de sincronização | Idem; marca duas pessoas em sequência, reforça que o ciclo identificar/confirmar (não o gate do gestor) é a peça que sobrevive. |
| `colaborador inativo e rejeitado e a marcacao fica retida` (259) | não | **sim** (idem) | sim — rejeição no servidor | Idem. |
| `RH ve a pendencia do gestor e decide` (317) | não | **sim** (helper só gera dado) | sim, mas o teste não testa a fila | **Ver recomendação abaixo — trocar por seed.** |
| `espelho de ponto mostra as marcacoes do colaborador` (334) | não | **sim** (idem) | sim, idem | **Idem.** |
| `ver dados abre a tabela com os mesmos numeros do grafico` (367) | não | **sim** (idem) | sim, idem | **Idem.** |

**Não afetados por nenhuma das duas dimensões (6):** `RH nao entra com senha
errada` (279), `RH entra e ve o painel com indicadores` (289), `RH cria equipe
e colaborador` (296), `painel mostra card critico...` (347), `card traz o
numero junto da cor...` (354), `trocar o periodo recarrega...` (382). Nenhum
usa `abrirFila` nem `parear`.

### Respondendo direto às quatro perguntas

1. **Duas colunas, um teste pode estar nas duas:** tabela acima. Só
   `rosto fora da galeria...` (175) está nas duas.

2. **Dos 14 que passam pelo helper: morrem, ou só o helper muda?** Sua leitura
   está certa na essência: a **regra** (o que está em `js/regras.js`: cooldown,
   dedupe por `id_cliente`, rejeição de inativo, lote único em voo, motivo
   obrigatório) não muda em nenhum dos 14 — ninguém vai tocar em
   `js/regras.js` nesta rodada, então o comportamento de negócio sob teste é
   estável. Mas não é *só* trocar um helper e pronto: em pelo menos 2 dos 14
   (`registrar ponto identifica o gestor...`, 106, e o já duplamente afetado
   175) há **asserção no corpo do teste** que olha direto pra estrutura da
   fila antiga (`#filaGestor`, array pré-carregado) e precisa mudar junto, não
   só a função auxiliar que leva até lá. E `#btnSairFila` (usado em 4 testes:
   131, 317, 334, 367) pode simplesmente não ter equivalente se o retorno à
   porta virar automático. **Custo real: 1 helper novo (substituto de
   `abrirFila`, provavelmente reaproveitando o ciclo `marcar()` quase intacto)
   + ajuste pontual em ~5-6 testes, não reescrita de 14.** Isso é a notícia
   boa que você queria confirmada — só com essa ressalva sobre os pontuais.

3. **Os 3 do RH (317, 334, 367) — seed direto no servidor-falso?** **Sim.**
   Motivo: nos três, a fila não é o SUT — é só o jeito hoje disponível de
   colocar uma marcação no sistema antes de testar o painel do RH. Dirigir a
   UI de marcação pra gerar dado de teste acopla três testes de RH a detalhes
   de implementação de uma tela que vai mudar de forma nesta mesma rodada,
   por um motivo que não tem nada a ver com o que eles verificam. O projeto já
   usa esse princípio: `logarRh()` (`fluxo.spec.js:60-75`) já troca a derivação
   PBKDF2 real por uma chave fixa pra não depender de criptografia no teste de
   painel. Seed direto no `servidor-falso.js` é a mesma ideia aplicada à fila.

4. **Nomes exatos dos que morrem de fato:** confirmo a sua conta, sem
   correção — `porta comeca bloqueada ate o aparelho ser pareado` (83) e
   `token invalido nao pareia` (90) morrem sem substituto 1:1;
   `depois de pareado a porta libera o registro de ponto` (96) muda o gatilho
   para aprovação do RH; `rosto fora da galeria oferece manual e busca na
   unidade` (175) é afetado pelo R1 — e, como notado acima, também pelo fluxo,
   o que não muda sua contagem de "4 que morrem/mudam por autenticação", só
   soma uma segunda razão pro mesmo teste.

## Para quem for implementar (T-ARQ / fase 2)

- R1 é a recomendação que eu marcaria como **bloqueante** antes de tirar o
  token — é a única mudança que reduz de fato o que o cliente perguntou. As
  outras (R2–R6) endurecem o mecanismo novo, mas sem R1 o "fechar" nunca
  acontece, só muda de forma.
- Não decidi *como* implementar R1–R6 (webhook novo, campo novo em
  `efrat_dispositivo`, etc.) — isso é escopo da T-ARQ (T-66191D), que já está
  rodando em paralelo. Este documento entrega o que deve entrar nos requisitos
  dela e nos critérios de aceite da fase 2 de testes.

## Revisão pós-decisão (commit `44b96f6` do plano) — o que é novo

R1 foi promovido a bloqueante e os achados 1–3 têm decisão de fechamento no
plano. Revisão específica: as decisões novas em si introduzem alguma ameaça
que a versão anterior deste documento não cobria? Três pontos, nenhum deles
reabre o veredito (a direção continua correta) — são ajustes de desenho antes
da T-ARQ travar a implementação.

### Novo 1 — `POST /efrat/identificar` recria a exposição de R1, só que como oráculo em vez de dump

R1 fecha o download em massa: cada aparelho passa a receber só a própria
equipe. Mas o substituto do "buscar na unidade" — `POST /efrat/identificar
{ dispositivo_id, descritor }`, 1:N **no servidor, contra a unidade inteira**
— reabre o mesmo raio de exposição em formato de consulta, não de cópia. A
diferença importa: um dump é um evento único e finito (rouba uma vez, tem uma
foto do banco daquele dia); um oráculo de identificação é repetível e
interativo. Um aparelho aprovado para a equipe A pode, tecnicamente, submeter
qualquer descritor — inclusive um calculado offline a partir de uma foto de
fora da empresa, já que o modelo do `face-api.js` é público e roda local — e
perguntar "essa pessoa está no quadro desta unidade". Isso é uma capacidade
que não existia antes de forma alguma: um serviço de verificação de
identidade contra a base biométrica inteira da unidade, reduzindo a proteção
de R1 a "não dá pra baixar tudo de uma vez", sem impedir "dá pra confirmar
qualquer pessoa, quantas vezes quiser". O plano só menciona rate limit para
`/efrat/dispositivo/registrar`; falta o mesmo (ou mais rígido, por ser
consulta biométrica) para `/efrat/identificar`: limite por `dispositivo_id`/
dia, alerta de volume anômalo, e — ponto que precisa virar requisito
explícito da T-ARQ — **a resposta nunca deve devolver o vetor 128d ou a
miniatura armazenada**, só identidade mínima (nome/matrícula/equipe) para o
fluxo de remanejamento; devolver o descritor faria do oráculo também um canal
de exfiltração vetor-a-vetor, pior que o dump que R1 acabou de fechar.

### Novo 2 — o código de pareamento não pode aparecer na própria lista de pendentes do RH

"RH digita no painel o código exibido na tela do aparelho" só prova posse
física se o código **não estiver visível em nenhum outro lugar que o RH já
enxergue logado** — inclusive a própria lista de "Aparelhos pendentes". Se a
lista de pendências mostrar o código ao lado do `apelido`/`ua`/`geo`
autodeclarados (útil para o RH achar a linha, como o desenho original
previa), digitar o código vira copiar de um campo da tela para outro, sem
nunca olhar para o aparelho físico — e o achado 2 (Cenário 2, fadiga de
aprovação com apelido plausível) volta a valer exatamente como antes. Requisito
a registrar na T-ARQ: o código só existe na tela do aparelho pendente; a lista
do RH mostra o pendente sem o código, e o campo de confirmação é digitação
livre, não um dropdown/autocomplete que dá a resposta.

### Novo 3 (menor) — fila de `efrat_correcao` como novo alvo de flood via spoofing

Achado 3 reduz o pior caso de um spoof do gestor a "ver o dia da equipe e
propor ajuste que o RH confere" — correto, e bem menor que acesso admin. Mas
"propor ajuste" grava em `efrat_correcao`, a mesma fila que o RH já usa para
decisão de marcação/recadastro. Um spoof repetido (foto do gestor, sem
liveness, tentado várias vezes) pode inflar essa fila com propostas de ajuste
falsas — não é escalação de privilégio, é ruído operacional que aumenta o
custo de revisão do RH exatamente na fila que devia ficar mais confiável
depois da mudança. Vale um limite de propostas pendentes por gestor/dia, mas
isto é ajuste fino, não bloqueante — sinalizando para não virar prioridade
acima de Novo 1 e Novo 2.

**Critério de UI registrado (decisão do Orquestrador):** a fila de correções
do painel do RH precisa mostrar quantas propostas vieram do mesmo gestor no
mesmo dia — sem essa contagem visível, o RH não percebe inflação da fila
mesmo que cada proposta individual pareça legítima.

## Dívida conhecida, fora desta rodada — chave PBKDF2 do RH como credencial permanente

Registro a pedido do Orquestrador, para custo estimado ir ao cliente. Nota de
proveniência: esse achado específico ("achado 4") não estava na primeira
versão deste documento — confirmei em `js/rh.js` a pedido, e é real, mas
não fui eu quem levantou originalmente; pode ter vindo da leitura em paralelo
da T-ARQ. Registro aqui porque foi validado no código.

**O problema:** `js/rh.js:21-28` — `chave` (derivada de PBKDF2-SHA256, sal e
iterações vindos do servidor) é enviada em **toda** chamada `/efrat/rh/*` como
prova de identidade, e fica em memória no módulo `Rh` até `btnSairRh` limpar
(`this.cred = null`). Não existe camada de sessão entre "chave derivada" e
"autenticado": a chave **é** a credencial de longo prazo, equivalente à senha
em si — não expira, não gira sozinha, e não há como revogar uma chave
comprometida sem trocar a senha de todo o usuário RH. Se a chave vazar
(devtools, extensão maliciosa, aparelho da RH comprometido, aba esquecida
aberta em máquina compartilhada), o atacante tem acesso de admin indefinido,
indistinguível do RH real, até alguém perceber e trocar a senha.

**Custo estimado para fechar** (ordem de grandeza, não inclui taxa/hora do
cliente): introduzir uma camada de sessão de curta duração entre login e as
rotas de RH — `/efrat/rh/entrar` verifica a chave no servidor uma vez e emite
um token opaco de vida curta (nova Data Table ou campo de expiração), as
rotas de leitura/escrita do RH passam a exigir o token em vez da chave, e um
`/efrat/rh/sair` revoga o token. Reaproveita o padrão de Data Table + webhook
já usado no resto do projeto, então é um trabalho conhecido, não exploratório:

- Backend n8n: ~1 dia (tabela de sessão, endpoint de emissão/revogação,
  ajuste das duas rotas de RH existentes para checar token).
- Frontend (`js/rh.js`, `js/api.js`): ~1 dia (trocar `cred` por token,
  tratar expiração/relogin, logout explícito revogando no servidor).
- Testes novos (unit + e2e de sessão expirada/revogada): ~0,5–1 dia.

**Total: ~2,5–3 dias de desenvolvimento**, risco técnico baixo. Cartão próprio,
como já decidido — não bloqueia a T-ARQ nem a fase 2 dos testes desta rodada.

## Critérios de aceite para o helper novo (substituto de `abrirFila`)

Aprovados pelo Orquestrador, registrados aqui pra não se perder até a
T-607E5A/T-8FB792 do Full-Stack destravarem a escrita.

**1. Não acoplar a estado interno de módulo JS — esperar sinal visível na
tela.** O `abrirFila` atual espera `window.__EFRAT.Fila.gestor !== null` e
`Fila.estado === 'armado'` — isso acoplou 14 testes a uma implementação
específica de fluxo, e é exatamente por isso que ela quebra inteira na
próxima mudança de fluxo. O helper novo espera por seletor de DOM que
aparece / texto renderizado, nunca por propriedade de objeto JS interno —
mais devagar de escrever agora, mais barato na próxima vez que o fluxo mudar.

**2. O fluxo novo continua passando offline.** Aparelho pendente e o polling
de `/efrat/dispositivo/estado` não podem travar a tela quando não há rede —
é o cenário real de campo (obra sem sinal, aparelho novo, ninguém sabe por
que a tela não sai do lugar), não um caso de borda hipotético. `tests/e2e/
offline.spec.js` (DevOps) já prova que o PWA carrega offline hoje; o helper
novo e a tela que ele dirige não podem regredir isso quando o dispositivo
está no meio do fluxo de aprovação.

**Por que vale a pena escrever os dois por escrito:** a medição real dos 3
testes de RH desacoplados da fila (T-38A7C1) caiu de ~4-8s para menos de 1s
cada — não é só teste mais rápido, é prova empírica de que a fila nunca foi
o objeto daqueles testes, só cenografia cara de montar. O mesmo raciocínio
sustenta o critério 1: acoplar teste a estrutura interna de tela sempre foi
o caminho caro, mesmo quando parece mais direto de escrever.
