# FASE 3 · Contrato de dados e rotas

- **Status:** aceito em review (T-65D806), com quatro decisões do Orquestrador
  incorporadas — mecanismo da origem pública (§4.6), exceção de telefone
  duplicado (§3.1), escopo da tela de equipes (§2.1) e fronteira exata de `0,45`
  no cadastro (§4.2)
- **Data:** 2026-08-21
- **Fonte da fase:** [`fase3-rh-pessoas.md`](fase3-rh-pessoas.md) — diagnóstico e as 6 decisões já tomadas
- **Contrato normativo do v3:** [`adr-acesso-v3.md`](adr-acesso-v3.md) — este documento **estende**, não substitui
- **Consome:** [`ameacas-v3.md`](ameacas-v3.md) (Cenários 1–4, Novo 2),
  [`fase3-seguranca.md`](fase3-seguranca.md) (T-AED04B — três achados que mudaram
  este contrato, §1.6, §4.2 e §4.6), [`validacao-biometrica.md`](validacao-biometrica.md)
  (§1.1, §6), [`privacidade-tela-compartilhada.md`](privacidade-tela-compartilhada.md)

## O que este documento é

A definição de rotas, corpos, estados e invariantes que as quatro tarefas
paralelas da Fase 3 compartilham:

| Tarefa | Quem | O que tira daqui |
|---|---|---|
| T-87615C | Full-Stack | §1 inteiro — aba de aparelhos e liberação |
| T-8188C6 | Full-Stack | §2 e §3 — equipes com membros (a **tela** de membros continua obrigatória, §2.1), colaborador com telefone e edição |
| T-D30529 | Full-Stack | §4 — três caminhos de cadastro de face, **incluindo `/efrat/rh/face/cadastrar` (§4.3), que sobe de prioridade: vai junto, não depois** |
| T-AABCC9 | DevOps | §4.6 — **origem própria** da página pública: host, CSP, cache, CORS e guarda de CI |
| T-AED04B | Revisor QA | §4.4, §4.6 e §7 — máquina de estados e superfície de ataque do link |

Não é plano de implementação e não desenha tela. Onde havia ambiguidade,
**decidi e registrei o porquê no próprio parágrafo** — está marcado como
`Por quê:`. Onde a decisão contraria código que já existe, está marcado como
`⚠ Muda o que existe hoje` com o arquivo e a linha.

## Restrição de arquitetura que governa tudo abaixo

O app é estático, sem build e sem variável de ambiente. Consequências que
nenhuma peça deste contrato pode violar:

1. **Nada de segredo no bundle.** Todo arquivo servido é público. `js/config.js`
   é configuração de runtime, não cofre.
2. **Nenhum passo de build.** Página nova é arquivo `.html` novo + módulo ES novo.
   Sem bundler, sem transpilação, sem `process.env`.
3. **A página pública de face vive em origem própria.** Subdomínio, não caminho.
   Não é preferência de organização: `IndexedDB` isola por **origem**, o service
   worker registra por **origem**, e é na origem do app que mora a credencial de
   256 bits do aparelho. Detalhe e consequências em §4.6.
4. **Toda inferência biométrica é do lado do cliente.** O n8n não tem modelo e não
   vai ter nesta rodada. O que o servidor pode conferir sem modelo, ele confere
   (§4.2) — e isso é mais do que ele confere hoje.

---

## Princípio que apareceu quatro vezes nesta fase

**Antes de confiar num sinal, perguntar de onde vem o dado que o alimenta — e se ele
pode ser constante.**

Nomeado porque a fase inteira o reencontrou em lugares sem relação nenhuma entre si:

| Onde | O sinal | Como ele mentiria |
|---|---|---|
| §4.7 | `modelo_id` | manifesto gerado da árvore do repositório declara id certo sobre bytes errados: nunca marca divergência e passa a atestar sanidade |
| §4.2 | `coerencia_no_limite` (**caiu**) | corte mal escolhido acenderia em todo cadastro e treinaria o RH a ignorar. A medição mostrou que *qualquer* corte na faixa faria isso — o sinal foi removido, não recalibrado |
| §1.2 | `pedidos_da_mesma_rede_1h` | proxy que não repassa o IP real torna o `ip_hash` constante: "mesma rede" para o mundo inteiro, aceso sempre |
| T-E3DBD4 | o `#porta` que nascia visível | tela que aparece por padrão não é evidência de estado nenhum |

Detector que mente é pior que detector ausente, porque desliga a suspeita de quem
olharia. **E medição que ninguém usa é pior que não medir, porque vira falso conforto** —
formulação do Biometria, e é o mesmo padrão um passo adiante: `efrat_template.coerencia`
acumulando sem ninguém olhar (dívida 9) não é neutro, é um "nós medimos isso" que ninguém
pode sacar. A família toda é uma só: coisa que parece evidência e não é. Todo campo deste contrato que existe para alguém *notar algo* carrega, junto,
a resposta a "o que faria isto virar constante?".

## Convenção de nomes: a força de uma afirmação vai no nome dela

Varredura de nomes pedida pelo Orquestrador, irmã da tabela de procedência de §4.2 — lá o
risco era número construído lido como medido; aqui é **afirmação fraca lida como forte**.

O achado não foi o que eu previ. Eu esperava encontrar nomes ambíguos (`verificado`,
`confirmado`); o documento **não tem** esses campos. O que ele tem é uma convenção que eu
mesmo criei e apliquei **pela metade**: `apelido_declarado`, `geo_declarada` e
`origem_observada` carregam a força no nome, e campos da mesma natureza não carregam.
Convenção aplicada pela metade é pior que convenção ausente, porque a presença do sufixo
em alguns campos faz a ausência nos outros parecer significado.

| Sufixo | Força | O que é |
|---|---|---|
| `_declarado` | **nenhuma** | o cliente afirmou, ninguém checou |
| `_observado` | fato do servidor | o servidor viu acontecer |
| `_calculado` | aritmética sobre entrada não verificada | o servidor computou; os insumos vieram do cliente |
| `_provado` | posse verificada | confere contra hash/credencial |
| `_autorizado_por`, `_decidido_por` | responsabilidade humana | alguém assumiu; nenhuma checagem técnica |

**Onde o sufixo é obrigatório:** quando o mesmo campo poderia plausivelmente ser de outra
força. `pedidos_da_mesma_rede_1h` não precisa — contagem só pode ser observada. `modelo_id`
**precisa**, porque poderia ser verificado e não é. Essa é a regra que impede a convenção de
inflar todo nome do sistema.

Os dois casos que a varredura encontrou:

- **`modelo_id` é declarado pelo cliente** (§4.7) e não diz isso no nome, enquanto
  `apelido_declarado`, que é da mesma natureza, diz. Nome honesto:
  **`modelo_id_declarado`**. Feio e honesto vale mais que elegante e ambíguo.
- **A "conferência" do RH na fila de recadastro** (`53136b3`) é um clique de humano, e a
  palavra sugere verificação. Na prosa e na tela: **declaração de que conferiu**, não
  conferência. O que o sistema sabe é que alguém marcou uma caixa; o que aconteceu antes de
  marcar, ele não sabe.

E por que isso não é preciosismo: a compensação que este contrato oferece pela **ausência de
liveness** nos caminhos `link` e `rh_upload` é exatamente a conferência humana (§4.3). Se
"conferência" e "verificado" forem lidos com a mesma confiança, perde-se a distinção que
sustenta essa compensação — e ela é a única que sustenta dois dos três caminhos de cadastro.

**Quando aplicar, e é a parte que importa mais que a proposta.** `modelo_id` está sendo
implementado agora (T-8ADD9C). Renomear campo em voo custa mais do que compra, e um contrato
que muda nome de campo no meio da implementação vira o defeito que ele estava tentando
evitar. Recomendação: o sufixo vale **para nome que ainda não está em código**; para
`modelo_id`, a força fica registrada na descrição do campo e a renomeação espera uma passada
única e coordenada, **depois** de os três caminhos de cadastro estarem entregues. O cliente
está esperando funcionalidade, não vocabulário.

---

## 0. Convenções

Herdadas do ADR v3 sem alteração: base `/webhook`; JSON UTF-8; datas ISO 8601
UTC; IDs opacos; toda resposta com `ok` e `request_id`; erro no formato
`{ ok:false, erro:{ codigo, mensagem, campo? }, request_id }`; `400` corpo
inválido, `401` credencial, `403` fora do escopo, `404` invisível/inexistente,
`409` conflito, `422` regra de negócio, `429` limite, `503` dependência.

Duas convenções novas, que valem para tudo que este documento cria:

**C1 · Onde vai a chave de idempotência.** Header `Idempotency-Key` nas rotas
cuja credencial é header (aparelho, gestor, convite de face). Campo de corpo
`idempotency_key` nas rotas `/efrat/rh/*`, cuja credencial já é corpo
(`usuario` + `chave`).
`Por quê:` `postRh()` em `js/api.js:31` monta corpo e não monta header; exigir
header nas rotas de RH obrigaria a mexer nesse helper e a acertar preflight de
CORS em toda rota antiga, por nenhum ganho. A regra fica memorizável: *a chave
viaja pelo mesmo canal que a credencial daquela rota*.

**C2 · Obrigatoriedade.** Nas rotas **novas** de escrita a chave é obrigatória
(`400 IDEMPOTENCIA_AUSENTE`). Nas rotas **existentes** (`/rh/equipe`,
`/rh/colaborador`, `/rh/decidir`) ela é aceita e honrada quando vem, e não
obrigatória.
`Por quê:` exigir agora quebraria o cliente atual e os e2e verdes sem resolver
nada que `versao_cadastro` (§3.2) já resolve para o caso perigoso, que é
atualização perdida.

**C3 · Chave repetida.** Mesma chave + mesmo corpo → repete a resposta gravada.
Mesma chave + corpo diferente → `409 IDEMPOTENCIA_CONFLITANTE`. Igual ao que
`/efrat/gestor/ajustar` já faz.

---

## 1. A · Aparelhos

É o item que destrava a fase: hoje o aparelho pede liberação e não existe rota
nem tela para liberar, então o app nasce trancado.

### 1.1 O pareamento: como o código curto casa com o `dispositivo_id`

O código curto **não é segredo contra a internet** — é prova de posse física.
Ele tem 6 caracteres de um alfabeto de 31 (`ABCDEFGHJKMNPQRSTUVWXYZ23456789`,
sem `0 O 1 I L`), sorteados por CSPRNG, ~29,7 bits. Não é derivado do
`dispositivo_id` e não pode ser.

O que faz dele prova de posse são quatro regras, nenhuma opcional:

1. **Existe em dois lugares só:** na tela do aparelho pendente e na linha do
   servidor. **Nenhuma rota de leitura do RH devolve `codigo_curto`** — nem
   junto do `apelido`, nem mascarado, nem como prefixo.
   `Por quê:` `ameacas-v3.md` § Novo 2 — se o código aparecer na lista que o RH
   já vê logado, digitar o código vira copiar de um campo da tela para outro e o
   Cenário 2 (fadiga de aprovação com apelido plausível) volta a valer inteiro.
2. **Só o código ativa.** `aprovar` aceita `codigo` e mais nada como alvo. Não
   existe caminho que ative um aparelho a partir de `pendente_id` ou
   `dispositivo_id`. A resolução é unidirecional: `codigo → única linha pendente
   → dispositivo_id`.
3. **Campo de digitação livre.** Sem dropdown, sem autocomplete, sem sugestão a
   partir da lista. Registrado como critério de UI em §7.
4. **Expira e roda.** A janela do código é de **24 h**. Passada a janela, a
   próxima consulta de `/efrat/dispositivo/estado` daquele aparelho devolve
   `estado: "pendente"` com **código novo** e janela nova, incrementando
   `tentativas`.
   `Por quê:` foto da tela feita ontem não aprova nada hoje, e não precisei
   inventar estado novo nem mexer no cliente: `dispositivo_id` e credencial
   continuam os mesmos (a fila local não é órfã) e só o código gira. Colisão de
   código na rotação (`CODIGO_COLISAO`) mantém o código antigo e tenta na
   consulta seguinte.

A volta do laço fecha na tela do aparelho: ao aprovar, o RH escolhe o local, e
`/efrat/dispositivo/estado` passa a devolver o **nome do local** (§1.7). Quem
está de pé na frente do aparelho lê "Liberado para Obra Norte" na tela física —
é a confirmação de que aprovou o aparelho que tem na mão, não uma linha
parecida.

### 1.2 `POST /efrat/rh/aparelhos` — leitura

Autenticação de RH (`usuario` + `chave`). Corpo: `{ usuario, chave }`.

```json
{
  "ok": true,
  "pendentes": [
    {
      "pendente_id": "pend-7c1f…",
      "apelido_declarado": "Tablet obra norte",
      "ua_resumida": "Chrome 141 · Android 14",
      "geo_declarada": { "lat": -20.46, "lng": -54.62, "precisao_m": 24 },
      "primeiro_pedido_em": "2026-08-21T11:02:00Z",
      "ultimo_pedido_em": "2026-08-21T11:40:00Z",
      "tentativas": 2,
      "pedidos_da_mesma_rede_1h": 12
    }
  ],
  "ativos": [
    {
      "dispositivo_id": "uuid-v4",
      "apelido": "Tablet obra norte",
      "unidade": "Obra Norte",
      "equipes_ids": ["eq-01"],
      "configuracao_versao": 7,
      "ultimo_uso_em": "2026-08-21T10:58:00Z",
      "aprovado_por": "rh",
      "aprovado_em": "2026-08-20T13:00:00Z"
    }
  ],
  "encerrados": [
    { "dispositivo_id": "uuid-v4", "apelido": "Tablet velho",
      "estado": "revogado", "em": "2026-08-19T18:00:00Z", "por": "rh" }
  ],
  "request_id": "…"
}
```

Decisões dentro dessa resposta:

- **`pendente_id`, não `dispositivo_id`, nos pendentes.** Handle opaco próprio da
  linha pendente, usado só para recusar.
  `Por quê:` defesa em profundidade sobre a regra 2 de §1.1 — a lista não
  carrega nenhum identificador que outra rota aceite como alvo de ativação.
- **`apelido_declarado`, `ua_resumida`, `geo_declarada` com esse nome.** O sufixo
  é conteúdo, não estilo: `ameacas-v3.md` Cenário 1 mostra que os três são texto
  que o próprio aparelho que pede aprovação escolheu. O rótulo na tela tem de
  dizer "informado pelo aparelho".
- **`pedidos_da_mesma_rede_1h` é fato observado pelo servidor**, não declarado —
  contagem de pedidos pendentes na última hora com o mesmo `ip_hash`. Guardamos hash
  com sal de deploy, nunca o IP.
  **O campo fica no dado e no log; na tela aparece uma frase, não o número.** Eu havia
  posto o contador direto na tela, e é jargão por número: um RH leigo não liga "mesma
  rede" a "possível ataque" e não sabe o que fazer com `12`. A tela mostra, **só quando
  é anômalo**, uma frase com a ação embutida.

  **Resposta do cliente (21/08/2026): não há proxy — o n8n responde direto.** Logo o
  n8n vê o endereço real do cliente, o `ip_hash` não é constante, e o sinal **fica com a
  palavra "mesma rede"**, que é a versão mais específica: "Vários aparelhos pediram
  liberação **pela mesma internet** na última hora — se você só está esperando um,
  recuse os outros."

  **Mas a validade desse sinal passa a depender da topologia, e isso é armadilha para o
  futuro.** No dia em que alguém puser um proxy na frente do n8n, o `ip_hash` vira
  constante — o do proxy — e o aviso passa a acender **sempre**: "mesma rede" para o
  mundo inteiro. É exatamente o modo de falha do manifesto sobre a árvore do repositório
  (§4.7), e por isso fica escrito com o gatilho ligado à topologia e não ao acaso:

  > **Se um proxy for introduzido na frente do n8n, este campo tem de ser reavaliado
  > ANTES de o proxy entrar.** Se o IP real não chegar ao n8n, o campo degrada para
  > `pedidos_pendentes_1h` — contagem de pedidos pendentes recentes — e a frase perde a
  > palavra internet: "Vários aparelhos pediram liberação na última hora — se você só
  > está esperando um, recuse os outros."

  `Por quê a versão degradada preserva o invariante:` o que sairia é a palavra "mesma
  rede", não o sinal. O Cenário 1 é **flood** — muitos pedidos plausíveis ao mesmo tempo
  — e isso o servidor observa com certeza, com proxy ou sem. A frase degradada é
  verdadeira independentemente de topologia, continua dizendo a ação, e não acende
  sempre, porque a condição volta a ser volume real em vez de um hash constante.
  `Por quê o número não sai do dado:` observabilidade. No dia em que alguém investigar
  um flood de verdade, "vários" não serve para nada. Frase para decidir, número para
  investigar.
- **`encerrados` cobre 30 dias.** Recusa e revogação precisam ser auditáveis por
  um período curto; não é histórico eterno.
- Rota **separada** de `/efrat/rh/dados`, que ganha apenas o contador
  `aparelhos_pendentes`, para o badge da aba. As equipes que o seletor de aprovação
  precisa já vêm em `equipes`, com a `unidade` de cada uma.
  `Por quê:` a aba de aparelhos muda enquanto o RH olha e precisa de refresh
  próprio; recarregar o painel inteiro (marcações do período, pessoas, equipes)
  a cada 15 s por causa de uma lista de 3 linhas é desperdício.

### 1.3 `POST /efrat/rh/aparelho/aprovar`

```json
{ "usuario": "rh", "chave": "…", "idempotency_key": "uuid-v4",
  "codigo": "ABC-123", "equipes_ids": ["eq-01", "eq-02"] }
```

Normalização do código: caixa alta, tudo fora do alfabeto descartado — `abc-123`,
`ABC 123` e `ABC123` são o mesmo código. O aparelho **exibe** agrupado
(`ABC-123`); o servidor **guarda** `ABC123`.

Um caractere que o alfabeto não usa (`O`, `I`, `L`, `0`, `1`) é sempre erro de
digitação, nunca código válido: `422 CODIGO_COM_LETRA_INVALIDA`, mensagem
"Esse código tem uma letra que a gente nunca usa (O, I, L, 0, 1). Confira na
tela do aparelho."
`Por quê:` o alfabeto foi escolhido para eliminar ambiguidade visual; devolver
"não encontrado" quando o problema é um zero digitado manda o RH procurar
defeito onde não tem.

Validações, todas `422` salvo indicado:

| Situação | Resposta |
|---|---|
| código não resolve nenhuma linha pendente, ou resolve linha expirada, recusada ou já ativa | `404 CODIGO_NAO_ENCONTRADO` — **uma mensagem só** para os quatro casos |
| mais de uma linha pendente com o mesmo código (bug de colisão) | `409 CODIGO_AMBIGUO`, não escolhe nenhuma |
| `equipes_ids` vazio | `ESCOPO_VAZIO` |
| alguma equipe inexistente ou inativa | `EQUIPE_INVALIDA`, com `campo: "equipes_ids"` |
| equipes de **unidades diferentes** no mesmo aparelho | `EQUIPES_DE_UNIDADES_DIFERENTES`, com `campo: "equipes_ids"` |
| mais de 10 códigos errados do mesmo usuário de RH em 5 min | `429 LIMITE_APROVACAO` + `Retry-After` |

`Por quê os quatro casos colapsam num só — e eu fui e voltei nesta linha:` a primeira
versão colapsava tudo com a mensagem "não achei nenhum aparelho esperando com esse
código", e o Designer apontou, com razão, que isso manda o RH procurar defeito onde não
tem quando o caso real é código expirado. Separei então `CODIGO_EXPIRADO` — e o
Orquestrador pegou o oráculo que eu tinha aberto: distinguir "expirou" de "nunca existiu"
**conta se aquele código específico chegou a existir**, e isso vale mesmo com força bruta
inviável (um insider com acesso de RH confirma que um aparelho plantado foi recebido).
A saída não era escolher entre as duas versões: é a redação do Designer, que carrega **as
duas possibilidades numa frase só** — "Código inválido ou expirado. Confira no aparelho e
digite de novo." Preserva exatamente o que eu defendia, o RH não é mandado procurar
defeito inexistente, e não distingue nada. Minha objeção era à **palavra**, não à fusão:
diagnostiquei o problema certo e escolhi a solução errada.
As outras duas recusas seguem distintas e sem risco: **formato inválido** não toca busca
nenhuma (validação antes de qualquer `lookup`) e **limite de tentativas** é sobre
frequência, não sobre a existência de um código específico. Três recusas, portanto, não
quatro. E o limite de tentativas erradas continua existindo porque é ele que sustenta a
frase acima.

**A unidade não vem no corpo: é derivada das equipes escolhidas.** As equipes
selecionadas têm de compartilhar a mesma `unidade` (comparada normalizada, §2.3), e
essa unidade é o rótulo que o aparelho vai exibir. Um campo a menos na requisição e
**um passo a menos na tela**: o RH escolhe quem bate ponto ali, e o lugar sai disso.

`Por quê a checagem existe:` é o que impede um tablet de sair aprovado com equipes de
três canteiros diferentes — a limitação de raio de exposição do Cenário 3 de
`ameacas-v3.md`, que é a razão de o escopo ser por equipe e não por unidade inteira.

**Texto da tela, fechado com o Designer, e é requisito.** Cabeçalho da escolha,
substituindo qualquer menção a "escopo" ou "equipes autorizadas": **"Quem bate ponto
neste aparelho?"** Linha de apoio acima da lista: **"Marque as equipes que trabalham
neste local. Só quem estiver marcado aqui é reconhecido por este aparelho — se ele
for perdido ou roubado, é só isso que fica exposto."** E **sem botão "selecionar
todas"**.
`Por quê é requisito e não estética:` este é o único ponto do contrato em que a tela
derruba a garantia sozinha, sem defeito no código e sem teste vermelho. O invariante
não morre por jargão, morre por comportamento racional — RH que não entende por que
escolhe marca todas, e o raio de exposição do Cenário 3 volta inteiro com a API
perfeitamente cumprida. A linha de apoio faz o trabalho que o botão "selecionar
todas" faria por engano: dizer por que marcar menos é o certo.

Efeito da aprovação, atômico: `estado` → `ativo`, grava `equipes_ids`, a `unidade`
derivada, `aprovado_por`, `aprovado_em`, `configuracao_versao` = 1, apaga
`codigo_curto` e `codigo_expira_em`.

Resposta `200`:

```json
{ "ok": true, "dispositivo_id": "uuid-v4", "apelido": "Tablet obra norte",
  "unidade": "Obra Norte",
  "equipes_ids": ["eq-01","eq-02"], "request_id": "…" }
```

O `apelido` na resposta serve para o RH conferir contra o aparelho na frente
dele — é o único momento em que o autodeclarado tem função, e é *depois* da
prova de posse, não em vez dela.

### 1.4 `POST /efrat/rh/aparelho/recusar`

```json
{ "usuario": "rh", "chave": "…", "idempotency_key": "uuid-v4",
  "pendente_id": "pend-7c1f…", "motivo": "não reconheço este aparelho" }
```

`estado` → `negado`, grava `recusado_por`, `recusado_em`, `motivo_decisao`.
Idempotente por `pendente_id`: recusar duas vezes devolve `200` com o mesmo
corpo. Recusar linha que já é `ativo` → `409 APARELHO_JA_ATIVO`.

**Recusa não exige código.** `Por quê:` prova de posse protege a *ativação*.
Errar uma recusa não dá acesso a ninguém — o pior caso é um aparelho legítimo
recusado, que pede de novo.

**`negado` é terminal para aquele `dispositivo_id`:** `registrar` com um UUID
negado devolve `409 DISPOSITIVO_RECUSADO`. O cliente, ao ver `estado: "negado"`,
oferece "Pedir liberação de novo", que **gera UUID e credencial novos**.
`Por quê:` sem terminalidade, quem foi recusado volta para a mesma fila e a
recusa não significa nada. E regenerar é seguro justamente aqui: um aparelho que
nunca foi `ativo` nunca abriu a tela de ponto, logo não tem marcação na fila
local para perder. A regeneração fica contida pelo limite por IP que
`registrar` já aplica.

O motivo digitado pelo RH **nunca volta para o aparelho**. A tela mostra frase
fixa. `Por quê:` texto livre do RH renderizado num aparelho que ele acabou de
declarar não confiável é vazamento gratuito de contexto interno.

**E a frase é a MESMA para recusado e para revogado** — proposta do Designer, aceita:
"Este aparelho não pode ser usado agora. Fale com o RH pra saber o que fazer."
`Por quê uma só:` distinguir os dois estados no texto conta a quem está com o aparelho
que houve um juízo negativo do RH, e em qual direção. Quem revogou por suspeita não quer
anunciar a suspeita ao aparelho suspeito. É o princípio da indistinção do link público
(§4.4), um andar acima.
O que **difere** é a **ação disponível**, não o texto: o recusado oferece "Pedir
liberação de novo" (que regenera identidade); o revogado não oferece nada. `Por quê isso
não anula a decisão acima:` o botão fala do que **este aparelho** pode fazer agora, não
do que o RH concluiu — e sem ele o aparelho recusado legítimo fica sem saída, que é o
problema que a frase única não pode criar.

### 1.5 `POST /efrat/rh/aparelho/revogar`

```json
{ "usuario": "rh", "chave": "…", "idempotency_key": "uuid-v4",
  "dispositivo_id": "uuid-v4", "motivo": "aparelho extraviado" }
```

`estado` → `revogado`, grava `revogado_por`, `revogado_em`, `motivo_decisao`.
Terminal. Efeito imediato: `carga` e `identificar` respondem
`403 DISPOSITIVO_INATIVO`; `estado` responde `revogado` (o cliente já trata,
`js/app.js:209`). **Marcação já na fila daquele aparelho é caso próprio, e não é
403:** §1.6.

### 1.6 Marcação vinda de aparelho revogado

Achado do QA, e é o mais feio dos três: **`/efrat/marcacoes` não olha o estado do
aparelho** (`tests/e2e/servidor-falso.js:447`) enquanto `/efrat/carga` olha
(`servidor-falso.js:286-294`); e no cliente, quando o servidor recusa o lote,
**nada sai da fila** (`js/api.js:178-182`) — retentativa infinita, em silêncio.
As duas metades juntas dão o pior arranjo possível: hoje o dado do revogado entra
sem carimbo nenhum, e no dia em que alguém "consertar" o servidor do jeito óbvio
(403 e pronto) o ponto do colaborador honesto passa a **desaparecer sem aviso**.

**A regra é separar *quando a marcação aconteceu* de *quando ela subiu*. Não
entra direto, não é descartada: entra retida na mesa do RH, com os dois instantes
lado a lado.**

`Por quê:` revogação existe para o caso "o tablet sumiu" — e o tablet que sumiu
carrega na fila o turno inteiro que mais ninguém tem. Descartar é apagar jornada
trabalhada. Aceitar como boa é dar valor de ponto a um aparelho em que o RH
acabou de dizer que não confia. Retida resolve as duas coisas: o registro existe,
é auditável, e não conta como ponto até um humano decidir.

**`/efrat/marcacoes` nunca responde 403 por estado de aparelho.** Sempre `200`
com resultado item a item — é o único formato em que o cliente consegue soltar o
que já foi resolvido e parar de retentar. Só `401 CREDENCIAL_INVALIDA` (credencial
que o servidor não reconhece mais) recusa o lote inteiro, e nesse caso a fila
fica, porque a máquina de estado do aparelho vai mostrar a tela de bloqueio.

Quatro status por item, e **todos os quatro tiram o item da fila de envio:**

| `status` | Servidor gravou? | Conta como ponto? | Cliente faz |
|---|---|---|---|
| `aceito` | sim | sim | tira da fila, arquiva em `enviadas` |
| `duplicado` | já estava | sim | tira da fila, arquiva em `enviadas` |
| `retido` | sim | **não, até decisão do RH** | tira da fila, arquiva em `enviadas` |
| `rejeitado` | **não, e não vai** | não | tira da fila, guarda em `recusadas` e **mostra** |

⚠ **Muda o que existe hoje, em dois pontos do cliente:**
`js/regras.js:55` (`itensParaRemover`) passa a incluir `retido`; e `rejeitado`
deixa de ficar na fila para sempre — vira coleção nova `recusadas` no IndexedDB,
visível, nunca reenviada e nunca apagada sozinha. Hoje `_erroPermanente` é
filtrado em `js/api.js:169` e **nunca é escrito por ninguém**, então item
rejeitado volta em todo lote, indefinidamente, sem aparecer para gente.

Estado do aparelho no envio, e o que cada um produz:

| Estado no momento do envio | Resultado por item | `motivo_codigo` |
|---|---|---|
| `ativo` | regra normal de hoje (`aceito` / `duplicado` / revisão) | — |
| `revogado`, dentro da janela e do teto | `retido` | `aparelho_revogado` |
| `revogado`, passados **30 dias** de `revogado_em` | `rejeitado` | `janela_de_drenagem_encerrada` |
| `revogado`, além de **500** marcações aceitas após a revogação | `rejeitado` | `limite_pos_revogacao` |
| `pendente` ou `negado` | `rejeitado` | `aparelho_nunca_liberado` |

`Por quê os dois limites:` um aparelho roubado que continua entregando lote é
ruído na fila do RH (mesma família do Novo 3 de `ameacas-v3.md`). 30 dias cobre
com folga o aparelho que ficou offline num canteiro; 500 marcações cobrem com
folga um turno de equipe inteira. Estourar qualquer um dos dois vira `rejeitado`
— **nunca um 403 silencioso**: o item sai da fila e aparece como recusa, com
frase própria.

`Por quê pendente/negado é `rejeitado` e não `retido`:` aparelho nesses estados
nunca abriu a tela de ponto, logo não existe marcação legítima que possa ter
nascido nele. Lote vindo de lá é fabricado, e reter fabricado só enche a mesa
do RH.

Cada item retido é gravado com os dois instantes e a procedência, e é isso que a
tela de pendências mostra:

```json
{
  "marcado_em": "2026-08-20T10:03:11Z",
  "deriva_relogio_ms": 1200,
  "recebido_em": "2026-08-21T17:20:44Z",
  "aparelho_estado_no_envio": "revogado",
  "aparelho_revogado_em": "2026-08-20T21:00:00Z",
  "requer_revisao": true,
  "motivo_codigo": "aparelho_revogado"
}
```

A pendência aparece com os três instantes em linha, agrupada por aparelho e com
contagem: "Tablet obra norte · revogado em 20/08 18:00 · **14 marcações
recebidas em 21/08 14:20**, batidas entre 20/08 07:02 e 20/08 17:40". O RH decide
em bloco ou uma por uma.
`Por quê agrupado com contagem:` é o mesmo critério registrado em
`ameacas-v3.md` § Novo 3 — sem a contagem visível, o RH não percebe inflação da
fila mesmo quando cada linha parece plausível.

Resposta do lote, por item:

```json
{ "ok": true, "servidor_hora": "2026-08-21T17:20:44Z",
  "resumo": { "aceitas": 0, "duplicadas": 0, "retidas": 14, "rejeitadas": 0 },
  "resultados": [
    { "id_cliente": "…", "status": "retido",
      "motivo_codigo": "aparelho_revogado",
      "motivo": "Aparelho revogado: o RH vai conferir esta marcação." }
  ],
  "request_id": "…" }
```

`resumo.retidas` é campo novo; `motivo_codigo` é novo e é o que o cliente usa
para escolher a frase, em vez de exibir texto do servidor.

A confirmação de revogar, na tela do RH, diz o que acontece: "Se este aparelho
tiver ponto não enviado, ele ainda entrega — e cada marcação vai cair na sua
mesa para conferência, com a hora da batida e a hora em que chegou."

### 1.7 `POST /efrat/rh/aparelho/escopo`

```json
{ "usuario": "rh", "chave": "…", "idempotency_key": "uuid-v4",
  "dispositivo_id": "uuid-v4", "equipes_ids": ["eq-01"] }
```

Mesmas validações de `aprovar` (`ESCOPO_VAZIO`, `EQUIPE_INVALIDA`,
`EQUIPES_DE_UNIDADES_DIFERENTES`), e a `unidade` continua derivada das equipes.
Incrementa `configuracao_versao`.

`Por quê existe:` sem ela, corrigir o escopo de um aparelho já aprovado exige
revogar e recadastrar — o que só é possível com acesso físico ao aparelho para
ler o código novo. É a única das cinco rotas cuja **tela** pode ficar para
depois sem trancar nada; a rota, não, porque a alternativa é perda de acesso.

### 1.8 O que `/efrat/dispositivo/estado` passa a devolver

Duas adições, nenhuma remoção. Pendente:

```json
{ "ok": true, "estado": "pendente", "codigo_curto": "ABC123",
  "codigo_expira_em": "2026-08-22T11:02:00Z", "consultar_apos_s": 15,
  "request_id": "…" }
```

Ativo:

```json
{ "ok": true, "estado": "ativo",
  "dispositivo": {
    "dispositivo_id": "uuid-v4", "apelido": "Tablet obra norte",
    "unidade": "Obra Norte",
    "equipes_ids": ["eq-01","eq-02"], "configuracao_versao": 7
  },
  "request_id": "…" }
```

- `codigo_expira_em` permite a tela dizer quanto tempo o código ainda vale, em
  vez de exibir um número que pode ter morrido.
- `dispositivo.unidade` é a volta do laço de §1.1 — texto, não referência, e o
  aparelho só o exibe.
- **Nada mais entra aqui.** Em particular: nada de `motivo` de recusa, nada de
  nome de quem aprovou, nada de contagem de pendentes. É a única rota que um
  aparelho não aprovado consegue chamar; cada campo novo é superfície.
- **O telefone do RH não vem da API.** A tela de espera mostra contato a partir
  de `EFRAT_CFG.contatoRh = { nome, telefone }` em `js/config.js`.
  `Por quê:` não é dado por aparelho, muda por cliente, e `config.js` existe
  exatamente para o que se edita no servidor sem republicar. Pôr na resposta de
  `estado` seria dar informação da organização a quem ainda não foi liberado.

`ultimo_uso_em` (§1.2) é atualizado em `/efrat/carga` e `/efrat/marcacoes`,
**não** em `/efrat/dispositivo/estado`. `Por quê:` `estado` é consultado a cada
15 s por aparelho pendente; escrever a cada consulta transformaria polling em
carga de escrita numa Data Table. "Último uso" que interessa ao RH é uso real,
não sinal de vida.

### 1.9 A tela de espera

Não precisa de rota nova. Ela já tem o caminho para o RH: `#btnAcessar` fica
fora do rodízio exclusivo de `mostrar()` (`js/ui.js:14`), alcançável em `porta`
e `aguardando` — resolvido em T-E3DBD4. O que muda é conteúdo, não contrato:
texto sem "liberação" e sem "aparelho" como jargão, o código legível de longe,
e o contato do RH vindo de `config.js`.

Invariante de tela que continua valendo (`plano-v3.md` § critério 3): o código
curto existe **só** no `textContent` do elemento visível — nunca em log,
querystring, atributo, ou `title`. E é apagado do DOM em toda transição de
estado, porque `.hide` não apaga.

---

## 2. B · Equipes com membros

### 2.1 O vínculo pessoa–equipe: onde ele mora

**Decisão: uma pessoa pertence a uma equipe, e o vínculo mora em
`efrat_pessoa.equipe_id`. O membro se move por escrita na pessoa
(`POST /efrat/rh/colaborador` com `pessoa_id`), não por rota própria de
equipe.** Não existe `/efrat/rh/equipe/membro`.

`Por quê`, em três razões independentes:

1. **Uma equipe por pessoa é invariante do escopo offline.** `/efrat/carga`
   filtra pessoas por `equipe_id ∈ equipes_ids` do aparelho
   (`servidor-falso.js:299`, `carga-escopada.workflow.js`). Pessoa em duas
   equipes entra duas vezes na galeria de um aparelho com as duas no escopo, e o
   escopo do gestor (`equipes_ids` da sessão) fica ambíguo — dois gestores
   passariam a poder propor ajuste sobre a mesma pessoa.
2. **Duas rotas escrevendo a mesma coluna é o erro que `api-piloto.md` já
   documenta.** O `upsert` de Data Table *insere* quando o filtro não casa; uma
   rota de equipe que grava `equipe_id` de pessoa erra a tabela no dia em que o
   filtro não bate.
3. **"Remover membro" não é apagar nada.** É trocar a equipe, ou desligar a
   pessoa. Rota própria de remoção sugeriria que existe algo a excluir.

"Adicionar membro", na tela da equipe, é portanto: escolher a pessoa e gravar a
nova `equipe_id` dela. A tela é a da equipe; a escrita é na pessoa.

**"Sem rota de membro" não é "sem gestão de membro".** A tela continua
obrigatória, exatamente como o cliente pediu: abrir a equipe, ver os membros,
**adicionar e remover de dentro dela**. Esta decisão muda a **forma da API**, não o
**escopo da tela** — quem implementar T-8188C6 entrega a gestão de membros na aba
de equipes, usando `/efrat/rh/colaborador` por baixo. Mandar o RH sair da equipe,
procurar a pessoa na aba de pessoas e trocar um `<select>` de equipe **não** cumpre
o pedido, mesmo sendo a mesma escrita.

**Sem equipe é estado válido.** `equipe_id: null` mantém a pessoa cadastrada,
com histórico, fora de toda carga — logo sem poder bater ponto. É a resposta
honesta a "removi da equipe e ainda não sei para onde vai". O painel mostra
esse balde ("sem equipe") porque gente invisível ali é gente que ninguém percebe
que não consegue marcar.

### 2.2 O histórico de marcações de quem sai

**Invariante: a marcação carrega a `equipe_id` que valia no instante da batida,
e nenhum relatório recalcula isso a partir da equipe atual da pessoa.**

`efrat_marcacao.equipe_id` já é gravado assim — vem da carga, no cliente. O que
este contrato faz é fixar a regra de leitura:

- Espelho de ponto, marcações por dia, taxa manual por equipe e pendências leem
  `marcacao.equipe_id`. `js/rh.js:314` já faz certo (`this.nomeEquipe(m.equipe_id)`);
  a regra existe para não regredir.
- "Presença hoje por equipe" é a única que usa a equipe **atual** da pessoa, e
  está correto: presença é expectativa de hoje, não fato de ontem.
- Consequência aceita: o relatório de agosto de uma equipe continua contando
  quem saiu dela em setembro. É o que a auditoria trabalhista espera — a jornada
  aconteceu naquela equipe.

Nada é reescrito, nada é apagado, nenhuma correção é lançada quando alguém troca
de equipe. Troca de equipe não é correção de ponto.

### 2.3 `POST /efrat/rh/equipe` — estendida

```json
{ "usuario": "rh", "chave": "…", "idempotency_key": "uuid-v4",
  "equipe_id": "eq-01", "nome": "Equipe Norte", "unidade": "Obra Norte",
  "lat": -20.46, "lng": -54.62, "raio_m": 500, "ativo": true }
```

- Sem `equipe_id` → cria. Com `equipe_id` → atualiza.
- **`unidade` continua sendo o texto que já é hoje.** Sem entidade nova, sem
  `local_id`, sem tela de locais. Decisão tomada com o Orquestrador depois de o
  Full-Stack perguntar de onde nascia esse conceito — o raciocínio inteiro está em
  §2.4, e ele diverge de propósito de `adr-acesso-v3.md` § Persistência e locais.
- `unidade` é **normalizada na escrita**: `trim`, espaços internos colapsados. A
  comparação é sem diferenciar caixa nem acento, então `Unidade A`, `unidade a` e
  `Unidade  A` são a mesma unidade. Grava-se a grafia da primeira vez que apareceu.
- Na tela, `unidade` é **escolha entre os valores existentes** mais "nova unidade",
  nunca um campo de texto solto. É o que transforma texto livre em vocabulário
  controlado sem criar entidade — e é o que faz a normalização acima quase nunca
  precisar entrar em ação.
- `nome` obrigatório, 2–60 caracteres, único entre equipes ativas
  (`409 EQUIPE_DUPLICADA`).

**Inativar equipe (`ativo: false`) é recusado enquanto houver membro ativo:**
`422 EQUIPE_COM_MEMBROS`, com `membros_ativos: 4` no corpo do erro para a tela
poder dizer quantos.
`Por quê:` inativar equipe com gente dentro cria quebra silenciosa — a equipe
sai de todo `equipes_ids` de aparelho (regra abaixo) e as pessoas dela param de
conseguir bater ponto sem que ninguém tenha decidido isso. Forçar o RH a
resolver as pessoas primeiro troca uma falha muda por uma frase clara.

**Equipe inativa sai do escopo de todo aparelho.** A aprovação e a edição de
escopo já recusam equipe inativa (§1.3, §1.7); inativar remove a equipe dos
`equipes_ids` existentes e incrementa `configuracao_versao` dos aparelhos
afetados. `/efrat/carga` nunca entrega pessoa de equipe inativa.

A leitura do detalhe da equipe **não tem rota nova**: `/efrat/rh/dados` já
devolve `equipes` e `pessoas` inteiras, e a lista de membros é
`pessoas.filter(p => p.equipe_id === id)` no cliente.
`Por quê:` é a mesma decisão de arquitetura de `js/regras.js` — o servidor
entrega fato, o cliente calcula recorte, e o cálculo fica coberto por teste de
unidade em Node. Rota de membros seria um segundo caminho para a mesma verdade.

### 2.4 Por que `unidade` fica texto, e não vira entidade

O Full-Stack parou antes de começar T-8188C6 para perguntar de onde nascia o conceito
de "locais", que aparecia em duas pontas deste contrato. Fez certo, e a pergunta achou
um problema meu: **ninguém pediu essa entidade.** O cliente pediu equipes e
colaboradores; `unidade` já existe hoje como texto (`js/rh.js` lista `e.unidade`, e o
formulário traz "Unidade Piloto" como padrão). Trocá-la por uma entidade com id
próprio daria a um RH leigo **três conceitos onde havia dois**, e acrescentaria um
passo ("em que local?") em duas telas.

**Decisão: texto, sem entidade.** E a pergunta que decidiu foi: *o escopo do aparelho
fica frouxo sem ela?* Não fica. Três razões, na ordem em que importam.

**1. A unidade nunca governou nada.** O que determina a carga é `equipes_ids`, e só:
o servidor monta a galeria a partir dele (`/efrat/carga`, ADR § *o servidor obtém
`equipes_ids` exclusivamente do cadastro ativo*). O `local_id` que eu havia posto em
§1.3 não era fronteira de acesso — era rótulo e agrupador. Fronteira de acesso
continua sendo a lista de equipes, com ou sem entidade.

**2. A checagem de coerência funciona em texto.** O que ela precisa afirmar é "estas
equipes são do mesmo lugar", e isso se compara igual em texto normalizado. O que
tornava texto frágil — `Unidade A` virando duas unidades por causa de caixa ou espaço
— morre com duas medidas de §2.3: normalizar na escrita e **oferecer os valores
existentes na tela em vez de campo solto**. Texto livre com seletor é vocabulário
controlado sem tabela nova. E, de quebra, a unidade passou a ser **derivada** das
equipes na aprovação (§1.3), então a tela de liberação perdeu um passo em vez de
ganhar.

**3. O único poder exclusivo da entidade é um poder que não queremos.** A entidade
permitiria o aparelho seguir o *lugar* em vez da lista: equipe nova naquele canteiro
entraria no escopo do tablet sozinha. Isso é precisamente o que `ameacas-v3.md` R1 e
Cenário 3 existem para impedir — significaria que **criar uma equipe concede,
silenciosamente, acesso à biometria de gente nova a um aparelho já aprovado**, sem
nenhuma decisão do RH. O argumento mais forte a favor da entidade é, olhado de perto,
o argumento mais forte contra ela.

Sobre o geofence: `lat`, `lng` e `raio_m` **já vivem em `efrat_equipe`** hoje. Tirá-los
de lá para uma tabela de locais é desduplicação de banco — exatamente normalização
entrando numa tela de usuário leigo.

O que cada lado custa, sem maquiagem:

| | Custo real |
|---|---|
| **Texto (escolhido)** | endereço e geofence repetidos por equipe; renomear um canteiro é editar N equipes em vez de uma linha. Com 2 equipes hoje, é barato; com 40, não seria |
| **Entidade** | um terceiro conceito para o RH, um passo a mais em duas telas, uma migração das equipes existentes, e a tentação permanente de "o aparelho segue o local" |

**Isto diverge de propósito de `adr-acesso-v3.md` § Persistência e locais**, que cria
`efrat_local` e a chama de fonte única dos locais. Não estou apagando aquela decisão:
ela pesou modelagem de dados e não pesou o custo de tela, e o brief desta fase é
explicitamente "a aplicação o mais simples possível, para gente leiga". Fica
registrado que o ADR aponta para o outro lado e que a divergência é consciente.

**Quando isso vira entidade.** Quando renomear um canteiro passar a significar editar
muitas equipes, ou quando o geofence por local realmente importar. A migração fica
mecânica **porque normalizamos agora**: texto normalizado e escolhido em seletor
converte para referência com um `INSERT DISTINCT` e um `UPDATE`, sem faxina de dados.
Normalizar hoje é o que mantém a porta aberta barata — e é a diferença entre adiar e
abandonar.

---

## 3. C · Colaborador

### 3.1 Telefone

**Formato canônico armazenado: E.164** — `+5567998765432`, sem espaço, sem
parêntese, sem hífen.

`Por quê E.164 e não dígitos BR:` é a única forma que um gateway de
SMS/WhatsApp aceita sem adivinhar, é a forma que o deep link `wa.me/<E164>`
exige (§4.5, que é o mecanismo de entrega do link de face), ela faz round-trip
sem perda, e não quebra no dia em que a Efrat contratar alguém com número de
fora. A máscara bonita `(67) 99876-5432` é apresentação: o cliente formata para
ler e envia canônico.

Normalização no servidor, antes de validar: remove espaço, `-`, `.`, `(`, `)`.
Depois:

| Entrada normalizada | Resultado |
|---|---|
| `+` + 8 a 15 dígitos, país ≠ 55 | aceita como está; marca `telefone_estrangeiro: true` na resposta |
| 11 dígitos (DDD + 9 + 8) | aceita, guarda `+55` + os 11 |
| 13 dígitos começando em `55` | aceita, guarda `+` + os 13 |
| 10 dígitos (DDD + 8) ou 12 começando em `55` | `422 TELEFONE_NAO_MOVEL` |
| qualquer outro tamanho, ou sobrou não-dígito | `422 TELEFONE_INVALIDO`, `campo: "telefone"` |
| DDD com `0` em qualquer posição, ou fora de 11–99 | `422 TELEFONE_INVALIDO` |
| ausente ou vazio | `422 TELEFONE_OBRIGATORIO` |
| já existe pessoa **ativa** com o mesmo E.164 | `409 TELEFONE_DUPLICADO`, salvo autorização explícita (abaixo) |

**Tem de ser celular.** No Brasil, celular é DDD + `9` + 8 dígitos; fixo tem 8
dígitos começando em 2–5. Fixo é recusado com mensagem própria: "Precisa ser um
celular: é por ele que a gente manda o link do cadastro de face."
`Por quê:` a decisão 1 da fase diz que o telefone existe porque é o canal com o
RH, e o canal concreto que este contrato constrói (§4.5) manda link por
WhatsApp/SMS. Um fixo satisfaz a coluna e não satisfaz a função.

**Duplicado é recusado, com uma saída autorizada.** O corpo pode trazer
`autorizar_telefone_duplicado: true` e `motivo_telefone_duplicado` (10 a 200
caracteres); nesse caso grava, e registra **quem** autorizou, **quando** e **por
quê**. Sem isso, `409 TELEFONE_DUPLICADO`. A mensagem pode nomear quem já usa o
número: quem pergunta está autenticado como RH.

`Por quê a exceção existe:` recusar sem saída faz o RH digitar número falso para
conseguir salvar a ficha, e número falso é pior que número compartilhado — é uma
mentira na base que ninguém consegue detectar depois. Marido e mulher na mesma
obra com um celular é situação real, e o cadastro tem de aceitá-la.

**E a exceção para aí: pessoa com telefone compartilhado não recebe link de
face.** A exceção é sobre **poder existir na ficha**, nunca sobre **poder receber
o link**. Para ela sobram os outros dois caminhos de §4.3 — câmera do PC e upload
—, que é exatamente o que a situação pede: se as duas pessoas atendem o mesmo
aparelho, a entrega remota não tem como distinguir quem abriu.

`Por quê essa é a linha:` o telefone é o **canal de entrega** do link, e link no
número errado entrega template para a pessoa errada — o pior caso do produto,
descrito em §4.3. Um número compartilhado não é um cadastro incompleto, é um canal
ambíguo. Ambiguidade no cadastro é administrável; ambiguidade na entrega de
biometria não é.

**`telefone_compartilhado` é derivado, não gravado:** vale para toda pessoa ativa
cujo E.164 é usado por outra pessoa ativa, contado na leitura. Assim o estado
**se cura sozinho** — no dia em que uma das duas ganha número próprio ou é
inativada, a outra volta a poder receber link, sem ninguém ter de desfazer nada.
O que fica gravado é só a autorização (`telefone_autorizado_por`,
`telefone_autorizado_em`, `telefone_autorizacao_motivo`), porque autorização é
fato histórico.

`/efrat/rh/dados` devolve, em cada pessoa, **com quem** o número é compartilhado:

```json
{ "pessoa_id": "p-1", "…": "…",
  "telefone_compartilhado": true,
  "telefone_compartilhado_com": [{ "pessoa_id": "p-7", "nome": "João Souza" }] }
```

`Por quê nomear:` o texto aprovado pelo Designer diz "mesmo celular de **João
Souza**" no diálogo de autorização e "compartilhado com **João Souza**" ao lado do
botão de link. Sem esse campo o texto não tem dado por trás e vira "compartilhado
com outra pessoa", que obriga o RH a caçar quem. Nomear é seguro: quem lê está
autenticado como RH e já enxerga a lista inteira de pessoas. Lista, não campo
único, porque três pessoas no mesmo número é raro e não é impossível.

**Texto, fechado com o Designer.** A consequência aparece **no momento em que o RH
autoriza**, não depois — descobrir na hora de mandar o link é descobrir tarde. E
nenhum dos textos usa linguagem de sentença, porque o estado é derivado:

- diálogo, aviso fixo antes do campo: "Autorizando, esta pessoa fica cadastrada
  com o mesmo celular de **\<nome\>** — e não vai poder receber o link de cadastro
  de face **enquanto o número for compartilhado**. O rosto dela terá de ser
  cadastrado aqui, pela câmera do computador ou por upload de fotos.";
- campo obrigatório, 10 a 200 caracteres: "Por que autorizar mesmo assim?", com
  exemplo "pai e filho no mesmo canteiro, um celular só". O botão só destrava com
  10+ caracteres;
- na ficha e na lista: tag neutra "telefone compartilhado" — estado, não punição;
- ao lado do botão de enviar link, desabilitado **com a razão visível**, nunca em
  silêncio: "Link de cadastro indisponível — telefone compartilhado com
  **\<nome\>**. Cadastre o rosto pela câmera ou por upload."

O campo de motivo substitui o checkbox de confirmação que o desenho anterior tinha:
checkbox prova que alguém clicou, motivo prova **o quê** — e esta é uma decisão que
fica registrada e pode ser auditada depois.

`telefone_compartilhado_com` é lista, então tem dois registros de apresentação, e a
regra é do Designer: **no diálogo, lista completa** ("João Souza, Maria Lima e Pedro
Santos"), porque ali o RH está decidindo e precisa da informação inteira; **na ficha,
truncada a partir de três** ("com João Souza, Maria Lima e mais 1"), porque ali é
leitura de relance e "e mais 1" já sinaliza "não é só uma pessoa".

E os dois motivos de o botão de link ficar indisponível **não compartilham texto**,
porque as saídas são diferentes: `TELEFONE_COMPARTILHADO_SEM_LINK` manda mudar de
canal ("Cadastre o rosto pela câmera ou por upload"), `PESSOA_SEM_TELEFONE` manda
completar o cadastro ("Informe o celular da pessoa antes de enviar o link"). Dois
códigos distintos no servidor existem exatamente para a tela poder falar dois
idiomas ali.

**Sem migração de dados.** `telefone` é obrigatório em **escrita** (criação e
atualização). As linhas antigas do piloto vêm sem telefone; leitura tolera vazio
e o painel marca "sem telefone". A primeira edição de cada pessoa preenche —
backfill acontece pelo uso, não por script.

### 3.2 Edição

`POST /efrat/rh/colaborador`, a mesma rota, com `pessoa_id` = atualização.

```json
{ "usuario": "rh", "chave": "…", "idempotency_key": "uuid-v4",
  "pessoa_id": "p-1", "versao_cadastro": 3,
  "nome": "Ana Souza", "matricula": "001", "telefone": "+5567998765432",
  "equipe_id": "eq-01", "papel": "colaborador" }
```

**`ativo` não existe neste corpo.** Ligar e desligar uma pessoa é ação própria,
§3.3. Corpo que traga `ativo` é recusado com `400 CAMPO_NAO_EDITAVEL`.

`Por quê, e é achado do QA:` este POST manda o **registro inteiro**. Operadora A
inativa a pessoa; operador B, com a tela aberta de antes, corrige o telefone e
salva — e reativa a pessoa por acidente. Ela volta para a carga e volta a bater
ponto, sem ninguém ter decidido isso. `versao_cadastro` pega o caso em que a tela
de B é anterior à inativação, mas não é a defesa certa: a defesa certa é o campo
não estar no formulário. Desligar gente é decisão, não campo de cadastro.

**Quem pode:** qualquer usuário de `efrat_usuario_rh` ativo. Não há papel de RH
nesta rodada (decisão 5 da fase: papéis seguem dois, e são papéis de
*colaborador*, não de painel). Toda escrita grava `atualizado_por` e
`atualizado_em`.

**Controle de atualização perdida:** `versao_cadastro` é inteiro, incrementado a
cada escrita. Divergente → `409 CADASTRO_DESATUALIZADO`, com o registro atual no
corpo do erro para a tela poder dizer "alguém alterou esta pessoa enquanto você
editava" e mostrar o quê.
`Por quê:` idempotência (C1) protege contra a *mesma* requisição repetida; não
protege contra duas pessoas do RH editando a mesma ficha em abas diferentes, que
é o caso realista num RH de duas ou três pessoas.

**O que nunca muda depois:**

| Campo | Regra |
|---|---|
| `pessoa_id` | imutável, sempre. É a chave para onde toda marcação aponta. Tentativa de trocar → `422 PESSOA_ID_IMUTAVEL` |
| `matricula` | mutável **enquanto a pessoa tiver zero marcações**; a partir da primeira, `422 MATRICULA_IMUTAVEL` |

Aprovado pelo Orquestrador: o corte na primeira marcação é a fronteira certa.

`Por quê a matrícula assim:` ela é a chave de negócio que sai no espelho e no
AFD, e `/efrat/cadastro` cria pessoa por matrícula — mudar depois de existir
ponto torna relatório antigo irreconciliável. Mas travar desde o primeiro
segundo transforma um erro de digitação do dia do cadastro em "inative e crie de
novo", o que é desproporcional e polui a base. O corte na primeira marcação é
exatamente a fronteira entre "ficha recém-criada" e "registro trabalhista".

**O que a edição muda:** `nome`, `telefone`, `equipe_id` (inclusive para `null`,
§2.1) e `papel`. Nada mais.
`papel` troca nos dois sentidos. Trocar não reprocessa marcação antiga — o livro
é append-only, e a marcação já carrega o que valia. Rebaixar gestor encerra o
efeito para frente: a próxima sessão de gestor simplesmente não é emitida, e
sessão viva morre no TTL de 10 min do ADR.

**Derivados não são graváveis:** `tem_biometria`, `sem_equipe`, `miniatura`,
`ativo`, `telefone_compartilhado`. Vêm na leitura, recusados na escrita
(`400 CAMPO_DERIVADO`).
`versao_cadastro` é exceção de leitura-e-envio: vai no corpo como **pré-condição**
(o valor que o operador tinha na tela), nunca como valor a gravar — quem
incrementa é o servidor.

### 3.3 Inativar e reativar — ação própria, rota própria

Duas rotas, não um campo:

- `POST /efrat/rh/colaborador/inativar` — `{ usuario, chave, idempotency_key,
  pessoa_id, versao_cadastro, motivo }`
- `POST /efrat/rh/colaborador/reativar` — `{ usuario, chave, idempotency_key,
  pessoa_id, versao_cadastro, telefone }`

Ambas exigem `versao_cadastro` e são idempotentes: inativar quem já está inativo
devolve `200` com o mesmo corpo. `motivo` na inativação é obrigatório (10 a 500
caracteres) e vai para a trilha, nunca para nenhum aparelho.

Efeitos da inativação, todos explícitos:

1. **Marcações passadas: intocadas.** Nenhuma linha de `efrat_marcacao` muda,
   nenhuma correção é lançada. O espelho de ponto de quem saiu continua completo
   e consultável. É requisito legal, não gentileza (`validacao-biometrica.md`
   §6.1, art. 74 IV).
2. **Sai da carga.** `/efrat/carga` já filtra ativos — o próximo sincronismo de
   cada aparelho a remove da galeria offline.
3. **Ponto que chega depois, de antes.** Um aparelho que ficou offline pode
   entregar marcação anterior à inativação. Vale a mesma separação de §1.6 entre
   o instante da batida e o instante da subida:
   - `marcado_em` **anterior** a `inativado_em` → `retido`, `motivo_codigo:
     "pessoa_inativa_no_envio"`;
   - `marcado_em` **posterior** a `inativado_em` → `rejeitado`, `motivo_codigo:
     "pessoa_inativa"`;
   - `pessoa_id` inexistente → `rejeitado`, `motivo_codigo: "pessoa_desconhecida"`.

   `Por quê:` hoje os dois primeiros casos são o mesmo `rejeitado`
   (`api-piloto.md` § tabela de `/efrat/marcacoes`), e o primeiro é perda de
   ponto de gente que trabalhou de verdade — jornada da terça, desligamento na
   quarta, sincronismo na quinta. O segundo segue recusado, porque ponto batido
   depois do desligamento é exatamente o que a recusa existe para pegar. E os
   três agora **saem da fila do aparelho** (§1.6), em vez de voltar em todo lote.
   **Precisa de `inativado_em`** para o teste de antes/depois ser possível — daí
   a coluna nova (§5).
4. **Biometria é descartada.** Ao inativar, `vetores` e `miniatura` dos templates
   daquela pessoa são apagados: a linha de `efrat_template` fica, com
   `estado: "descartado"` e `descartado_em`, para trilha de auditoria — sem
   conteúdo biométrico dentro. Convite de face vivo daquela pessoa vai para
   `revogado` no mesmo ato.
   `Por quê:` `validacao-biometrica.md` §6.3 — template dura enquanto durar o
   vínculo; o histórico de ponto continua guardado **sem** o template associado.
   Inativar é o evento de fim de vínculo que este produto tem.
   **Consequência que a tela precisa dizer antes de confirmar:** "Reativar esta
   pessoa exige cadastrar o rosto de novo."
5. **Reativar** exige `telefone` válido no corpo (§3.1) e devolve a pessoa **sem
   biometria** — ela entra no indicador "ativos sem biometria" e só pode ser
   marcada manualmente até novo cadastro de face.

`foto_auditoria` de marcações antigas não é tocada aqui; segue a retenção de 90
dias de `validacao-biometrica.md` §6.3, dívida herdada e não desta rodada.

---

## 4. D · Cadastro de face

### 4.1 Onde o descritor é calculado e o que trafega

**Decisão: o descritor é calculado no navegador que tem as fotos. Sai do
navegador apenas: 3 vetores de 128 dimensões, 1 miniatura 128×128 JPEG e as
métricas de qualidade. As fotos originais nunca trafegam. O número de coerência
não trafega — quem calcula é o servidor (§4.2).**

`Por quê o descritor no cliente:`

- O motor já é cliente: `vendor/face-api.js` + `models/` auto-hospedados,
  `js/face.js` roda a inferência. O n8n não tem modelo, não vai ter nesta rodada,
  e pôr um exigiria sair da arquitetura (§ Restrição, item 4).
- Três fotos cruas por webhook do n8n são megabytes de base64 atravessando
  workflow e possivelmente encostando em Data Table. É o mesmo motivo pelo qual
  `foto_auditoria` só é gravada quando há revisão.
- Menos dado pessoal em trânsito e em repouso. A miniatura existe porque o RH
  precisa comparar rosto com rosto na fila de recadastro, e é a menor coisa que
  serve para isso.

O limite honesto, que `api-piloto.md` já registra: **o servidor não reconfere a
biometria** — não sabe se aquele vetor veio do rosto certo. §4.2 e §4.3 reduzem
esse limite sem modelo no servidor; não o eliminam. É por isso que existe §4.3.

### 4.2 A regra das três fotos — a coerência é do servidor

Exatamente três fotos, exatamente um rosto em cada.

- zero rostos numa foto → recusa **aquela** foto, dizendo qual ("Não achei um
  rosto na foto 2");
- dois ou mais rostos numa foto → recusa aquela foto ("Tem mais de uma pessoa
  nesta foto").

**A gravação de template é condicional, e a condição é avaliada no servidor:**

> Recebe exatamente 3 vetores de 128 números finitos. Calcula as três distâncias
> euclidianas par a par. Se a **maior** delas ficar abaixo do limiar de aceite
> (`0,45`), grava. Senão, `422` e não grava nada.

**O campo `coerencia` sai do corpo da requisição.** Não é mais aceito em nenhuma
das rotas de cadastro de face — se vier, é ignorado (não é erro, para não quebrar
cliente antigo em migração, mas não é lido).

`Por quê, e é achado do QA:` um número que o cliente informa sobre si mesmo é um
número que o cliente escolhe. Hoje `js/rh.js:520` manda `coerencia` calculada e
`servidor-falso.js:544-546` só confere se `vetores` é array não vazio — o número
não é usado para nada. E `js/fila.js:262`, no cadastro pelo gestor em campo,
manda **`coerencia: 0` fixo**: o valor mais confiável possível, sobre nada. Não é
má-fé, é a consequência inevitável de pedir ao cliente que se avalie.

O servidor **consegue** fazer essa conta: é distância euclidiana sobre números
que ele recebeu, não inferência. É a única conferência biométrica possível sem
modelo — logo, é obrigatória. Fecha metade do buraco "não reconfere a biometria"
exatamente no momento em que o template nasce.

Faixas, e as duas pontas são medidas, não arbitradas. Referências de
`validacao-biometrica.md`: mesma pessoa em pose diferente **0,094**; pessoas
diferentes **0,61** e **0,80**. E o aceite do produto, **0,45**, que **não é medição** —
ver a procedência de cada número logo abaixo.

**Procedência dos números desta seção.** Varredura pedida pelo Orquestrador depois de o QA
pegar o `0,133` sendo citado como medido quando é aritmética de fixture sintética. Foi a
segunda vez na fase que número construído apareceu como medido, então a distinção passa a
ser explícita e permanente:

| Número | O que é | Ressalva |
|---|---|---|
| `0,094` | **medido** — mesma pessoa, pose diferente | 1 pessoa, 1 par |
| `0,169` `0,253` `0,257` `0,422` `0,440` | **medidos** — mesma pessoa com adorno contra template limpo dela mesma | **1 pessoa**, 6 tentativas por adorno |
| `0,61` `0,80` | **medidos** — pessoas diferentes | 2 pares |
| **`0,45`** | **escolhido**, não medido | `limiarAceite` de `js/config.js`. `validacao-biometrica.md:85` diz que esse ponto de operação **tem de ser calibrado com dados da própria população da Efrat, não copiado** — e não foi. É o número em que esta seção mais se apoia, e é o menos sustentado dela |
| `0,58` | **escolhido** | `limiarCinza`, mesma ressalva |
| `0,02` | **escolhido por mim**, ancorado em `0,094` | separa "pose diferente" de "mesmo arquivo"; nenhuma medição delimita esse piso |
| `0,1329` | **construído** | fixture sintética do QA: `0,094 × √2`. Não há rosto por trás |
| `29,7 bits` | **construído** | `log2(31⁶)`, do alfabeto de §1.1 |

`A consequência que importa:` o teto da regra de coerência **é** o `limiarAceite`, então
ele herda a incerteza dele. Isso está certo como acoplamento — no dia em que a calibração
mover `0,45`, a regra de cadastro move junto, sozinha, porque é a mesma constante. O que
não se deve fazer é ler `0,45` como validado só porque está no código desde o começo.
Antiguidade de um número não é evidência.

| Faixa da maior distância par a par | Decisão |
|---|---|
| `< 0,02` | **recusa** — `422 FOTOS_IGUAIS` |
| `>= 0,02` e `< 0,45` | **grava** |
| `>= 0,45` | **recusa** — `422 COERENCIA_INSUFICIENTE` |

**Em exatamente `0,45` o cadastro recusa.** Isso diverge por um fio de
`vereditoPorDistancia` (`js/regras.js:14`), que faz
`if (dist <= cfg.limiarAceite) return 'aceito'` — ou seja, no reconhecimento a
fronteira exata **aceita**. A assimetria é intencional e está escrita aqui para
ninguém "harmonizar" as duas depois achando que é inconsistência:

> No reconhecimento, a decisão de fronteira é sobre **um evento**: uma marcação,
> reversível, que na dúvida cai na mesa do RH e pode ser corrigida por lançamento
> novo. No cadastro, a decisão de fronteira é sobre **o template**: grava uma vez
> e passa a valer para toda verificação futura daquela pessoa. Quando o erro é
> reversível, empatar a favor de seguir custa pouco; quando o erro se instala na
> referência, empatar a favor de recusar custa uma recaptura de 30 segundos.

Mesmo raciocínio, sinais opostos, porque o que está em jogo em cada ponta é
diferente. `coerencia_maxima` na resposta de `abrir` (§4.5) é, portanto,
"estritamente abaixo deste número".

- **Teto em 0,45.** É o `limiarAceite` do produto inteiro — **escolhido, não medido**
  (tabela de procedência acima). Três fotos da mesma
  pessoa mediram 0,094, então o teto não aperta ninguém de verdade: quem bate
  nele tem pessoa diferente ou foto ruim. **Recusa, não sinaliza**, mesmo na zona
  cinzenta 0,45–0,58 em que a *marcação diária* registra-e-sinaliza — cadastro é
  o único momento em que exigir amostra limpa é barato, e template sujo envenena
  toda verificação futura (`validacao-biometrica.md` §1.1: enrollment ruim é a
  causa nº 1 de falso negativo crônico). Mensagem: "Estas três fotos não parecem
  ser da mesma pessoa. Tire outras três, de frente, com boa luz."
- **Piso em 0,02.** Mesma pessoa em **pose diferente** mede 0,094; distância
  quase zero nas três combinações significa o mesmo quadro três vezes — arquivo
  duplicado, ou foto impressa/na tela parada diante da câmera. Mensagem: "As três
  fotos são a mesma imagem. Mova um pouco a cabeça entre elas." É proxy pobre de
  liveness, é o único disponível sem modelo no servidor, e está registrado como
  tal.
- Quantidade diferente de 3 vetores, ou vetor que não tenha 128 números finitos →
  `422 VETORES_INVALIDOS`. Hoje qualquer array não vazio passa.

**O limiar tem duas cópias, e elas precisam ser a mesma.** `EFRAT_CFG.limiarAceite`
(`js/config.js:23`) é a cópia do cliente, usada só para dar retorno imediato e
não subir um lote que vai ser recusado. A cópia que **decide** é a constante do
workflow, porque o servidor não lê `config.js`. Teste de contrato afirma que as
duas valem `0,45` (§7, item 14) — divergência silenciosa entre elas é o jeito
mais fácil de perder essa regra sem ninguém notar.

**O cliente continua calculando, e continua recusando antes de enviar.** Isso é
UX, não segurança: evita esperar upload para ouvir "não". A decisão é do servidor,
sempre, mesmo quando o cliente já disse sim.

**Não existe sinal de borda dentro da faixa aceita.** Houve um — `coerencia_no_limite`,
que eu especifiquei primeiro em `0,30` e depois corrigi para `0,34` — e ele **caiu por
medição**, não por opinião. O motivo completo está na tabela de §8, e a versão curta é:
a faixa aceita está **legitimamente ocupada** por variação da mesma pessoa até quase
encostar no limiar, então não existe corte ali que não acenda no caso comum.

A tabela de adornos do `README.md` § Referências medidas — mesma pessoa, com adorno,
contra o template limpo dela mesma — é o dado que ninguém havia usado:

| Variação | Distância | Detectou |
|---|---|---|
| Boné | 0,169 | 5/6 |
| Capuz | 0,253 | 4/6 |
| **Capacete de obra** | **0,257** | 4/6 |
| Óculos escuros | 0,422 | 1/6 |
| Máscara | 0,440 | 1/6 |

Num cliente de engenharia, **capacete é o estado normal de quem bate ponto**. `0,257`
sozinho, mais qualquer outra variação da captura, passa de `0,30` num cadastro
perfeitamente legítimo — e o aviso passaria a acender no caso comum, treinando o RH a
ignorar. Isso degradaria exatamente a conferência humana que este contrato assume como
compensação pela ausência de liveness (§4.3). O risco estava escrito nesta seção como
risco; a medição mostra que ele **é o comportamento esperado**.

**E o número não volta com outro valor.** Se algum dia alguém quiser sinal nessa faixa, a
condição de entrada é **distribuição medida de mesma pessoa na população real** — não
proporção, não meio de vão vazio em cinco pontos de uma pessoa só. É o que a
instrumentação abaixo existe para produzir.

**O que sobrevive, e é o mais útil: persistir o decimal.** A coluna
`efrat_template.coerencia` (§5) guarda a maior distância par a par de todo cadastro. Ela
não alimenta tela nenhuma; alimenta a única coisa capaz de tirar esta discussão do campo
do juízo — depois de N cadastros do piloto existe a distribuição real da população da
Efrat, que hoje não existe e que, sem persistir, nunca vai existir. Com `modelo_id` na
mesma linha (§4.7), ela é agrupável por motor, que é o que torna recalibração possível em
vez de chute.

**A parte da tabela que assusta não é a distância, é a detecção.** Máscara **1/6**,
óculos escuros **1/6**, capacete de obra **4/6**. Isso não é o sistema reconhecer a
pessoa errada — é o detector **não achar rosto nenhum**, e ele acontece *antes* de
qualquer comparação. Duas consequências, e elas são diferentes entre si:

- **Cadastro (é regra deste contrato).** A instrução das 3 fotos exige **rosto
  descoberto, sem óculos escuros e sem máscara** — e a razão que o texto tem de dar é a
  correta: não é "o sistema não vai te reconhecer", é que ele não vai **achar** o rosto.
  Texto do Designer, que explica o mecanismo em vez de só proibir: **"o sistema reconhece
  pelo formato do rosto — se estiver coberto, ele simplesmente não encontra."** Esta regra
  **não depende da medição do capacete**: vale nos três desfechos possíveis dela.
  Erro de detecção falha para o lado seguro (pede nova tentativa), então aqui o custo é
  atrito, não risco.
- **Operação diária (não é regra deste contrato, e é a descoberta mais consequente da
  fase).** Capacete detecta 4/6. Quem bate ponto na portaria de uma obra está de capacete
  **todos os dias** — então uma em cada três tentativas tende a não achar rosto, e a
  pessoa vai para nova tentativa e depois para registro manual. Isso é FTA em campo, todo
  dia, para todo mundo, e **não se resolve no cadastro**: detecção acontece antes da
  comparação, então template com capacete não conserta detecção com capacete.
  **E a saída óbvia está errada.** Eu havia escrito aqui "tirar o capacete para bater
  ponto"; o Designer apontou o que nenhum de nós tinha visto: **pedir para remover ou
  levantar EPI na portaria de uma obra ativa contraria a norma de segurança do canteiro.**
  Qualquer solução que dependa de a pessoa destampar o rosto nasce contrariando a regra do
  local — e perde, porque a regra do local está certa.
  **Hipótese técnica em aberto, e ela muda a solução inteira:** capacete detecta 4/6
  enquanto máscara e óculos escuros ficam em 1/6, e o `README.md` registra que "adorno na
  parte de cima da cabeça não atrapalha". Se o capacete não bloqueia opticamente os olhos,
  o que resta é **sombra da aba sobre a região dos olhos**, dependente do ângulo da
  cabeça — o que explica ser intermitente (4/6) em vez de constante. Se a hipótese se
  confirmar, a solução é **instrução mais altura de instalação do aparelho**, e não
  template com capacete nem múltiplos templates por pessoa.
  Medição pedida ao Biometria, com o motor real, fora do CI: mesmo rosto, mesmo capacete,
  queixo baixo contra queixo reto.
  **Uma observação que a hipótese torna acionável:** `js/face.js:46-68` mede **yaw** e
  reprova por `maxYaw`, mas **não mede pitch** — então a pose exatamente suspeita (queixo
  baixo) não é detectada pelo gate de qualidade hoje. Se a medição confirmar a sombra da
  aba, um proxy de pitch sai dos mesmos 68 landmarks que já estão na mão (deslocamento
  vertical do nariz em relação à linha dos olhos), e é a mudança mais barata capaz de
  transformar a instrução em algo que o app cobra em vez de pedir.
  Texto do Designer para a instrução, que não pede nada de ninguém: **"De capacete? Olhe
  reto pra frente, sem abaixar o queixo."**
  **Status dessa frase: bengala até a medição existir, não solução** — e a formulação é do
  próprio Designer. Ela depende de a pessoa lembrar, e instrução que depende de alguém
  lembrar degrada com o tempo. Se a medição confirmar a sombra da aba, ela vira gate
  (pitch no `avaliar()`) e para de depender de memória; se não confirmar, o problema é
  outro e a frase sai. Em nenhum dos dois cenários ela é o desfecho, e esta seção **não
  está fechada** — está esperando medição.
  A frase de biometria do produto hoje (`js/rh.js`, área de cadastro) lista "boné, óculos
  escuros ou máscara" e **não menciona capacete** — justamente o item que todo mundo usa.
  A parte da distância, por contraste, é folgada: `0,257` contra um limiar de `0,45`
  passa com margem, e passa nos dois sentidos (template limpo × rosto de capacete, ou o
  inverso). O problema é achar o rosto, não medir.

Registrado aqui porque nasceu deste contrato e **não estava em nenhum cartão da fase**;
a decisão de o que fazer com a operação é do Orquestrador com o cliente, não minha.

⚠ **Muda o que existe hoje:** `js/rh.js:508` usa `coer > 0.55` + `confirm()`
("Salvar assim mesmo?"). Fica superado — 0,45 é recusa dura e não existe opção de
seguir. O `confirm` sai. `js/rh.js:520` e `js/fila.js:262` param de mandar
`coerencia`.

### 4.3 Os três caminhos e o estado do template

Todos os três produzem a mesma carga (3 vetores + miniatura + qualidade) e passam
pela mesma regra de §4.2. O que os diferencia é uma coisa só: **havia alguém do
RH olhando a pessoa de carne e osso no momento da captura?**

| Caminho | `origem` | Template nasce | Por quê |
|---|---|---|---|
| Câmera do PC, na tela do colaborador | `rh_camera` | **`ativo`** | Captura ao vivo, pessoa presente, RH supervisionando — é o enrollment que `validacao-biometrica.md` §1.1 exige |
| Link no celular da pessoa | `link` | **`pendente`, sempre** | Captura remota, sem supervisão: quem está do outro lado pode ser outra pessoa |
| Upload de 3 fotos | `rh_upload` | **`pendente`** | Arquivo não tem liveness nenhum e pode ser de qualquer um |

**Submissão por link é sempre pendente de aprovação humana — inclusive quando é o
primeiro cadastro daquela pessoa.** Não existe atalho de "primeiro template ativa
direto porque não havia nenhum".

`Por quê, e é o pior caso do produto:` o ataque não é cadastrar um rosto ruim, é
cadastrar **a própria face no `pessoa_id` de outra pessoa**. Quem consegue isso
passa a bater ponto como a vítima — e a vítima, cujo rosto deixou de casar com o
template, cai em registro manual e vira "problema de biometria" na fila do RH em
vez de vítima de fraude. Um template ativo sem nenhum humano tendo olhado é
exatamente o que permite isso, e é pior no primeiro cadastro do que num
recadastro, porque no recadastro o RH pelo menos tem a miniatura antiga para
comparar. Logo: se veio de fora, um humano olha antes. Sem exceção de primeira
vez.

Consequência que a tela precisa deixar clara para o RH e para a pessoa:
enquanto o template do link está `pendente`, a pessoa **continua sem biometria** —
aparece no indicador "ativos sem biometria" e só pode ser marcada manualmente.
Não é bug, é a fila esperando decisão.

Isso casa com o que `js/rh.js` já faz depois do commit `53136b3`, que entrou nesta
rodada: a fila separa **primeiro cadastro** de **substituição de biometria** e
deriva "primeiro cadastro" de `pessoa.tem_biometria` ser falso — exatamente a
consequência descrita no parágrafo acima. O contrato e a tela estão alinhados, e a
tela já lê `t.origem`, que é o campo que §5 acrescenta ao template.

`pendente` cai na **fila de recadastro que já existe** (`/efrat/rh/dados` →
`recadastros`, decidida em `/efrat/rh/decidir` com `tipo: "template"`), onde o RH
vê a miniatura nova ao lado da atual antes de virar referência. Semântica idêntica
à de `origem: "gestor"` que `api-piloto.md` já descreve. A fila passa a mostrar
`origem` e quem cadastrou, porque "veio de link" e "veio da minha câmera" pedem
desconfianças diferentes de quem decide.

**E o número de coerência sai da tela do RH.** Hoje `js/rh.js:358` imprime
"coerência 0.113" no card. O número continua gravado, entra em relatório e serve para
recalibração — só não aparece mais para o RH.
`Por quê:` é a única coisa neste contrato que o RH vê e sobre a qual não pode fazer
nada. Todo lote com coerência acima de `0,45` é recusado na captura e **nunca chega à
fila**; então, no único lugar em que o número aparece, ele varia dentro de uma faixa
em que a resposta é sempre a mesma. Número que não muda decisão é decoração — e
decoração numérica com nome técnico é o que faz um usuário leigo concluir que não
entende o sistema.
Se o sinal for útil na borda de cima da faixa aceita, ele volta como **frase**, nunca
como decimal: "as três fotos ficaram pouco parecidas entre si". Frase o RH usa — olha
as fotos com mais atenção antes de aprovar. `0.42` não diz nada a ninguém.

Honestidade sobre `rh_upload`: quem aprova o pendente é a mesma pessoa que subiu o
arquivo, então ali o controle é **procedimental** (força a comparação lado a lado),
não técnico. O controle técnico de verdade é inferência no servidor com liveness,
dívida já registrada em `validacao-biometrica.md` §3.

**Caminho 2 e 3 têm rota nova, porque a de hoje está errada:**
`POST /efrat/rh/face/cadastrar`, autenticada como RH.

```json
{ "usuario": "rh", "chave": "…", "idempotency_key": "uuid-v4",
  "pessoa_id": "p-1", "origem": "rh_camera",
  "vetores": [[…128…],[…128…],[…128…]],
  "miniatura": "data:image/jpeg;base64,…",
  "capturado_em": "2026-08-21T14:02:00Z",
  "qualidade": [{ "sharp": 48, "bright": 120, "yaw": 0.05, "rel": 0.42 }, "…", "…"] }
```

Resposta `200`: `{ ok, pessoa_id, template_id, versao, estado: "ativo"|"pendente",
coerencia, request_id }` — `coerencia` é o número que **o servidor** calculou, e é
o único lugar em que ele aparece.

⚠ **Muda o que existe hoje, e conserta um defeito:** `js/rh.js:512` chama
`Api.cadastrar(this._dispositivo.dispositivo_id, this._dispositivo.credencial, …)`
— o painel do RH pega emprestada a credencial do aparelho em que por acaso está
rodando. Isso contraria a regra que `api-piloto.md` abre com ela ("o RH **nunca**
precisa do token de um aparelho") e, num PC de RH que nunca se cadastrou como
aparelho, `_dispositivo` é `null`: o cadastro de face pela câmera do PC **não
funciona hoje** — e a câmera do PC é justamente uma das três funcionalidades que o
cliente pediu. Com a rota nova, o painel do RH deixa de tocar `/efrat/cadastro`,
que continua existindo apenas para o caminho do **aparelho** em campo (gestor
cadastrando, `origem: "gestor"`, template `pendente` como já é).

**Prioridade (decisão do Orquestrador):** esta rota entra junto com T-D30529, não
depois. Sem ela, dois dos três caminhos de cadastro de face não têm por onde
gravar — o caminho do link tem rota própria, mas câmera e upload dependem desta.

Regras do caminho 3 (upload), de cliente e não de rota:

- aceita `image/jpeg`, `image/png`, `image/webp`; até 12 MB por arquivo;
- reduz a maior aresta para 1280 px antes da inferência (foto de 12 MP não deixa
  o descritor melhor e deixa a máquina do RH travada);
- HEIC é recusado com frase útil: "Este formato de foto (HEIC) o navegador não
  abre. No iPhone, mande como JPEG.";
- o arquivo em si **não sai do navegador**.

### 4.4 Máquina de estados do convite (o link de uso único)

```
                          POST /efrat/rh/face/convite
                                    │
                                    ▼
                              ┌──────────┐
                              │ emitido  │
                              └──────────┘
                                    │  1ª abertura  (não consome, não encurta nada)
                                    ▼
                              ┌──────────┐
                    ┌─────────│  aberto  │─────────┐   reabrir quantas vezes precisar
                    │         └──────────┘         │
    envio válido    │          │       ▲───────────┘
    (lote de 3      │          │       │
     completo)      │          │       └── envio recusado (§4.2): segue aberto, tentativas++
                    ▼          │
              ┌────────────┐   └── 5ª recusa ──▶ ┌───────────┐
              │ consumido  │                     │ bloqueado │ (terminal; RH reemite)
              └────────────┘                     └───────────┘
                (terminal)

  De `emitido` OU de `aberto`, três saídas terminais:
      expira_em (60 min da emissão) ──▶ expirado
      RH revoga                     ──▶ revogado
      RH reemite                    ──▶ substituido   (+ nasce um `emitido` novo)

  Um convite vivo por pessoa, no máximo.
```

**O link queima na conclusão do lote, não na abertura.** Abrir não consome. Nem a
primeira abertura, nem a décima. O que consome é **um `enviar` bem-sucedido**, com
os três vetores dentro da faixa de §4.2.

`Por quê, e é ajuste do QA:` quem perde conexão entre a 2ª e a 3ª foto não pode
ficar sem caminho. Se abrir queimasse, cada oscilação de sinal viraria um pedido
de link novo — e o RH, atendendo o quinto pedido do dia, aprende a reemitir por
qualquer motivo. Aí o uso único morre na prática, mesmo continuando escrito no
documento. Uso único que só é uso único no papel é pior que nenhum, porque dá
falsa segurança.

Três corolários, todos deliberados:

- **Recarregar a página não gasta o link.** As três capturas vivem em memória da
  página; perder a página perde as capturas, não o convite. A pessoa reabre e
  começa de novo.
- **Envio recusado por coerência não gasta o link.** Recusa é retorno, não
  consumo. Conta uma tentativa, e são 5 antes de `bloqueado`.
- **Envio repetido com a mesma `Idempotency-Key` repete a resposta gravada**, não
  consome de novo. Envio novo depois do consumo → `409 CONVITE_CONSUMIDO`, com
  frase de gente: "Já recebemos suas fotos. O RH vai conferir." Erro no protocolo,
  não na cara da pessoa.

**Um relógio só: 60 minutos da emissão.** Não existe janela separada contada da
abertura.
`Por quê:` 60 min cobre o caso real (o RH está ao telefone com a pessoa, ou ela
está no corredor) e é curto o bastante para o link não virar item eterno no
histórico do WhatsApp. Uma segunda janela, contada da abertura, era o mecanismo
que estrangulava justamente quem tem sinal ruim — o mesmo problema do parágrafo
acima, por outro caminho. E o pior caso de um link aberto num celular esquecido
destravado é bem menor do que parece: a página não mostra nada além de um primeiro
nome, e o que ela consegue produzir é um template que **sempre** nasce `pendente`
(§4.3), ou seja, um humano olha antes de valer.

**Onde o token vive.**

- Valor aleatório de **256 bits**, base64url (43 caracteres), CSPRNG do servidor.
  Não é derivado de `pessoa_id` nem de nada.
- No servidor mora **só o hash** (`sha256`, base64url) em
  `efrat_face_convite.token_hash`. O valor claro aparece **uma única vez**, na
  resposta da emissão, para o RH conseguir enviar o link. **Nenhuma rota de
  leitura devolve token** — mesma regra do `codigo_curto` (§1.1).
- Na URL ele viaja no **fragmento**: `https://face.<domínio>/#c=<token>`.
  `Por quê fragmento e não path/query:` fragmento não vai na requisição HTTP. O
  host estático nunca vê o token em log de acesso, nenhum intermediário o registra,
  e ele não entra em `Referer`. Como todo o consumo é `POST` para o n8n com o token
  em header, o host estático não precisa dele em momento nenhum — então não deve
  recebê-lo.
- Ao carregar, a página lê `location.hash`, chama
  `history.replaceState(null, '', location.pathname)` **antes de qualquer await**,
  e mantém o token em variável local em memória. Nunca em `localStorage`,
  `sessionStorage`, IndexedDB, cookie, ou atributo do DOM.

**Como a página pública autentica sem credencial de aparelho.** O token é a
credencial, e vale em **duas rotas e mais nenhuma**, como
`Authorization: Bearer <token>`. Não é credencial de aparelho (não abre `carga`,
`identificar`, `marcacoes`), não é credencial de RH (não abre nada em
`/efrat/rh/*`), não é sessão de gestor. Nenhuma rota que o aceite devolve lista de
pessoas, equipes, marcações, ou qualquer coisa além do que §4.5 descreve. O caminho
da página pública para o painel do RH não é *difícil*: ele **não existe** — nem em
credencial, nem em código, nem em origem (§4.6).

Erro único para token inválido, expirado, revogado, substituído ou bloqueado:
`404 CONVITE_INVALIDO`, "Este link não vale mais. Peça um novo ao RH."
`Por quê o erro único:` distinguir os casos transforma a rota em oráculo. A única
exceção é `consumido`, que `abrir` devolve como estado (`200`), para a pessoa que
recarregou depois de terminar ver "já recebemos" em vez de um erro — e essa
distinção não vaza nada, porque só é alcançável por quem já tem o token.

**Limites, e a chave deles importa mais que o número.** Achado do DevOps: a versão
anterior desta linha cravava rate limit em `convite/abrir` **por IP**, e IP é a chave
errada para esta população.

`Por quê IP não serve aqui:` o colaborador abre o link em dados móveis, a operadora
faz NAT em escala, e uma turma no mesmo canteiro compartilha um punhado de endereços.
Com limite apertado por IP, **eles se trancam mutuamente** — o colaborador lê "tente
mais tarde", não entende, e liga para o RH. Ou seja: o limite produziria exatamente o
volume de ligação que esta fase existe para desafogar. E o próprio contrato entrega o
argumento de que ele não precisa ser apertado: com 256 bits, adivinhar é impossível, o
limite é contra **volume**, não contra sorte — logo não precisa morar na rota nem ser
severo.

**Sem proxy, os dois limites vivem na rota** — e é isto que a resposta do cliente
mudou. O DevOps já havia avisado que "nenhum proxy" muda a recomendação, porque a camada
da rota passa a carregar **também** o custo de execução da instância. Duas chaves, dois
códigos, e **não se unificam num contador só**:

| Limite | Chave | Limiar | Código |
|---|---|---|---|
| Regra de produto | **o convite** (o token já vem em `Authorization`) | 5 envios recusados → `bloqueado`; aberturas não limitadas | `CONVITE_BLOQUEADO` |
| Guarda de volume e custo | **IP** | generoso, ordem de **centenas por minuto** | `LIMITE_VOLUME` + `Retry-After` |

`Por quê o limite por IP volta, depois de eu o ter tirado:` o problema do NAT era o
limite **apertado** por IP, que tranca uma turma no mesmo canteiro. Limiar generoso não
alcança usuário legítimo — e, sem proxy, passa a ser a única coisa protegendo a
instância de queimar execução. O que eu tirei foi o aperto, não o teto.

`Por quê chaves e códigos distintos:` a propriedade que precisa sobreviver é cada `429`
ter causa única e legível. Com um contador só, o suporte não sabe qual regra disparou e
o número na tela não corresponde a nada que alguém escreveu. Com dois: veio do convite,
é aquele link; veio do volume, é a instância se protegendo.

`LIMITE_CONVITE` sai do catálogo da rota: a rota não limita abertura.

**Alternativa condicionada, pré-aprovada — se não houver proxy capaz de limitar.** A
guarda de volume acima pressupõe infraestrutura na frente do n8n. Gatilho explícito:
*se a resposta do cliente for que não existe proxy, ou que o proxy não faz rate
limit*, a guarda de volume passa para a rota, chaveada no **`pessoa_id` do convite** —
nunca em IP — com limiar generoso.
`Por quê `pessoa_id` e não IP:` é a chave que não sofre NAT de operadora, então uma
turma no mesmo canteiro não se tranca mutuamente; e mantém a propriedade que motivou
as chaves distintas, porque cada `429` continua tendo causa única e legível (aquela
pessoa, aquele convite). Está escrito aqui, e não guardado para quando a resposta
chegar, porque **alternativa que existe só na cabeça de alguém é alternativa que se
perde.**

**Uso único com Data Table, honestamente.** O consumo é um compare-and-set
`aberto → consumido` que, sem índice único nem transação, é leitura-e-escrita e
pode correr. Mitigações: `Idempotency-Key` obrigatório no envio e dano limitado
por construção — dois consumos do mesmo link são da mesma pessoa, produzem dois
templates que **ambos** nascem `pendente`, e o RH vê os dois. Registrado como
limite conhecido, na mesma linha do que `api-piloto.md` já admite sobre
deduplicação de marcação.

### 4.5 Rotas do convite

**Emissão** — `POST /efrat/rh/face/convite`

```json
{ "usuario": "rh", "chave": "…", "idempotency_key": "uuid-v4",
  "pessoa_id": "p-1", "canal": "whatsapp" }
```

`canal` ∈ `whatsapp` | `sms` | `copiar` — registro de intenção para auditoria, não
instrução de envio. Três recusas:

| Situação | Resposta |
|---|---|
| pessoa sem telefone válido | `422 PESSOA_SEM_TELEFONE` — é aqui que a obrigatoriedade de §3.1 cobra a conta |
| pessoa inativa | `422 PESSOA_INATIVA` |
| **telefone compartilhado com outra pessoa ativa** | `422 TELEFONE_COMPARTILHADO_SEM_LINK` |

A terceira é a consequência da exceção autorizada de §3.1, e a mensagem tem de
apontar a saída, não só a parede: "Este celular é de mais de uma pessoa, então o
link não pode ser enviado — não há como saber quem vai abrir. Cadastre o rosto
aqui, pela câmera, ou envie três fotos." A condição é **derivada** (§3.1), então
resolver o telefone da outra pessoa libera o link sozinho, sem passo extra.

Resposta `201`:

```json
{ "ok": true, "convite_id": "cv-8f…",
  "url": "https://face.exemplo.com.br/#c=<token>",
  "expira_em": "2026-08-21T12:40:00Z",
  "telefone_mascarado": "(67) 9****-5432",
  "substituiu": "cv-2a…",
  "request_id": "…" }
```

`substituiu` vem quando havia convite vivo, para a tela poder dizer "o link
anterior deixou de valer". O host da `url` é constante do workflow — a origem
pública de §4.6.

**A entrega é fora de banda, e o servidor não manda mensagem nesta rodada.** O
painel oferece "Abrir no WhatsApp" (`https://wa.me/<E164>?text=…`, montado no
cliente com o E.164 de §3.1) e "Copiar link".
`Por quê:` gateway de WhatsApp/SMS exige credencial e custo que o piloto não tem,
e app estático sem build não tem onde guardar credencial de gateway sem publicá-la
(§ Restrição, item 1). Nota para o DevOps: `wa.me` é **navegação**, não `fetch` —
`connect-src` e `form-action` não se aplicam, e a CSP atual não bloqueia link para
outra origem. Nada a mudar na CSP por causa disso.

**Listagem** — `POST /efrat/rh/face/convites` → `{ convites: [{ convite_id,
pessoa_id, estado, criado_em, criado_por, expira_em, aberto_em, tentativas }] }`.
**Sem token, sem URL, nunca.**

**Revogação** — `POST /efrat/rh/face/convite/revogar`
`{ usuario, chave, idempotency_key, convite_id, motivo? }` → terminal `revogado`.
Idempotente.

**Abertura (página pública)** — `POST /efrat/face/convite/abrir`,
`Authorization: Bearer <token>`, corpo `{}`.

```json
{ "ok": true, "estado": "aberto", "primeiro_nome": "Ana",
  "fotos_exigidas": 3, "coerencia_maxima": 0.45,
  "expira_em": "2026-08-21T12:40:00Z", "request_id": "…" }
```

**Só o primeiro nome.** Sem matrícula, sem equipe, sem telefone, sem sobrenome,
sem miniatura atual, sem `pessoa_id`.
`Por quê o primeiro nome apesar de tudo:` a pessoa precisa saber que o link é dela
antes de mostrar o rosto, e primeiro nome é o mínimo que consegue isso. O custo,
explícito: link vazado revela um primeiro nome. É o menor preço que compra a
confirmação, e a alternativa (nenhum nome) produz uma página que pede biometria
sem dizer para quem — pior para um usuário leigo e pior para a confiança no
produto. `pessoa_id` fica de fora porque a página não precisa dele: o servidor
resolve a pessoa pelo token.

`coerencia_maxima` vem na resposta para a página poder dar retorno antes de subir
— é o valor que **o servidor** vai aplicar, não um limiar que a página escolhe
(§4.2). Primeira abertura grava `aberto_em`; aberturas seguintes não regravam e
não encurtam nada. Convite já consumido responde `200` com
`{ estado: "consumido" }` e sem `primeiro_nome`.

**Envio (página pública)** — `POST /efrat/face/convite/enviar`,
`Authorization: Bearer <token>`, `Idempotency-Key` obrigatório.

```json
{ "vetores": [[…128…],[…128…],[…128…]],
  "miniatura": "data:image/jpeg;base64,…",
  "capturado_em": "2026-08-21T11:50:00Z",
  "qualidade": [{ "sharp": 44, "bright": 118, "yaw": 0.04, "rel": 0.38 }, "…", "…"] }
```

Sem `coerencia` e sem `pessoa_id` — o servidor calcula o primeiro (§4.2) e resolve
o segundo pelo token. Resposta `200`:
`{ ok, estado: "recebido", template_estado: "pendente", coerencia: 0.113,
request_id }`. Sem `template_id`: a página não tem o que fazer com ele.

A página mostra então uma tela final que **não volta para nada**: "Recebemos suas
fotos. O RH vai conferir. Você já pode fechar esta página." Sem link para o app,
sem botão de "ir para o ponto".
`Por quê:` link do app na página pública é justamente o caminho que §4.6 existe
para não ter — e agora nem seria um link interno, seria um link para outra origem.

### 4.6 A página pública vive em origem própria

**Decisão: subdomínio. `face.<domínio>`, separado da origem do app.** Não é
preferência de organização, e "página separada no mesmo domínio" — que era o
desenho anterior deste contrato — **não era separação nenhuma**. Três mecanismos
concretos, todos verificáveis no código de hoje:

1. **O service worker é de raiz e intercepta todo GET de mesma origem.**
   `sw.js:57-60`: o handler de `fetch` só devolve cedo quando
   `url.origin !== location.origin`. Qualquer caminho novo no mesmo domínio passa
   por ele, entra em cache sozinho quando responde `ok` (`sw.js:63`), e vira link
   público que ninguém consegue revogar.
2. **O fallback offline é o shell do app do operador.** `sw.js:65`:
   `.catch(() => caches.match('./index.html'))`. Sem rede, a página pública
   devolveria **o app do ponto** no celular do colaborador. Não é bug de
   apresentação: é a tela de administração do produto aparecendo onde deveria
   haver uma página de cadastro de face.
3. **A credencial de 256 bits do aparelho mora no IndexedDB, e IndexedDB isola por
   origem — não por caminho.** `js/store.js:10`: base `efrat-ponto`, na origem do
   app. No arranjo antigo, um XSS na página pública deixava de vazar um cadastro
   e passava a vazar **a credencial do aparelho** e a galeria de 128d das equipes
   no escopo dele. A diferença entre os dois danos é a diferença entre um
   incidente e o produto inteiro.

Com origem própria, os três desaparecem por construção, e o primeiro deles vira
aliado: `sw.js:60` já devolve cedo para outra origem, então o service worker do
app **nunca** vê requisição da página pública. Sem alteração no `sw.js`.

**A página pública é, para todos os efeitos, um cliente cross-origin.** É assim
que o contrato a trata:

**a. Chamada de API é cross-origin, e isso já é a norma.** A API é n8n, em
`https://n8n.samasc.com.br` — outra origem tanto para o app quanto para a página.
Nada muda de natureza; muda apenas o `Origin` que chega. As duas rotas de §4.5
precisam de CORS:

```
Access-Control-Allow-Origin: https://face.<domínio>     (lista, não `*`)
Access-Control-Allow-Headers: Authorization, Content-Type, Idempotency-Key
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Max-Age: 600
```

Sem `Allow-Credentials`: o token é header, nunca cookie, então não há sessão
ambiente para CSRF explorar. Lista em vez de `*` porque é barato e impede que uma
página qualquer conduza a rota pelo navegador de terceiro para sondar limite —
mesmo sem token, isso é ruído que não precisa existir. A lista inclui as origens
de teste (`http://127.0.0.1:<porta>`), senão o e2e não roda.

**b. Assets e modelos são da própria origem pública.** A página **não busca nada**
da origem do app: não `js/`, não `vendor/`, não `models/`, não `css/`. Tudo o que
ela carrega vem do host dela. Isso não é só higiene: asset cross-origin exigiria
CORS na origem do app e faria o cadastro de face depender do app estar no ar.
A única coisa que a página busca fora da própria origem é a API.

**c. Nenhum service worker.** A página não registra service worker, e nenhum
service worker a serve. Consequência aceita e correta: a página **não funciona
offline** — cadastro precisa do servidor de todo modo. Nada de `manifest.json`,
nada de instalação: não é PWA, é uma página.

**d. Configuração própria e mínima.** `config-face.js` define apenas o que a
página usa: `apiBase`, `limiarAceite` (cópia de retorno rápido, §4.2), e os
limiares de qualidade de captura (`minFace`, `minSharp`, `minBright`, `maxBright`,
`maxYaw`, `inputSize`, `autoCapturaCiclos`). **Não** carrega `limiarCinza`,
`limiarPresenca`, `alarmeManual`, `chartCdn`, `loteMax`, `syncIntervalMs` — a
página pública não precisa nem deve conhecer a calibragem operacional do RH.

**Fecho da página — é isto, e nada mais:**

```
(origem pública)  https://face.<domínio>/
  index.html
    ├ vendor/face-api.js         (script clássico, auto-hospedado nesta origem)
    ├ js/config-face.js          (subconjunto, item d)
    └ js/pagina.js
        ├ js/api-face.js         (só `abrir` e `enviar` de §4.5)
        ├ js/face.js             (motor: câmera, qualidade, descritor)
        ├ js/regras.js           (euclidiana)
        └ js/ui.js               ← apenas { $, esc, toast }
    e models/*.json + models/*.bin, servidos por esta origem
```

**Proibido no fecho, verificado por CI:**

- importar `js/store.js`, `js/api.js`, `js/rh.js`, `js/app.js`, `js/fila.js`,
  `js/gestor.js`, `js/cripto.js`;
- importar `mostrar` de `js/ui.js`. `Por quê nomeadamente:` `mostrar()`
  (`js/ui.js:16`) alterna as telas do app **e** a visibilidade de `#btnAcessar`, o
  botão de entrada do RH. É literalmente a função que aponta para a porta do
  painel. Que ela quebrasse por falta de elemento não é garantia — é acidente;
- os identificadores `indexedDB`, `localStorage`, `sessionStorage`,
  `document.cookie`, `navigator.serviceWorker`, `caches` em qualquer arquivo do
  fecho. Hoje `face.js`, `regras.js` e `ui.js` estão limpos disso; a guarda existe
  para continuar;
- qualquer referência a `sw.js`, `manifest.json`, `index.html` do app, ou a
  qualquer URL absoluta da origem do app.

**Cabeçalhos da origem pública** (arquivo próprio, não o `_headers` do app):

```
Content-Security-Policy: default-src 'none'; script-src 'self';
  style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;
  media-src 'self' blob:; font-src 'self';
  connect-src 'self' https://n8n.samasc.com.br;
  base-uri 'none'; form-action 'none'; frame-ancestors 'none';
  worker-src 'none'; manifest-src 'none'
Permissions-Policy: camera=(self)
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Cache-Control: no-store            (só o HTML; models/ e vendor/ ficam immutable)
```

Duas notas para o DevOps: `connect-src` **precisa** de `'self'` porque o
face-api busca os pesos de `models/` por `fetch`; e `Referrer-Policy: no-referrer`
é mais estrito que o do app de propósito — a página pública não tem para quem
vazar referenciador. Se os modelos não carregarem com `worker-src 'none'`,
afrouxe para `'self'` e registre o motivo; o resto da política não se toca.

**Como isso se implementa: projeto Vercel separado.** Decisão do Orquestrador,
tomada depois de uma primeira recomendação minha que estava errada — e o erro vale
escrito, porque é o argumento que sustenta o mecanismo.

Eu havia recomendado **um projeto com regra por host** (`vercel.json`,
`has: [{ type: "host" }]`), argumentando que a propriedade de segurança não
dependia da escolha: isolamento de `IndexedDB`, escopo de service worker e
política de mesma origem são todos por **origem**, então uma regra de rota furada
apenas exporia arquivos, e o `index.html` do app no host público abriria um
IndexedDB **vazio**, sem credencial.

O argumento está certo quanto ao armazenamento e **incompleto quanto ao resto**.
`js/app.js:324`:

```js
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
```

Sem condição nenhuma, no boot. Se o shell do app for **alcançável** no host
público, carregá-lo **registra o service worker de raiz do app naquela origem** —
com o precache dele e com o fallback `caches.match('./index.html')`. Ou seja: uma
regra de rota furada não expõe só arquivos, ela deixa o bootstrap do app
**instalar, na origem pública, exatamente o mecanismo que esta mudança inteira
existe para tirar de lá.** Isso deixa de ser arrumação e volta a ser a falha.

Logo: **isolar por ausência do arquivo, não por regra de roteamento.** Projeto
Vercel próprio, mesmo repositório, servindo apenas o fecho público — o
`index.html` do app simplesmente não existe naquele deploy, então não há o que
uma regra errada possa expor nem o que possa registrar service worker.

Os assets vêm por **cópia em tempo de build do projeto público**, com **fonte de
verdade única**: `models/` e `vendor/face-api.js` continuam vivendo uma única vez
no repositório, na árvore do app, e o build do projeto público os copia. Não
contraria a restrição "sem build" da abertura deste documento: a restrição é sobre
o **app** — nada de bundler, transpilação ou `process.env`, e o que é servido
continua sendo arquivo estático puro. Copiar arquivo não é compilar. E resolve a
deriva que a duplicação em `git` traria: existe uma cópia para auditar, e a outra
é derivada dela a cada deploy.

**Como se testa isso sem DNS** — e isto vale qualquer que seja o mecanismo.
`tests/e2e/servidor-falso.js` passa a subir um
**segundo listener, em outra porta**, servindo somente o fecho público. Porta
diferente é origem diferente para o navegador — é exatamente o isolamento de
produção, reproduzido localmente. Com isso o e2e consegue afirmar, e não supor:
que a página pública não vê o IndexedDB do app, que o service worker do app não a
intercepta, e que ela funciona sem nada da origem do app no ar.

### 4.7 Procedência do template: qual modelo gerou cada vetor

**Requisito do Orquestrador, e ele sobe de dívida para critério de aceite:** cada
template grava a identidade do modelo que o gerou, junto da procedência que §4.3 já
combinou (`origem`, autor, instante).

O motivo é o modo de falha, não a auditoria por si. Um template é um vetor de 128
números **amarrado ao modelo que o produziu**. Se os pesos divergirem entre a
origem pública e a do app, todo template cadastrado pela página pública fica
sutilmente incompatível com o reconhecimento — **não quebra, degrada, e degrada
calado**, na direção exata que esta fase existe para evitar. E note que a conferência
de tamanho de §4.2 (128 números finitos) não pega isso: modelo que muda de
dimensionalidade é detectado ali; modelo que continua em 128 dimensões e muda o
espaço de embedding passa inteiro.

Duas perguntas que isso torna respondíveis, e hoje não são:

1. **"Quais templates foram gerados com que modelo?"** — para poder responder no dia
   em que a guarda falhar, em vez de descobrir por gestor relatando que o
   reconhecimento piorou.
2. **Recalibração.** `validacao-biometrica.md:85` avisa que o limiar tem de ser
   calibrado com dados da própria população da Efrat. Recalibrar sem saber com que
   modelo cada template foi gerado é chute com aparência de número.

**`modelo_id` não é o `versao` que já existe.** `versao` é contador de template por
pessoa (`versao: 1`, `2`, `3` conforme recadastra). `modelo_id` identifica o motor.
São eixos independentes: a mesma pessoa pode ter `versao: 3` com `modelo_id` novo, e
duas pessoas diferentes têm `versao: 1` com o mesmo `modelo_id`. Nomes distintos de
propósito.

**Como o `modelo_id` é formado — hash no navegador, não manifesto de build.** Esta
parte mudou depois de o DevOps e o Biometria apontarem que um manifesto gerado no build
**não consegue** descrever os bytes servidos: existem pelo menos quatro camadas capazes
de divergir um do outro (cache do service worker servindo primeiro, `Cache-Control:
immutable` sem hash na URL, cópia de build da origem pública desatualizada, e cache de
borda do CDN). Manifesto de build é, portanto, a própria armadilha que §4.7 existe para
fechar — declararia o id certo sobre bytes errados.

> `modelo_id` = SHA-256 sobre os bytes dos **7 arquivos do pipeline**, concatenados em
> ordem fixa: os 3 `*_model.bin`, os 3 `*-weights_manifest.json` e
> `vendor/face-api.js`. Calculado **no navegador**, na carga da página.

Os 7, e não só os pesos, porque **versão de biblioteca diferente sobre os mesmos pesos
pode produzir vetor diferente** — o motor é parte do pipeline tanto quanto o peso.

**Como o hash alcança os bytes que o motor usou.** `js/face.js:109-111` usa
`loadFromUri()`, então o próprio face-api busca os arquivos e o `ArrayBuffer` não fica na
mão de ninguém. Duas saídas foram consideradas, e a escolhida é a primeira:

- **Escolhida — `fetch` próprio dos mesmos 7 arquivos, logo após `loadFromUri`, só para
  hashear.** O `fetch` **não** pode ignorar cache (nada de `no-store`): tem de acertar o
  mesmo cache que o face-api acabou de popular, senão hasheia um deploy mais novo do que
  o que o motor carregou — o inverso do que se quer. Janela teórica: o cache ser
  despejado entre o carregamento do face-api e o hash, na mesma carga de página.
- **Recusada — trocar o loader, buscando os buffers e entregando-os ao face-api.**
  Garantia sem janela nenhuma, e custo alto: exige a API de baixo nível do face-api/tfjs
  e passa a acoplar o nosso código ao caminho interno de carga da biblioteca.

`Por quê a janela de milissegundos é aceitável, e por quê não vale trocar o loader:`
duas razões, e a segunda é a decisiva.
Primeira: o `modelo_id` é **procedência declarada pelo cliente** (o parágrafo abaixo), e
o cliente poderia mentir sobre o hash inteiro. Fechar uma janela de milissegundos dentro
de um mecanismo que já não é prova é comprar precisão na dimensão errada — a incerteza
dominante é "quem afirma", não "os bytes mudaram entre dois `fetch` da mesma carga".
Segunda: trocar o loader coloca código nosso no caminho de carga do motor. Se ele
quebrar num bump de biblioteca, o que quebra é **o reconhecimento**, não o carimbo. É
péssima troca arriscar a função primária para endurecer um sinal secundário e
consultivo.
E o modo de falha da escolhida é benigno no sentido exato que importa: ela carimba uma
versão **real**, que estava sendo servida um instante antes — nunca lixo, nunca um id
inventado. A divergência que ela poderia perder é entre dois deploys adjacentes durante
os segundos de um rollout; a divergência que o carimbo existe para pegar — origem pública
um deploy atrás por horas ou dias — é pega igual pelas duas.

**Se algum dos 7 `fetch` falhar, não se fabrica id.** O cliente envia sem `modelo_id`, e
o servidor grava marcando `modelo_desconhecido: true` (comportamento que já está na
tabela abaixo). Melhor um "não sei" registrado do que um id que ninguém pode explicar.

**De onde vem a referência.** Não de infraestrutura: por **observação**. `efrat_modelo`
registra cada `modelo_id` visto, com primeira e última aparição e de qual caminho veio; a
**referência** é o `modelo_id` mais recente observado no caminho do **app** — que é o
motor que de fato reconhece. Para isso o app reporta seu `modelo_id` em `/efrat/carga`,
uma vez por sincronismo, e é o dado mais barato desta seção. Divergência é, então,
submissão de `link` cujo `modelo_id` difere da referência corrente. Tudo observado, nada
declarado por build.

**A armadilha, e é a mesma de §4.2.** O cliente lê o manifesto e manda `modelo_id`
no corpo — ou seja, **é o cliente declarando algo sobre si mesmo**, exatamente o
padrão que este contrato acabou de remover da coerência. Aceito aqui, e a diferença
precisa estar escrita para não parecer incoerência:

> Na coerência, o número declarado era **a decisão**: o servidor gravava ou recusava
> com base nele, e mentir mudava o resultado. Aqui o `modelo_id` é **procedência**,
> não decisão: mentir não faz o servidor aceitar nada que ele recusaria, e quem quer
> plantar um template ruim adultera o vetor, que é mais fácil e mais eficaz.
> Declaração é aceitável quando ninguém ganha nada mentindo — e insuficiente quando
> alguém ganha.

Ainda assim, o servidor não fica de mãos vazias, porque **ele sabe de que origem a
requisição veio** (a rota diz: `/efrat/face/convite/enviar` é a página pública,
`/efrat/rh/face/cadastrar` é o painel) e tem o manifesto de cada origem registrado
em `efrat_modelo`. Com isso ele confere, e o resultado da conferência é o que a fila
mostra:

| Situação | O que o servidor faz |
|---|---|
| `modelo_id` igual ao de **referência** (o que o caminho de reconhecimento usa) | grava normalmente |
| `modelo_id` conhecido mas **diferente** da referência | **grava** e marca `modelo_divergente: true` |
| `modelo_id` desconhecido, ou ausente em `/efrat/cadastro` (rota antiga) | **grava** e marca `modelo_desconhecido: true` |
| ausente nas duas rotas novas | `400 MODELO_AUSENTE` |

**Nunca recusa por divergência de modelo.** Recusar puniria o colaborador por um
problema de deploy que ele não pode resolver, no meio de um cadastro de rosto — e o
template do link nasce `pendente` de todo jeito, então há um humano no caminho. O que
o contrato exige é que a divergência **apareça antes da decisão**, não depois.

**Texto, fechado com o Designer.** Reusa o bloco de aviso que o card já tem (o
"via link do celular"), mesma posição, antes da conferência e do botão Aprovar, e
**sem gate novo**:

> "Este cadastro foi feito com uma versão diferente do reconhecimento facial.
> Aprovando, o rosto dela pode não ser reconhecido depois — se acontecer, basta
> recadastrar de novo."

Três coisas que esse texto acerta e que valem escritas, porque uma reescrita futura
pode perder qualquer uma delas: nomeia o problema **sem** "modelo" ou "versão do
sistema" (o RH não precisa saber que existe um modelo, só que aquela peça está fora
do padrão); diz a consequência **concreta** — "não ser reconhecido" é vocabulário
que o RH já vê nas pendências, não conceito novo; e fecha com a **saída**, que
existe e é barata, para não soar como problema grave ou culpa de alguém.

Nada de gate adicional, e a razão é boa: a conferência que `53136b3` já exige é
**confirmação de identidade** ("é a pessoa certa"), e isto é **informação para a
decisão**. São eixos diferentes; somar mais um checkbox treinaria o RH a clicar em
checkbox, que é justamente o que a fila separada existe para evitar.

Avisos coincidentes **empilham, não fundem**: um cadastro que veio por link *e* tem
divergência de modelo mostra os dois blocos, um embaixo do outro. Cada um cobre um
risco diferente — quem capturou versus com que motor — e texto fundido esconderia
um dos dois.

**A fila não recebe o decimal, e não recebe nada no lugar dele.** Os itens de
`recadastros`, em `/efrat/rh/dados`, **não** carregam `coerencia` — nem o decimal, nem
booleano derivado dele (§4.2: o sinal de borda caiu). O número continua gravado e continua
na resposta das rotas de escrita, para log, teste e recalibração; só não trafega para onde
a tela poderia renderizá-lo. Os avisos que o card mostra são dois: procedência e modelo
divergente.

**E a remoção acontece na serialização da leitura, não na gravação.** O registro guarda
`coerencia`; quem monta a resposta de `/efrat/rh/dados` omite o campo. Achado do Biometria
ao implementar: no servidor de teste, `estado.recadastros` é devolvido **verbatim** por
`/rh/dados`, então hoje o decimal viaja. As duas saídas possíveis não são equivalentes:

- deixar de **gravar** o campo satisfaria a regra e destruiria a instrumentação de §4.2,
  que é a única coisa capaz de produzir a distribuição real da população;
- **omitir na serialização** preserva as duas coisas, e é o que uma tabela de verdade com
  uma *view* faria: a coluna existe, a leitura do RH não a expõe.

`Por quê isso não é detalhe de implementação:` se o campo deixar de ser gravado, o teste
do critério 14 passa **por vacuidade** — ele semeia um recadastro com `coerencia`
preenchida justamente para haver algo a ser removido. Sem nada para remover, o verde não
afirma nada. É o mesmo defeito de "passar por lista vazia" que esta rodada passou caçando,
uma camada abaixo.

`Por quê isso é melhor do que a guarda que eu tinha proposto:` na dívida anterior eu
sugeri uma guarda comparando periodicamente a versão publicada nas duas origens. Ela
resolve o futuro e não resolve o passado — e, pior, só dispara quando alguém roda a
comparação. A conferência acima dispara **no primeiro cadastro real feito com o peso
errado**, com nome, pessoa e instante, e o histórico fica gravado para trás.

Exigência de C2 aplicada: `modelo_id` é obrigatório nas rotas novas
(`/efrat/rh/face/cadastrar`, `/efrat/face/convite/enviar`) e tolerado ausente na
rota antiga `/efrat/cadastro`, para não quebrar o cadastro pelo gestor em campo antes
de o cliente ser atualizado.

---

### 4.8 A superfície anônima, e o que ela exige por não haver proxy

O cliente confirmou que **não há proxy: o n8n responde direto na internet**. Isso não
muda nenhuma decisão deste contrato, e acrescenta três exigências — porque a fase está
acrescentando a primeira superfície pública apontada para o n8n, e o teto de volume
passou a viver **dentro** da coisa que ele protege (§4.4).

As rotas alcançáveis **sem nenhuma credencial prévia** são exatamente três, e é uma lista
fechada:

1. `POST /efrat/dispositivo/registrar` — anônima por definição (primeiro contato);
2. `POST /efrat/face/convite/abrir` — qualquer um pode chamar; o token é o que separa;
3. `POST /efrat/face/convite/enviar` — idem.

Exigências, todas por não existir camada anterior:

- **Ordem de execução é contrato, não detalhe.** Nas três, a checagem de volume (§4.4) e
  a validação de formato do corpo vêm **antes** de qualquer leitura de Data Table. Um
  limitador que consulta o banco para descobrir que deve recusar já pagou o custo que
  estava tentando evitar.
- **Teto de corpo.** As três recusam corpo acima do tamanho esperado, com `413`:
  `registrar` é kilobytes (`apelido` ≤ 60 caracteres, `ua` ≤ 300, `geo` numérico);
  `enviar` é o único grande, e tem teto explícito — `miniatura` ≤ 64 KB (folgado para um
  JPEG 128×128) e exatamente 3 vetores de 128 números, o que já limita o resto. Sem WAF
  na frente, um corpo de dezenas de megabytes é execução queimada só em desserializar.
- **Nada de eco.** Nenhuma das três devolve no corpo de erro qualquer parte do que
  recebeu. Eco é amplificação barata.

**O que isso não resolve, e é informação para o cliente, não decisão nossa:** sem camada
independente, o limitador compartilha destino com o que protege — instância sobrecarregada
é limitador sobrecarregado. A expectativa honesta é que a guarda de volume contenha abuso
acidental e uso anômalo comum, **não** um flood determinado. Registrado aqui para que a
decisão de publicar seja tomada sabendo disso.

---

## 5. Modelo de dados — colunas e tabelas novas

`efrat_dispositivo` (+): `unidade` (texto derivado das equipes na aprovação,
§1.3), `pendente_id`, `codigo_expira_em`, `ip_hash`,
`ultimo_uso_em`, `recusado_por`, `recusado_em`, `revogado_por`, `revogado_em`,
`motivo_decisao`.

`efrat_pessoa` (+): `telefone` (E.164), `versao_cadastro` (número),
`inativado_em`, `inativado_por`, `motivo_inativacao`, `atualizado_por`,
`atualizado_em`, `telefone_autorizado_por`, `telefone_autorizado_em`,
`telefone_autorizacao_motivo`. **`telefone_compartilhado` não é coluna** — é
derivado na leitura (§3.1), para que o estado se cure sozinho quando o número
deixa de ser compartilhado.

`efrat_equipe` (+): `ativo`. **`local_id` não entra** (§2.4); `unidade` segue como
texto normalizado.

`efrat_marcacao` (+): `recebido_em`, `aparelho_estado_no_envio`,
`aparelho_revogado_em`, `motivo_codigo`. Nenhuma coluna existente é reescrita —
`marcado_em` continua sendo o instante da batida, e é justamente por isso que
`recebido_em` precisa existir separado (§1.6).

`efrat_template` (+): `origem` (`rh_camera` | `rh_upload` | `link` | `gestor`),
`coerencia` (**calculada pelo servidor**, §4.2 — persistida para instrumentação, nunca
enviada ao payload que o RH lê), `convite_id`, `descartado_em`,
`modelo_id`, `modelo_divergente`, `modelo_desconhecido` (§4.7). `estado` ganha o
valor `descartado`. `modelo_id` **não** substitui nem se confunde com `versao`, que
segue sendo contador de template por pessoa.

`efrat_modelo` (nova): `modelo_id`, `primeira_aparicao_em`, `ultima_aparicao_em`,
`origem_observada` (`app` | `publica`), `referencia` (booleano — qual modelo o caminho de
reconhecimento usa). **Alimentada por observação**: cada `modelo_id` que chega numa
requisição é registrado, e a referência é o mais recente visto no caminho do `app`
(§4.7). **Não existe `models/manifesto.json` como fonte** — era o mecanismo antigo, e ele
era a própria armadilha que §4.7 fecha (achado do Biometria ao ler as duas seções lado a
lado). Não há coluna alimentada por build nesta tabela.

`efrat_face_convite` (nova): `convite_id`, `pessoa_id`, `token_hash`, `estado`
(`emitido` | `aberto` | `consumido` | `expirado` | `revogado` | `substituido` |
`bloqueado`), `canal`, `criado_por`, `criado_em`, `expira_em`, `aberto_em`,
`tentativas`, `consumido_em`, `revogado_por`, `revogado_em`, `substituido_por`.

`efrat_limite_api` e `efrat_idempotencia`: reusadas como estão para os limites e
chaves novos. `efrat_sal_ip` (nova, uma linha): sal de deploy para `ip_hash`.

No IndexedDB do aparelho, coleção nova `recusadas` (§1.6): o que o servidor
recusou em definitivo, fora da fila de envio, visível, nunca reenviado e nunca
apagado sozinho.

**Nenhuma coluna existente muda de tipo ou de significado.** Toda adição tem
default vazio, então nada exige migração de dados — o backfill de `telefone`
acontece por edição (§3.1). E não há migração de `unidade` para entidade: ela fica
como está (§2.4).

---

## 6. Catálogo de erros novos

| Código | HTTP | Onde |
|---|---|---|
| `CODIGO_COM_LETRA_INVALIDA` | 422 | rh/aparelho/aprovar |
| `CODIGO_INVALIDO` | 404 | rh/aparelho/aprovar — inexistente, expirado, recusado ou já ativo |
| `CODIGO_AMBIGUO` | 409 | rh/aparelho/aprovar |
| `ESCOPO_VAZIO` | 422 | aprovar, escopo |
| `EQUIPE_INVALIDA` | 422 | aprovar, escopo |
| `EQUIPES_DE_UNIDADES_DIFERENTES` | 422 | aprovar, escopo |
| `LIMITE_APROVACAO` | 429 | rh/aparelho/aprovar |
| `APARELHO_JA_ATIVO` | 409 | rh/aparelho/recusar |
| `DISPOSITIVO_RECUSADO` | 409 | dispositivo/registrar |
| `EQUIPE_DUPLICADA` | 409 | rh/equipe |
| `EQUIPE_COM_MEMBROS` | 422 | rh/equipe (inativar) |
| `TELEFONE_OBRIGATORIO` | 422 | rh/colaborador, colaborador/reativar |
| `TELEFONE_INVALIDO` | 422 | rh/colaborador, colaborador/reativar |
| `TELEFONE_NAO_MOVEL` | 422 | rh/colaborador, colaborador/reativar |
| `TELEFONE_DUPLICADO` | 409 | rh/colaborador, colaborador/reativar — salvo autorização explícita |
| `TELEFONE_COMPARTILHADO_SEM_LINK` | 422 | rh/face/convite |
| `PESSOA_ID_IMUTAVEL` | 422 | rh/colaborador |
| `MATRICULA_IMUTAVEL` | 422 | rh/colaborador |
| `CADASTRO_DESATUALIZADO` | 409 | rh/colaborador e as duas de ativação |
| `CAMPO_DERIVADO` | 400 | rh/colaborador |
| `CAMPO_NAO_EDITAVEL` | 400 | rh/colaborador (corpo com `ativo`) |
| `VETORES_INVALIDOS` | 422 | rh/face/cadastrar, face/convite/enviar, cadastro |
| `COERENCIA_INSUFICIENTE` | 422 | rh/face/cadastrar, face/convite/enviar, cadastro |
| `FOTOS_IGUAIS` | 422 | rh/face/cadastrar, face/convite/enviar, cadastro |
| `PESSOA_SEM_TELEFONE` | 422 | rh/face/convite |
| `PESSOA_INATIVA` | 422 | rh/face/convite |
| `CONVITE_INVALIDO` | 404 | face/convite/abrir, face/convite/enviar |
| `CONVITE_CONSUMIDO` | 409 | face/convite/enviar |
| `MODELO_AUSENTE` | 400 | rh/face/cadastrar, face/convite/enviar |
| `CONVITE_BLOQUEADO` | 429 | face/convite/enviar (5 recusas, §4.4) |
| `LIMITE_VOLUME` | 429 | as três rotas anônimas de §4.8 |
| `CORPO_GRANDE` | 413 | as três rotas anônimas de §4.8 |
| `IDEMPOTENCIA_AUSENTE` | 400 | toda rota nova de escrita |

`motivo_codigo` de item de lote (§1.6), que **não** é erro HTTP:
`aparelho_revogado`, `janela_de_drenagem_encerrada`, `limite_pos_revogacao`,
`aparelho_nunca_liberado`, `pessoa_inativa_no_envio`, `pessoa_inativa`,
`pessoa_desconhecida`.

Reusados sem mudança: `CORPO_INVALIDO`, `CREDENCIAL_INVALIDA`,
`DESCRITOR_INVALIDO`, `DISPOSITIVO_*`, `IDEMPOTENCIA_CONFLITANTE`,
`CODIGO_COLISAO`, `LIMITE_CADASTRO`.

Toda `mensagem` é frase de gente, em português, que diz o que fazer — não o que
falhou. Nenhum erro revela existência de pessoa, equipe ou aparelho fora do escopo
de quem pergunta. Descritor, credencial, token e foto nunca aparecem em log.

---

## 7. Critérios de aceite — o que os testes têm de afirmar

Contrato (servidor falso + workflows):

1. **Nenhuma resposta de leitura do RH contém `codigo_curto`.** Assertiva sobre o
   **JSON**, não sobre o DOM: `JSON.stringify(resposta)` não contém o código do
   pendente semeado. Vale para `/rh/aparelhos` e `/rh/dados`.
2. **Nenhuma resposta de leitura contém token de convite.** Mesma forma, para
   `/rh/face/convites`. O token claro aparece exatamente uma vez em toda a vida do
   convite: na resposta da emissão.
3. `aprovar` **não aceita** `pendente_id` nem `dispositivo_id` como alvo: corpo
   com esses campos e sem `codigo` → erro, e o aparelho segue pendente.
4. Código expirado: passada a janela, `estado` devolve `pendente` com código
   **diferente** do anterior, e o anterior deixa de aprovar.
5. `recusar` → `registrar` com o mesmo UUID responde `409 DISPOSITIVO_RECUSADO`;
   com UUID novo, volta a `202 pendente`.
6. **Aparelho revogado (§1.6), e é o bloco mais importante desta lista:**
   - `carga` e `identificar` dão 403 imediatamente;
   - `marcacoes` responde **200**, nunca 403, com todo item `retido` e
     `motivo_codigo: "aparelho_revogado"`;
   - cada item retido traz `marcado_em` **e** `recebido_em`, e eles são diferentes;
   - item retido **não** conta como ponto em `/rh/dados` até decisão;
   - `itensParaRemover` inclui `retido` → **a fila local esvazia**. Teste que
     falha hoje e precisa falhar antes de passar: enviar, receber `retido`,
     conferir que `Store.fila()` ficou vazia e que um segundo `sincronizar()` não
     reenvia nada;
   - item `rejeitado` sai da fila, entra em `recusadas` e **não volta** no lote
     seguinte — o oposto do comportamento atual;
   - passados 30 dias de `revogado_em`, ou além de 500 marcações, vira
     `rejeitado` com o `motivo_codigo` próprio, **não** 403 silencioso;
   - aparelho `pendente`/`negado` → `rejeitado` com `aparelho_nunca_liberado`.
7. `ultimo_uso_em` **não** muda por consulta de `estado`; muda por `carga` e por
   `marcacoes`.
8. Inativar equipe com membro ativo → `422` com `membros_ativos` correto.
8-A. **`unidade` é texto normalizado, e não existe entidade de local** (§2.4):
    `Unidade A`, `unidade a` e `Unidade  A` resolvem para a mesma unidade; aprovar
    aparelho com equipes de unidades diferentes → `422
    EQUIPES_DE_UNIDADES_DIFERENTES`; a `unidade` gravada no aparelho e devolvida em
    `/dispositivo/estado` é **derivada** das equipes, não enviada pelo cliente. E
    nenhuma requisição deste contrato aceita `local_id`.
9. Telefone: fixo, 10 dígitos e DDD com zero recusados com o código próprio de
   cada um; `(67) 99876-5432` e `+55 67 99876-5432` gravam o mesmo E.164.
9-A. **Telefone compartilhado, o ciclo inteiro:** duplicado sem autorização →
   `409`; com `autorizar_telefone_duplicado` + motivo → grava e registra quem
   autorizou; a pessoa aparece com `telefone_compartilhado: true`; emitir convite
   para ela → `422 TELEFONE_COMPARTILHADO_SEM_LINK`; câmera e upload continuam
   funcionando para ela; e **ao inativar a outra pessoa, o convite passa a ser
   emitido sem nenhum passo extra** — é a prova de que o campo é derivado e não
   gravado.
10. Matrícula muda com zero marcações; recusa com uma marcação.
11. `versao_cadastro` divergente → `409` e **nada é gravado**.
12. **`ativo` no corpo de `/rh/colaborador` → `400 CAMPO_NAO_EDITAVEL`.** E o
    cenário que motivou a regra, encenado: A inativa; B, com corpo antigo
    (inclusive `ativo: true`), salva outro campo; a pessoa **continua inativa**.
13. Marcação anterior a `inativado_em` → `retido`; posterior → `rejeitado`;
    `pessoa_id` desconhecido → `rejeitado`. Os três saem da fila.
    (⚠ substitui a asserção atual de "inativo sempre rejeitado" — T-38A7C1
    precisa atualizar esse e2e.)
14. **Coerência é do servidor, e a fronteira é fechada:**
    - corpo **sem** `coerencia` grava normalmente;
    - corpo **com** `coerencia: 0` (o que `js/fila.js:262` manda hoje) e vetores
      cuja maior distância real é 0,7 → `422 COERENCIA_INSUFICIENTE`. É o teste
      que prova que o número do cliente não decide nada;
    - maior distância 0,094 → grava; 0,50 → `422`; 0,01 → `422 FOTOS_IGUAIS`;
    - **exatamente `0,45` → `422`** (cadastro recusa na fronteira), enquanto
      `vereditoPorDistancia(0.45, cfg)` continua devolvendo `'aceito'`. Os dois
      testes ficam lado a lado, com o comentário do motivo, senão alguém
      "harmoniza" os dois depois (§4.2);
    - 2 ou 4 vetores, ou vetor com 127 números → `422 VETORES_INVALIDOS`;
    - o `coerencia` gravado e devolvido é o do servidor;
    - **não existe sinal de borda:** os itens de `recadastros` em `/rh/dados` não
      carregam `coerencia` **nem** booleano derivado dela — asserção de que a chave não
      existe naquele payload, semeando antes um recadastro **com** `coerencia` preenchida,
      para o teste não passar por lista vazia;
    - o decimal **continua persistido** em `efrat_template.coerencia`: o mesmo teste
      afirma que ele está no registro e ausente do payload, porque persistir e exibir são
      coisas diferentes (§4.2). A remoção é na **serialização** da leitura, nunca na
      gravação — se o campo deixar de ser gravado, este teste passa por vacuidade;
16-A. **Procedência do modelo (§4.7), que subiu de dívida a critério:**
    - as duas rotas novas sem `modelo_id` → `400 MODELO_AUSENTE`;
    - `modelo_id` igual ao de referência → grava limpo;
    - `modelo_id` conhecido e **diferente** da referência → **grava** e marca
      `modelo_divergente`, e o card da fila mostra o aviso de §4.7 **antes** da
      conferência e do botão Aprovar, sem gate adicional;
    - card com as duas condições (veio por link **e** modelo divergente) mostra os
      **dois** avisos empilhados, não um texto fundido;
    - `modelo_id` desconhecido → **grava** e marca `modelo_desconhecido`;
    - **nunca recusa por divergência de modelo** — o teste afirma que o template
      existe depois de um envio divergente;
    - `modelo_id` e `versao` são independentes: recadastro da mesma pessoa com
      modelo novo dá `versao: 2` com `modelo_id` diferente, e o teste checa os dois
      campos separados para ninguém colapsar um no outro;
    - dois deploys com os mesmos bytes de `models/` produzem o **mesmo**
      `modelo_id`; um deploy com um `.bin` trocado produz outro.
16-B. **As duas origens servem o mesmo pipeline, e o teste compara bytes — não
    manifesto.** Baixa os 7 arquivos do pipeline (3 `.bin`, 3 `*-weights_manifest.json`,
    `vendor/face-api.js`) **da origem pública** e **da origem do app** (segundo listener,
    §4.6), calcula o digest em ordem fixa nas duas e afirma que são **iguais**. Depois
    afirma que o `modelo_id` que o cliente envia é exatamente esse digest.
    `Por quê sem manifesto:` o mecanismo antigo comparava contra um `manifesto.json` de
    build, e um manifesto de build não descreve bytes servidos (§4.7) — o teste herdaria
    a mesma cegueira que a seção existe para fechar. Comparar as duas origens byte a byte
    não tem intermediário para mentir, e é exatamente a divergência que o carimbo existe
    para pegar: origem pública um deploy atrás.
17. **Template de link é `pendente` mesmo sem template anterior.** Pessoa sem
    biometria nenhuma + envio por link → `template_estado: "pendente"`, e
    `tem_biometria` da pessoa continua falso até a decisão do RH.
18. `abrir` devolve **apenas** `estado`, `primeiro_nome`, `fotos_exigidas`,
    `coerencia_maxima`, `expira_em`, `request_id` — asserção de chaves exatas, para
    que campo novo não entre por descuido.
19. Token de convite recusado em `/efrat/carga`, `/efrat/identificar`,
    `/efrat/marcacoes` e em toda `/efrat/rh/*`.
20. CORS das duas rotas de face: `OPTIONS` responde com `Allow-Headers` incluindo
    `Authorization` e `Idempotency-Key`, e `Allow-Origin` **não** é `*`.

Origem pública (T-AABCC9), com o segundo listener do servidor falso:

21. A página pública é servida em **outra origem** (outra porta no e2e) e carrega
    sem nada da origem do app no ar.
21-A. O deploy público **não contém** `index.html` do app, `js/app.js` nem
    `sw.js` — isolamento por ausência do arquivo, não por regra de rota (§4.6).
    Guarda estática sobre a lista de arquivos publicados, porque
    `js/app.js:324` registra o service worker de raiz sem condição: shell do app
    alcançável na origem pública significa SW do app instalado na origem pública.
22. Da página pública, `indexedDB.databases()` (ou abrir `efrat-ponto`) **não vê**
    os dados do app — o dado do app continua lá, na origem do app.
23. O service worker do app não intercepta requisição da página pública, e a
    página pública não registra service worker.
24. Fecho de importação igual ao de §4.6 — nem mais, nem menos; `mostrar` não
    importado; `indexedDB`, `localStorage`, `sessionStorage`, `document.cookie`,
    `navigator.serviceWorker`, `caches` ausentes do fecho.
25. Nenhuma referência a `sw.js`, `manifest.json`, `index.html` do app ou URL
    absoluta da origem do app no fecho público.
26. `config-face.js` não contém `limiarCinza`, `limiarPresenca`, `alarmeManual`,
    `chartCdn`, `loteMax` nem `syncIntervalMs`.
27. A CSP da origem pública é a de §4.6 (com `connect-src` incluindo `'self'`, ou
    os pesos do modelo não carregam) e o HTML vai com `no-store`.

Critérios de UI que são contrato, não estética:

28. O campo de aprovação é **digitação livre** — sem `<select>`, sem `datalist`,
    sem autocomplete a partir da lista de pendentes.
29. A lista de pendentes rotula `apelido`/`ua`/`geo` como informados pelo
    aparelho, e sinaliza concentração de pedidos por **frase com a ação**, não pelo
    contador cru — o `pedidos_da_mesma_rede_1h` continua na resposta e no log, para
    investigação (§1.2).
30. A confirmação de revogar diz que o aparelho ainda entrega e que cada marcação
    cai na mesa do RH com as duas horas.
31. A confirmação de inativar diz que reativar exige cadastrar o rosto de novo.
32. Inativar e reativar são botões próprios, fora do formulário de cadastro.
32-A. A aba de equipes **abre a equipe, lista os membros, adiciona e remove de
    dentro dela** (§2.1). "Trocar o `<select>` de equipe na aba de pessoas" não
    cumpre o critério, mesmo sendo a mesma escrita por baixo.
32-B. O texto de autorização de telefone duplicado diz, **antes** de autorizar,
    que aquela pessoa não vai poder receber o link de cadastro de face, nomeando
    com quem o número é compartilhado (§3.1). O botão só destrava com motivo de
    10+ caracteres. E a asserção que prova que nada disso é selo permanente:
    **sumiu a duplicidade, os textos somem sozinhos** — tag, aviso e botão
    desabilitado — **sem ação de ninguém**.
32-C. A fila de cadastros de face nunca é lista uniforme: separa primeiro cadastro
    de substituição, mostra contagem, e o Aprovar de cada card só destrava depois
    da conferência explícita (já implementado em `53136b3`; fica como critério para
    não regredir).
33. A pendência de marcação retida mostra hora da batida **e** hora do
    recebimento, agrupada por aparelho, com contagem.
34. A página de face, na tela final, não tem link nem botão para o app.
35. **Guarda de vocabulário — nenhum jargão nosso na tela.** Os termos internos
    deste contrato não aparecem em texto visível ao usuário: `retido`, `escopo`,
    `coerência`, `modelo`, `modelo divergente`, `template`, `descritor`,
    `pendente_id`, `dispositivo_id`, `configuracao_versao`, `versao_cadastro`,
    `idempotência`, `E.164`, `derivado`. Guarda estática sobre os literais de texto
    de `js/rh.js`, `js/fila.js`, `js/app.js` e da página pública.
    `Por quê é critério e não recomendação:` complexidade de **invariante** não pode
    virar complexidade de **tela**. O usuário é leigo, numa empresa de engenharia, e
    o cliente pediu explicitamente a aplicação mais simples possível. Cada invariante
    deste documento nasceu de defeito real; nenhum deles autoriza ensinar o
    vocabulário do defeito a quem só quer registrar ponto. Exceção única e
    consciente: o código curto do aparelho, que é dado que o RH digita.

---

## 8. O que foi recusado, e por quê

| Alternativa | Por que não |
|---|---|
| **Página pública em caminho do mesmo domínio** (era o desenho anterior deste contrato) | Não isola nada: SW de raiz intercepta todo GET same-origin (`sw.js:57-60`), o fallback offline entrega o shell do app (`sw.js:65`), e o IndexedDB com a credencial do aparelho isola por origem, não por caminho (`js/store.js:10`). Um XSS ali deixaria de vazar um cadastro e passaria a vazar a credencial (§4.6) |
| **Guardar o isolamento só com guarda de CI e revisão** | Guarda de CI protege contra o commit distraído, não contra XSS em tempo de execução. Origem própria é garantia do navegador; as duas coisas somam, mas só uma é garantia |
| **Um projeto Vercel, dois hosts, com regra por host** (era a minha recomendação, revertida pelo Orquestrador) | `js/app.js:324` registra `./sw.js` sem condição no boot. Shell do app alcançável na origem pública = **service worker de raiz do app instalado na origem pública**, com precache e com o fallback para o shell do app. Uma regra de rota furada deixaria de expor arquivos e passaria a instalar exatamente o mecanismo que a mudança existe para remover. Isolar por ausência do arquivo (§4.6) |
| **Recusar telefone duplicado sem saída nenhuma** | O RH digita número falso para conseguir salvar a ficha, e número falso é mentira indetectável na base. Exceção autorizada e registrada, com o link de face negado para quem compartilha (§3.1) |
| **Permitir link de face para telefone compartilhado, autorizando também** | O telefone é o canal de entrega: não há como saber quem dos dois abriu o link, e o resultado é template gravado no `pessoa_id` errado — o pior caso do produto (§4.3) |
| **`coerencia` calculada e enviada pelo cliente** | Número que o cliente informa sobre si mesmo é número que o cliente escolhe. Hoje o servidor ignora (`servidor-falso.js:544-546`) e o gestor manda `0` fixo (`js/fila.js:262`). O servidor **consegue** calcular — é aritmética, não inferência (§4.2) |
| **Template de link ativo quando é o primeiro cadastro** | O pior caso do produto é cadastrar a própria face no `pessoa_id` de outro: o atacante bate ponto como a vítima e ela cai em registro manual, virando "problema de biometria" em vez de vítima (§4.3) |
| **Queimar o link na abertura** | Quem perde conexão entre a 2ª e a 3ª foto ficaria sem caminho; o RH aprenderia a reemitir por qualquer motivo e o uso único morreria na prática (§4.4) |
| **Segunda janela de validade contada da abertura** | Estrangula exatamente quem tem sinal ruim, pelo mesmo mecanismo da linha acima. Um relógio só (§4.4) |
| **403 no lote de aparelho revogado** | Apaga jornada trabalhada, e apaga em silêncio: o cliente nunca solta o item da fila (`js/api.js:178-182`) e retenta para sempre sem ninguém ver (§1.6) |
| **Aceitar o lote do revogado como ponto normal** | Dá valor de registro a um aparelho em que o RH acabou de dizer que não confia. `retido` resolve os dois lados |
| **`ativo` como campo do formulário de cadastro** | O POST manda o registro inteiro: operador com tela velha reativa alguém por acidente, e a pessoa volta a bater ponto sem decisão de ninguém (§3.2) |
| Rota `/efrat/rh/equipe/membro` para mover membro | Segunda escritora de `efrat_pessoa.equipe_id`, com o risco de `upsert` que `api-piloto.md` já documenta; e sugeriria vínculo N:N, que quebra o escopo offline (§2.1) |
| Pessoa em várias equipes | Duplica pessoa na galeria de um aparelho e torna ambíguo o escopo da sessão de gestor |
| Token do convite em query string | Entra em log de acesso do host estático e no histórico do navegador. Fragmento não sai do navegador, e o host estático não precisa do token (§4.4) |
| Token no `localStorage` da página pública | Sobrevive ao fechamento da aba: link de uso único que continua utilizável em aparelho compartilhado |
| Servidor manda o WhatsApp | Exige credencial de gateway, e app estático sem build não tem onde guardar segredo (§ Restrição, item 1) |
| Enviar as 3 fotos e calcular o descritor no servidor | O n8n não tem modelo; e seriam megabytes de base64 por cadastro atravessando workflow e Data Table (§4.1) |
| Aceitar coerência na zona cinzenta 0,45–0,58 marcando para revisão | Template sujo envenena toda verificação futura; cadastro é o momento barato de exigir amostra limpa (§4.2) |
| Mostrar o código curto na lista de pendentes | `ameacas-v3.md` § Novo 2: aprovar viraria copiar de um campo para outro e o Cenário 2 volta inteiro (§1.1) |
| Devolver o motivo da recusa para o aparelho | Texto interno do RH renderizado num aparelho que ele acabou de declarar não confiável (§1.4) |
| Telefone do RH na resposta de `/dispositivo/estado` | Dado da organização entregue a quem ainda não foi liberado; `config.js` resolve melhor (§1.8) |
| `Access-Control-Allow-Origin: *` nas rotas de face | Barato demais para não fazer a lista, e a lista impede sondagem conduzida pelo navegador de terceiro (§4.6) |
| **Distinguir `CODIGO_EXPIRADO` de `CODIGO_NAO_ENCONTRADO`** (era a minha segunda versão, achado do Orquestrador) | Conta se aquele código específico chegou a existir — oráculo mesmo com força bruta inviável, porque um insider com acesso de RH confirma que um aparelho plantado foi recebido. A frase única do Designer resolve o problema que me fez separar, sem separar (§1.3) |
| **Rate limit de `convite/abrir` por IP** (era o que eu havia escrito, achado do DevOps) | NAT de operadora faz uma turma no mesmo canteiro se trancar mutuamente; o colaborador lê "tente mais tarde" e liga para o RH — o limite produziria o volume de ligação que a fase existe para desafogar. E contradizia o meu próprio parágrafo seguinte: se com 256 bits o limite é contra volume, não precisa ser severo nem morar na rota (§4.4) |
| **Entidade `efrat_local` com id próprio** (era o que eu havia escrito, pergunta do Full-Stack) | Terceiro conceito para um RH leigo e um passo a mais em duas telas, para agrupar por id o que já agrupa por texto. E o único poder exclusivo da entidade — aparelho seguir o lugar, equipe nova entrando no escopo sozinha — é o Cenário 3 com a API cumprida (§2.4) |
| **Sinal de borda dentro da faixa aceita** (`coerencia_no_limite`, especificado por mim em `0,30`, corrigido para `0,34`, e **derrubado** por decisão do Orquestrador sobre medição que nenhum de nós havia usado) | A tabela de adornos do `README.md` mostra que a faixa aceita está **legitimamente ocupada** por variação da mesma pessoa até quase encostar em `0,45`: capacete de obra sozinho custa `0,257`, e num cliente de engenharia capacete é o estado normal de quem bate ponto. `0,257` mais qualquer outra variação passa de `0,30` num cadastro legítimo, então o aviso acenderia no caso comum e treinaria o RH a ignorar — degradando a conferência humana que compensa a ausência de liveness. **Duas coisas são verdade ao mesmo tempo, e quem ler daqui a seis meses precisa das duas:** a conclusão original do Orquestrador ("o número sai e nada entra no lugar") estava certa, por um motivo que ele não tinha na época; e o meu diagnóstico ("você raciocinou sobre a decisão, não sobre a tarefa") também estava certo — existe uma necessidade de tarefa ali. O que a medição mostrou é que **nenhum mecanismo dentro da faixa atende essa necessidade**, não que a necessidade não existisse. Por isso o corte não volta com outro número: condição de entrada para qualquer sinal nessa faixa é distribuição medida de mesma pessoa na população real (§4.2) |
| **Mostrar o número de coerência no card do RH** (decisão anterior do Orquestrador, caducada) | Fazia sentido com limiar `0,55` e `confirm()`, quando o número decidia se o RH seguia. Com o servidor recusando em `0,45`, o número passou a variar numa faixa em que a resposta é sempre a mesma — decoração numérica de nome técnico (§4.3). Continua gravado para auditoria e recalibração |

---

## 9. Dívida registrada por este contrato

1. **`rh_upload` é aprovado por quem subiu.** Controle procedimental, não técnico.
   Fecha com inferência no servidor + liveness (`validacao-biometrica.md` §3).
2. **Uso único sem transação.** Compare-and-set em Data Table pode correr; contido
   por idempotência e por dano limitado — os dois templates nascem `pendente`
   (§4.4).
3. **Chave PBKDF2 do RH é credencial permanente, e é a dívida que sustenta todas
   as outras.** `js/rh.js:22-28`: o navegador deriva a chave e ela viaja em toda
   chamada, valendo como bearer sem expiração — quem a capturar entra sem saber a
   senha. **Toda invariante desta fase pressupõe que quem está logado como RH é o
   RH:** a prova de posse física do código curto (§1.1) protege contra aprovar o
   aparelho errado, não contra alguém com a chave do RH aprovando o próprio; a
   autorização de telefone duplicado (§3.1), a aprovação de template `pendente`
   (§4.3) e a emissão de convite (§4.5) valem exatamente o que vale essa
   credencial. Levantado pelo QA, assumido pelo Orquestrador. Herdado e fora desta
   rodada, dimensionado em `ameacas-v3.md` § Dívida conhecida (2,5–3 dias). Toda
   rota nova de RH usa o mesmo mecanismo de propósito: a troca por sessão com
   expiração fica sendo um ponto único de mudança.
4. **`configuracao_versao` não é observada pelo cliente.** §1.7 incrementa;
   `js/app.js` ainda não compara para forçar recarga de carga. Trabalho de
   T-87615C ou seguinte.
5. **Retenção de `foto_auditoria`** (90 dias) segue sem implementação. Herdado.
6. **Duas cópias do limiar de aceite** (`config.js` e a constante do workflow),
   amarradas por teste (§7, item 14) e não por estrutura. Estrutura de verdade só
   existe quando houver serviço próprio no lugar do n8n.
7. **A cópia de assets do projeto público é passo de deploy, não de repositório**
   (§4.6). Fonte de verdade única na árvore do app, cópia no build do projeto
   público. O risco de o passo parar de rodar em silêncio **deixou de ser dívida e
   virou §4.7**: cada template carimba o `modelo_id`, e a divergência aparece no
   primeiro cadastro real feito com o peso errado, com pessoa e instante — não numa
   comparação agendada que alguém precisa lembrar de rodar. O que sobra de dívida é
   menor e honesto: o `modelo_id` é **declarado pelo cliente**, então é procedência
   e não prova. Fecha junto com a inferência no servidor (dívida 1), que é o mesmo
   ponto onde o vetor deixa de ser palavra do cliente.
8. **`unidade` como texto, e não entidade** (§2.4). Endereço e geofence repetidos
   por equipe, e renomear um canteiro é editar N equipes. Escolhido de propósito
   contra `adr-acesso-v3.md` § Persistência e locais, pelo custo de tela num usuário
   leigo. Vira `efrat_local` quando N crescer ou quando o geofence por local importar;
   a normalização de §2.3 é o que mantém essa migração mecânica.
9. **A faixa aceita de coerência não tem sinal interno, e não deveria ter sem dados.**
   `efrat_template.coerencia` é persistida por cadastro exatamente para produzir a
   distribuição da população real da Efrat, que hoje não existe. Enquanto ela não
   existir, qualquer corte dentro da faixa é juízo — e §4.2 registra a condição de
   entrada. A dívida é o piloto terminar sem ninguém olhar esses números, que é o
   desfecho mais provável se não houver quem pergunte.
10. **A exceção de telefone compartilhado é decisão humana sem verificação.** O RH
   autoriza, fica registrado quem autorizou, e ninguém confere se o
   compartilhamento é real. É o desenho certo (recusar sem saída produz número
   falso, §3.1), e é dívida: a única defesa é a autorização estar registrada e
   visível.
