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

| # | Teste atual (`tests/e2e/fluxo.spec.js`) | Depende do token digitado? | Destino no v3 |
|---|---|---|---|
| 1 | `porta comeca bloqueada ate o aparelho ser pareado` | Sim — checa tela de pareamento por token | **Morre.** Vira "porta bloqueada até o aparelho ter `ativo=true`" |
| 2 | `token invalido nao pareia` | Sim — testa rejeição de token errado | **Morre.** Vira teste de estado `pendente`/rejeitado do `dispositivo_id` |
| 3 | `depois de pareado a porta libera o registro de ponto` | Sim — pareamento é via token | **Modificado.** Mesmo objetivo, gatilho muda para "depois de aprovado pelo RH" |
| 4–14 | identificação de gestor, cooldown, fila, offline, dedupe, envio único em voo, colaborador inativo, registro manual, busca na unidade | Não — dependem só de `token` já presente em `Store`/`ctx`, não de como ele chegou lá | **Sobrevivem** sem alteração, exceto nota abaixo |
| — | `rosto fora da galeria oferece manual e busca na unidade` | Não diretamente, mas **o resultado da busca muda se R1 for adotado** | **Sobrevive, mas o fixture muda**: hoje a carga de teste já vem com a unidade inteira; se `/efrat/carga` passar a ser escopado por equipe (R1), este teste precisa simular a chamada explícita de busca, não mais um array já presente na carga |
| 15–23 | login RH, painel, criar equipe/colaborador, pendência, espelho, cards, gráfico | Não — autenticação de RH é `usuario`+`chave`, nunca tocou o token do aparelho | **Sobrevivem** sem alteração |

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

## Para quem for implementar (T-ARQ / fase 2)

- R1 é a recomendação que eu marcaria como **bloqueante** antes de tirar o
  token — é a única mudança que reduz de fato o que o cliente perguntou. As
  outras (R2–R6) endurecem o mecanismo novo, mas sem R1 o "fechar" nunca
  acontece, só muda de forma.
- Não decidi *como* implementar R1–R6 (webhook novo, campo novo em
  `efrat_dispositivo`, etc.) — isso é escopo da T-ARQ (T-66191D), que já está
  rodando em paralelo. Este documento entrega o que deve entrar nos requisitos
  dela e nos critérios de aceite da fase 2 de testes.
