# FASE 3 · Contrato de dados e rotas

- **Status:** aceito para implementação (T-65D806)
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
| T-8188C6 | Full-Stack | §2 e §3 — equipes com membros, colaborador com telefone e edição |
| T-D30529 | Full-Stack | §4 — três caminhos de cadastro de face |
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
      "local": { "local_id": "loc-01", "nome": "Obra Norte" },
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
  contagem de pedidos pendentes na última hora com o mesmo `ip_hash`. É o número
  que torna o flood do Cenário 1 visível para um RH leigo: "12 pedidos da mesma
  rede na última hora" é suspeita que ninguém precisa explicar. Guardamos hash
  com sal de deploy, nunca o IP.
- **`encerrados` cobre 30 dias.** Recusa e revogação precisam ser auditáveis por
  um período curto; não é histórico eterno.
- Rota **separada** de `/efrat/rh/dados`, que ganha apenas o contador
  `aparelhos_pendentes` (para o badge da aba) e `locais[]` (para o seletor de
  aprovação).
  `Por quê:` a aba de aparelhos muda enquanto o RH olha e precisa de refresh
  próprio; recarregar o painel inteiro (marcações do período, pessoas, equipes)
  a cada 15 s por causa de uma lista de 3 linhas é desperdício.

### 1.3 `POST /efrat/rh/aparelho/aprovar`

```json
{ "usuario": "rh", "chave": "…", "idempotency_key": "uuid-v4",
  "codigo": "ABC-123", "local_id": "loc-01", "equipes_ids": ["eq-01", "eq-02"] }
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
| alguma equipe inexistente, inativa, ou de outro `local_id` | `EQUIPE_FORA_DO_LOCAL`, com `campo: "equipes_ids"` |
| `local_id` inexistente ou inativo | `LOCAL_INVALIDO` |
| mais de 10 códigos errados do mesmo usuário de RH em 5 min | `429 LIMITE_APROVACAO` + `Retry-After` |

`Por quê a mensagem única no 404:` distinguir "existe mas expirou" de "não
existe" transforma o campo de aprovação em oráculo de códigos válidos. E o
limite de tentativas erradas existe porque, sem ele, 29,7 bits atrás de um
formulário logado é força bruta viável contra um lote de pendentes.

Efeito da aprovação, atômico: `estado` → `ativo`, grava `local_id`,
`equipes_ids`, `aprovado_por`, `aprovado_em`, `configuracao_versao` = 1, apaga
`codigo_curto` e `codigo_expira_em`.

Resposta `200`:

```json
{ "ok": true, "dispositivo_id": "uuid-v4", "apelido": "Tablet obra norte",
  "local": { "local_id": "loc-01", "nome": "Obra Norte" },
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
  "dispositivo_id": "uuid-v4", "local_id": "loc-01", "equipes_ids": ["eq-01"] }
```

Mesmas validações de `aprovar` (`ESCOPO_VAZIO`, `EQUIPE_FORA_DO_LOCAL`,
`LOCAL_INVALIDO`). Incrementa `configuracao_versao`.

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
    "local": { "local_id": "loc-01", "nome": "Obra Norte" },
    "equipes_ids": ["eq-01","eq-02"], "configuracao_versao": 7
  },
  "request_id": "…" }
```

- `codigo_expira_em` permite a tela dizer quanto tempo o código ainda vale, em
  vez de exibir um número que pode ter morrido.
- `dispositivo.local` é a volta do laço de §1.1.
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
nova `equipe_id` dela. A tela pode ser a da equipe; a escrita é na pessoa.

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
  "equipe_id": "eq-01", "nome": "Equipe Norte", "local_id": "loc-01",
  "ativo": true }
```

- Sem `equipe_id` → cria. Com `equipe_id` → atualiza.
- `local_id` substitui `unidade` como fonte da verdade (ADR § Persistência e
  locais). `unidade` continua **aceito e gravado** durante a migração, e é
  ignorado quando `local_id` vem.
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
| já existe pessoa **ativa** com o mesmo E.164 | `409 TELEFONE_DUPLICADO` |

**Tem de ser celular.** No Brasil, celular é DDD + `9` + 8 dígitos; fixo tem 8
dígitos começando em 2–5. Fixo é recusado com mensagem própria: "Precisa ser um
celular: é por ele que a gente manda o link do cadastro de face."
`Por quê:` a decisão 1 da fase diz que o telefone existe porque é o canal com o
RH, e o canal concreto que este contrato constrói (§4.5) manda link por
WhatsApp/SMS. Um fixo satisfaz a coluna e não satisfaz a função.

**Duplicado é recusado** porque dois colaboradores no mesmo número significa link
de cadastro de face entregue à pessoa errada — e é justamente o link que produz
template. A mensagem pode nomear quem já usa o número: quem pergunta está
autenticado como RH.

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
`ativo`. Vêm na leitura, recusados na escrita (`400 CAMPO_DERIVADO`).
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
diferentes **0,61** e **0,80**; aceite do produto **0,45**.

| Faixa da maior distância par a par | Decisão |
|---|---|
| `< 0,02` | **recusa** — `422 FOTOS_IGUAIS` |
| `0,02` a `0,45` | **grava** |
| `> 0,45` | **recusa** — `422 COERENCIA_INSUFICIENTE` |

- **Teto em 0,45.** É o `limiarAceite` do produto inteiro. Três fotos da mesma
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

`pendente` cai na **fila de recadastro que já existe** (`/efrat/rh/dados` →
`recadastros`, decidida em `/efrat/rh/decidir` com `tipo: "template"`), onde o RH
vê a miniatura nova ao lado da atual antes de virar referência. Semântica idêntica
à de `origem: "gestor"` que `api-piloto.md` já descreve. A fila passa a mostrar
`origem`, quem cadastrou e a `coerencia` **calculada pelo servidor**, porque "veio
de link" e "veio da minha câmera" pedem desconfianças diferentes de quem decide.

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
funciona hoje**. Com a rota nova, o painel do RH deixa de tocar `/efrat/cadastro`,
que continua existindo apenas para o caminho do **aparelho** em campo (gestor
cadastrando, `origem: "gestor"`, template `pendente` como já é).

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

Limites: 5 envios recusados por convite → `bloqueado`. Rate limit por IP em
`convite/abrir` → `429 LIMITE_CONVITE` + `Retry-After`. Com 256 bits, adivinhar é
impossível; o limite é contra volume, não contra sorte.

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
instrução de envio. Recusa `422 PESSOA_SEM_TELEFONE` se a pessoa não tem telefone
válido (é aqui que a obrigatoriedade de §3.1 cobra a conta) e `422 PESSOA_INATIVA`
para desligado.

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

**Como isso se implementa sem build** — decisão de mecanismo é de T-AABCC9, e há
dois caminhos aceitáveis:

- **Projeto Vercel próprio**, mesmo repositório, *Root Directory* apontando para
  `publico-face/`, domínio `face.<domínio>`. Root Directory é configuração de
  painel, não passo de build. Custo: `models/` e `vendor/` duplicados no
  repositório, com risco de deriva entre as duas cópias.
- **Um projeto, dois hosts**, com regra por host em `vercel.json` (`has: [{ type:
  "host" }]`): no host público resolvem **apenas** os caminhos do fecho acima,
  todo o resto responde 404; no host do app, `publico-face/*` responde 404.
  Custo: uma regra de roteamento a mais para revisar. Ganho: nenhuma duplicação de
  6 MB de pesos e uma cópia só de cada arquivo para auditar.

Recomendação: o segundo. **E a razão é que a propriedade de segurança não depende
dessa escolha.** Isolamento de `IndexedDB`, escopo de service worker,
`localStorage` e política de mesma origem são todos por **origem**. Mesmo que a
regra de roteamento falhasse e o `index.html` do app aparecesse no host público,
ele abriria um IndexedDB **vazio**, na origem pública, sem credencial nenhuma — o
pior caso é um pedido de liberação de aparelho espúrio, que o RH recusa. A regra
de roteamento é arrumação; a origem é a garantia.

**Como se testa isso sem DNS.** `tests/e2e/servidor-falso.js` passa a subir um
**segundo listener, em outra porta**, servindo somente o fecho público. Porta
diferente é origem diferente para o navegador — é exatamente o isolamento de
produção, reproduzido localmente. Com isso o e2e consegue afirmar, e não supor:
que a página pública não vê o IndexedDB do app, que o service worker do app não a
intercepta, e que ela funciona sem nada da origem do app no ar.

---

## 5. Modelo de dados — colunas e tabelas novas

`efrat_dispositivo` (+): `pendente_id`, `codigo_expira_em`, `ip_hash`,
`ultimo_uso_em`, `recusado_por`, `recusado_em`, `revogado_por`, `revogado_em`,
`motivo_decisao`.

`efrat_pessoa` (+): `telefone` (E.164), `versao_cadastro` (número),
`inativado_em`, `inativado_por`, `motivo_inativacao`, `atualizado_por`,
`atualizado_em`.

`efrat_equipe` (+): `local_id` (já previsto no ADR), `ativo`.

`efrat_marcacao` (+): `recebido_em`, `aparelho_estado_no_envio`,
`aparelho_revogado_em`, `motivo_codigo`. Nenhuma coluna existente é reescrita —
`marcado_em` continua sendo o instante da batida, e é justamente por isso que
`recebido_em` precisa existir separado (§1.6).

`efrat_template` (+): `origem` (`rh_camera` | `rh_upload` | `link` | `gestor`),
`coerencia` (**calculada pelo servidor**, §4.2), `convite_id`, `descartado_em`.
`estado` ganha o valor `descartado`.

`efrat_local`: como o ADR define, sem alteração.

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
acontece por edição (§3.1) e o de `local_id` por edição de equipe (§2.3).

---

## 6. Catálogo de erros novos

| Código | HTTP | Onde |
|---|---|---|
| `CODIGO_COM_LETRA_INVALIDA` | 422 | rh/aparelho/aprovar |
| `CODIGO_NAO_ENCONTRADO` | 404 | rh/aparelho/aprovar |
| `CODIGO_AMBIGUO` | 409 | rh/aparelho/aprovar |
| `ESCOPO_VAZIO` | 422 | aprovar, escopo |
| `EQUIPE_FORA_DO_LOCAL` | 422 | aprovar, escopo |
| `LOCAL_INVALIDO` | 422 | aprovar, escopo |
| `LIMITE_APROVACAO` | 429 | rh/aparelho/aprovar |
| `APARELHO_JA_ATIVO` | 409 | rh/aparelho/recusar |
| `DISPOSITIVO_RECUSADO` | 409 | dispositivo/registrar |
| `EQUIPE_DUPLICADA` | 409 | rh/equipe |
| `EQUIPE_COM_MEMBROS` | 422 | rh/equipe (inativar) |
| `TELEFONE_OBRIGATORIO` | 422 | rh/colaborador, colaborador/reativar |
| `TELEFONE_INVALIDO` | 422 | rh/colaborador, colaborador/reativar |
| `TELEFONE_NAO_MOVEL` | 422 | rh/colaborador, colaborador/reativar |
| `TELEFONE_DUPLICADO` | 409 | rh/colaborador, colaborador/reativar |
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
| `LIMITE_CONVITE` | 429 | face/convite/abrir |
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
9. Telefone: fixo, 10 dígitos, DDD com zero e duplicado recusados com o código
   próprio de cada um; `(67) 99876-5432` e `+55 67 99876-5432` gravam o mesmo
   E.164.
10. Matrícula muda com zero marcações; recusa com uma marcação.
11. `versao_cadastro` divergente → `409` e **nada é gravado**.
12. **`ativo` no corpo de `/rh/colaborador` → `400 CAMPO_NAO_EDITAVEL`.** E o
    cenário que motivou a regra, encenado: A inativa; B, com corpo antigo
    (inclusive `ativo: true`), salva outro campo; a pessoa **continua inativa**.
13. Marcação anterior a `inativado_em` → `retido`; posterior → `rejeitado`;
    `pessoa_id` desconhecido → `rejeitado`. Os três saem da fila.
    (⚠ substitui a asserção atual de "inativo sempre rejeitado" — T-38A7C1
    precisa atualizar esse e2e.)
14. **Coerência é do servidor:**
    - corpo **sem** `coerencia` grava normalmente;
    - corpo **com** `coerencia: 0` (o que `js/fila.js:262` manda hoje) e vetores
      cuja maior distância real é 0,7 → `422 COERENCIA_INSUFICIENTE`. É o teste
      que prova que o número do cliente não decide nada;
    - maior distância 0,094 → grava; 0,50 → `422`; 0,01 → `422 FOTOS_IGUAIS`;
    - 2 ou 4 vetores, ou vetor com 127 números → `422 VETORES_INVALIDOS`;
    - o `coerencia` gravado e devolvido é o do servidor;
    - `EFRAT_CFG.limiarAceite` e a constante do workflow valem **o mesmo número**.
15. Inativar apaga `vetores` e `miniatura` dos templates, revoga convite vivo, e
    mantém as marcações — contadas antes e depois.
16. **Convite:**
    - **abrir não consome**: abrir 3 vezes e depois enviar ainda grava;
    - **envio recusado não consome**: `422` de coerência, depois envio bom → grava;
    - o consumo acontece no envio bem-sucedido, e o segundo envio (chave nova) →
      `409 CONVITE_CONSUMIDO`;
    - mesmo envio com a mesma `Idempotency-Key` → repete a resposta, não consome
      de novo;
    - expiração só pela emissão (60 min); **não existe** janela contada da
      abertura;
    - revogação, reemissão marcando o anterior `substituido`, e um convite vivo
      por pessoa;
    - inválido/expirado/revogado/substituído/bloqueado produzem a **mesma**
      mensagem de `404`; `consumido` responde `200 { estado: "consumido" }` sem
      `primeiro_nome`.
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
    aparelho, e mostra `pedidos_da_mesma_rede_1h`.
30. A confirmação de revogar diz que o aparelho ainda entrega e que cada marcação
    cai na mesa do RH com as duas horas.
31. A confirmação de inativar diz que reativar exige cadastrar o rosto de novo.
32. Inativar e reativar são botões próprios, fora do formulário de cadastro.
33. A pendência de marcação retida mostra hora da batida **e** hora do
    recebimento, agrupada por aparelho, com contagem.
34. A página de face, na tela final, não tem link nem botão para o app.

---

## 8. O que foi recusado, e por quê

| Alternativa | Por que não |
|---|---|
| **Página pública em caminho do mesmo domínio** (era o desenho anterior deste contrato) | Não isola nada: SW de raiz intercepta todo GET same-origin (`sw.js:57-60`), o fallback offline entrega o shell do app (`sw.js:65`), e o IndexedDB com a credencial do aparelho isola por origem, não por caminho (`js/store.js:10`). Um XSS ali deixaria de vazar um cadastro e passaria a vazar a credencial (§4.6) |
| **Guardar o isolamento só com guarda de CI e revisão** | Guarda de CI protege contra o commit distraído, não contra XSS em tempo de execução. Origem própria é garantia do navegador; as duas coisas somam, mas só uma é garantia |
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

---

## 9. Dívida registrada por este contrato

1. **`rh_upload` é aprovado por quem subiu.** Controle procedimental, não técnico.
   Fecha com inferência no servidor + liveness (`validacao-biometrica.md` §3).
2. **Uso único sem transação.** Compare-and-set em Data Table pode correr; contido
   por idempotência e por dano limitado — os dois templates nascem `pendente`
   (§4.4).
3. **Chave PBKDF2 do RH continua sendo a credencial.** Herdado, fora desta rodada,
   já dimensionado em `ameacas-v3.md` § Dívida conhecida (2,5–3 dias). Toda rota
   nova de RH usa o mesmo mecanismo — a troca por sessão com expiração fica sendo
   um ponto único de mudança, e isso é de propósito.
4. **`configuracao_versao` não é observada pelo cliente.** §1.7 incrementa;
   `js/app.js` ainda não compara para forçar recarga de carga. Trabalho de
   T-87615C ou seguinte.
5. **Retenção de `foto_auditoria`** (90 dias) segue sem implementação. Herdado.
6. **Duas cópias do limiar de aceite** (`config.js` e a constante do workflow),
   amarradas por teste (§7, item 14) e não por estrutura. Estrutura de verdade só
   existe quando houver serviço próprio no lugar do n8n.
7. **A origem pública duplica ou roteia**, dependendo do mecanismo que T-AABCC9
   escolher (§4.6). Se for projeto próprio com `Root Directory`, entra dívida de
   deriva entre as cópias de `models/` e `vendor/`, e ela precisa de guarda de CI
   comparando os bytes.
