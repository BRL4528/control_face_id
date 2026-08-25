# Mapa das 25 rotas v3 · API-4 → API-1 (Arquiteto) · 25/08/2026

Fonte: `tests/e2e/servidor-falso.js` (linhas 554-1727, base commit `49d23c1`) +
`docs/fase3-contrato.md` + `js/api.js`/`publico/js/api-face.js` (cross-check
client-side). Objetivo: acelerar a parte 2/2 do Arquiteto (núcleo puro +
adaptador HTTP) — cada rota abaixo já vem com a lista dos métodos de
`nucleo/repositorio.js` que ela precisa chamar, pra não redescobrir lendo o
fake server de novo.

## Coluna pedida pelo Orquestrador: o que o cliente TOCA no primeiro turno de teste em produção amanhã

Caminho feliz mínimo (celular novo → RH aprova → app baixa carga → bate ponto →
RH confere), reconstruído lendo js/app.js (não afirmado pelo Orquestrador nem
pelo cliente — é INFERÊNCIA de fluxo, sinalizado onde é palpite):

| # | Rota | Toca amanhã? | Por quê |
|---|---|---|---|
| 1 | `/efrat/dispositivo/registrar` | **SIM — é o 404 que está derrubando produção agora** | primeiro passo, sem ele nada mais acontece |
| 2 | `/efrat/dispositivo/estado` | **SIM** | app faz poll disso duas vezes no caminho feliz (pendente→código, depois ativo) |
| 8 | `/efrat/rh/sal` | **SIM** | RH precisa logar no painel pra aprovar o aparelho |
| — (auth /rh/*) | gate usuario+chave | **SIM** | toda rota /rh/* abaixo depende dele |
| 18 | `/efrat/rh/aparelhos` | **SIM** | RH precisa VER o pendente antes de aprovar |
| 15 | `/efrat/rh/aparelho/aprovar` | **SIM — é o ÚNICO caminho que ativa o aparelho** | sem isso o app fica pendente pra sempre |
| 3 | `/efrat/carga` | **SIM** | app baixa pessoas+templates depois de ativo, antes de reconhecer qualquer rosto |
| 7 | `/efrat/marcacoes` | **SIM — a fatia escolhida pelo Arquiteto** | bater ponto é o teste-fim que o cliente valida |
| 9 | `/efrat/rh/dados` | **PROVÁVEL** | RH normalmente confere no painel que a marcação chegou — não confirmado que vão olhar amanhã, mas é o próximo clique natural |
| 4 | `/efrat/identificar` | **TALVEZ** | só entra se o rosto não estiver na galeria offline do aparelho (fallback 1:N) — não é caminho garantido no dia 1 |
| todas as outras (5,6,10-14,16-17,19-24,25) | **NÃO** | cadastro de face por convite/RH, gestão de equipe/colaborador, ajuste manual, revogação — fluxo de operação contínua, não o teste de amanhã |

**Se o prazo apertar, cortar por aqui: as 8 marcadas SIM/PROVÁVEL primeiro (na
ordem da tabela), o resto depois.** `/efrat/identificar` fica em standby —
perguntar ao Orquestrador se o teste de amanhã inclui reconhecimento de
gestor (sessão) ou só ponto de colaborador comum.

---

# Inventário das 25 rotas — fonte: tests/e2e/servidor-falso.js (linhas 554-1727)

Contagem: **25 rotas** confirmadas (bate com "25 rotas do contrato" da decisão).
Path real do cliente é `apiBase + '/efrat/...'`, e `apiBase` de produção =
`https://n8n.samasc.com.br/webhook` (js/config.js:24, publico/js/config-face.js:11).
**O prefixo `/webhook/` NÃO é parte do path da rota — é o path do n8n embutido em
`apiBase`.** A API própria decide seu próprio `apiBase` (provavelmente sem
`/webhook`, isso é escopo do DevOps/API-2, origem nova). As rotas abaixo estão
listadas pelo path pós-`/efrat` (ex.: `/efrat/carga`), que é o que importa pra
porta.

## Cross-cutting (aplicam a várias rotas, não repetido em cada uma)

**Envelope de erro** — `erro(codigo, mensagem, campo?)`:
```json
{ "ok": false, "erro": { "codigo": "...", "mensagem": "...", "campo": "..."? }, "request_id": "<uuid>" }
```
Duas rotas legadas fogem do padrão (erro como STRING, sem `erro.codigo`):
gate de token genérico com token v2 (`{ok:false, erro:"token invalido"}`) e
`/efrat/rh/*` com usuario/chave errados (`{ok:false, erro:"usuario ou senha invalidos"}`).
Várias respostas 404 "não encontrado" dentro de `/rh/*` também usam esse formato
antigo (`{ok:false, erro:'pessoa nao encontrada'}` etc.) em vez de `erro()` —
**preservar exatamente**, não normalizar para o formato novo.

**CORS** — todas as rotas: `Access-Control-Allow-Origin: *`. EXCEÇÃO: as duas
rotas públicas de convite (`/efrat/face/convite/abrir` e `/enviar`) usam origem
de LISTA (allowlist), nunca `*`, sem `Allow-Credentials` — função `responderFace`
separada de `responder`. OPTIONS preflight tem tratamento dedicado pras duas
rotas de convite (Allow-Methods: POST, OPTIONS; Max-Age 600) vs genérico pro
resto (GET, POST, OPTIONS).

**Idempotência (Idempotency-Key)** — duas variantes:
1. Chave no CORPO (`body.idempotency_key`), helper `idempotente(chave, corpo, obrigatoria=true)`:
   usada por TODAS as rotas de escrita em `/rh/*` (equipe update é exceção — não usa).
   Rotas que usam: colaborador/inativar, colaborador/reativar, aparelho/aprovar,
   aparelho/recusar, aparelho/revogar, face/cadastrar, face/convite (emitir),
   face/convite/revogar, face/convite/enviar (a pública).
   Sem chave + obrigatória → 400 `IDEMPOTENCIA_AUSENTE`. Chave repetida + corpo
   diferente → 409 `IDEMPOTENCIA_CONFLITANTE`. Chave repetida + mesmo corpo →
   replay do status+resposta gravados (cache).
2. Chave no HEADER (`Idempotency-Key`) — usada só por `/efrat/gestor/ajustar`
   (checagem manual, não usa o helper `idempotente()`) e `/efrat/face/convite/enviar`
   (usa o helper, mas lê a chave do header, não do corpo — único caso misto).

Repo: `lerIdempotencia(chave)` / `gravarIdempotencia(chave, registro)`. LIMITE
CONHECIDO documentado em nucleo/repositorio.js:427-433 — ler-e-depois-gravar,
mantido de propósito na extração (decisão de contrato, não bug a corrigir aqui).

**Gate de autenticação genérico** (antes de qualquer rota `/webhook/efrat/*`
processar, exceto as listadas como exceção): se path não é `/rh/*`, não é
`dispositivo/registrar`, não é uma "rota v3 autenticada" (estado, identificar,
gestor/*) e não é convite público → exige `body.token === estado.token` OU
`dispositivo_id` válido com bearer correto. As rotas "v3 autenticadas" e as
`/rh/*` fazem SUA PRÓPRIA checagem de auth dentro do bloco (bearer de
dispositivo, ou usuario+chave de RH). Isso importa pro nucleo: não existe UM
middleware de auth único — há 3 esquemas diferentes (token legado/dispositivo
no corpo, bearer de dispositivo, usuario+chave de RH, bearer de sessão de
gestor, bearer de token de convite) cada um resolvido no ponto de uso.

**`registrarDecisaoRh`** (METODOS.auditoria) — **não encontrei nenhuma chamada
correspondente em servidor-falso.js.** O mais próximo é `estado.decisoes.push`
em `/rh/decidir` (linha 1227), que é uma lista solta, sem relação óbvia de
nome com `registrarDecisaoRh`. Ambiguidade a levar ao Orquestrador/Arquiteto:
ou `registrarDecisaoRh` mapeia pra esse `decisoes.push`, ou é método órfão na
interface (verificar quando o Arquiteto entregar nucleo/casos ou dominio.js).

---

## 1. POST /efrat/dispositivo/registrar
Auth: nenhuma prévia (rota isenta do gate genérico) — mas dentro da rota, se
`Authorization: Bearer <token legado>` vier, checa contra `estado.token`.
Rate limit: por IP, janela 60s (config), limite 10 (config) → 429 `LIMITE_CADASTRO`
+ header `Retry-After`.
Corpo: `{ dispositivo_id, credencial_publica, apelido, ua, geo? }`. Faltando
qualquer um dos 4 primeiros → 400 `CORPO_INVALIDO`.
Três ramos:
- **Token legado presente** (migração piloto→v3): errado → 401
  `TOKEN_LEGADO_INVALIDO`; já consumido → 409 `TOKEN_LEGADO_CONSUMIDO`; ok →
  cria dispositivo já `ativo`, equipes_ids `['eq-1']` fixo (comportamento
  legado hardcoded, preservar), 200 `{ok, estado:'ativo', migrado:true, dispositivo_id, request_id}`.
  Repo: `consumirTokenLegado()` (ATOMICO) + depois grava o dispositivo migrado
  (provavelmente `inserirDispositivoSeAusente` com estado já ativo, ou um
  campo dedicado — a ordem real importa: se `consumirTokenLegado` já é
  atômico e exclusivo, a escrita do dispositivo pode vir depois sem correr
  risco extra, MAS isso é uma composição de duas operações que eu não devo
  decidir sozinho se deve ser uma transação — perguntar).
- **Dispositivo já existe**: credencial diferente → 409 `DISPOSITIVO_CONFLITO`;
  mesma credencial e ainda `pendente` → incrementa tentativas/`ultimo_pedido_em`,
  202 `{ok, estado, dispositivo_id, codigo_curto, consultar_apos_s, request_id}`.
  Repo: `inserirDispositivoSeAusente` retorna `inserido:false` + linha
  existente — rota decide 202 vs 409 a partir disso; o incremento de
  tentativas em cima da linha existente usa `atualizarDispositivo`.
- **Novo dispositivo**: gera código curto único (até 3 tentativas; sem
  espaço → 503 `CODIGO_INDISPONIVEL`), monta linha completa (pendente_id,
  ip_hash, etc.), 202 `{ok, estado:'pendente', dispositivo_id, codigo_curto, consultar_apos_s, request_id}`.
  Repo: `inserirDispositivoSeAusente` (ATOMICO — grava linha + reserva
  código curto na mesma operação, por isso a interface faz `novoCodigoUnico`
  virar responsabilidade de quem chama, mas a ESCRITA é atômica).

## 2. POST /efrat/dispositivo/estado
Auth: bearer de dispositivo (`dispositivoAutenticado`, por `dispositivo_id` do
corpo + header Authorization) — rota "v3 autenticada", fora do gate genérico
de token. Falha → 401 `CREDENCIAL_INVALIDA`.
Se `pendente`: se código expirado (>24h, configurável), gera novo código único
e atualiza a linha (efeito colateral em GET-like — comportamento a preservar).
200 `{ok, estado:'pendente', codigo_curto, consultar_apos_s, request_id}`.
Se não `ativo` (revogado/negado): 200 `{ok, estado, request_id}` (SEM dados de
dispositivo).
Se `ativo`: 200 `{ok, estado:'ativo', dispositivo:{dispositivo_id, apelido,
equipes_ids, configuracao_versao}, request_id}`.
Repo: `lerDispositivo`, e se renovar código, `renovarCodigoCurto` (ATOMICO) —
NÃO `atualizarDispositivo` genérico, porque troca `codigo_curto` tem invariante
de corrida própria.

## 3. POST /efrat/carga
Auth: dois modos no MESMO path. Sem `dispositivo_id` no corpo → sem auth,
devolve carga fixa de demo (`carga()`, função pura — NÃO deve mover pro
repositório, é dado estático de seed/demo, provavelmente nem sobrevive na
API real; confirmar com Orquestrador se esse ramo "sem dispositivo_id" existe
em produção ou é só artefato de teste). Com `dispositivo_id` → bearer de
dispositivo obrigatório, 401 `CREDENCIAL_INVALIDA` se falhar.
Com dispositivo: `pendente` → 403 `DISPOSITIVO_PENDENTE`; não-ativo → 403
`DISPOSITIVO_INATIVO`; sem equipes → 403 `DISPOSITIVO_SEM_ESCOPO`. Se
`body.modelo_id` vier, chama `definirReferenciaModeloApp` (ÚNICO caminho que
move a referência de modelo — nunca as rotas de cadastro). 200 com
`versao` (=configuracao_versao), `gerado_em`, `escopo.equipes_ids`, `pessoas`
filtradas por equipe+ativo com `template{versao,vetores}`+`miniatura`,
`removidos_ids:[]` (sempre vazio no fake — provavelmente placeholder de
funcionalidade não implementada, PERGUNTAR se a API real precisa calcular
isso de verdade ou se `[]` é aceitável por ora), `request_id`.
Repo: `lerDispositivo`/auth, `definirReferenciaModeloApp`, `listarPessoas`
(ou uma leitura filtrada — repositório não tem `listarPessoasPorEquipes`,
então o filtro é lógica de rota sobre `listarPessoas()`).

## 4. POST /efrat/identificar
Auth: bearer de dispositivo, 401 `CREDENCIAL_INVALIDA`. Dispositivo não-ativo
→ 403 `DISPOSITIVO_INATIVO`. `descritor` inválido (não array de 128 números
finitos) → 400 `DESCRITOR_INVALIDO` (campo `descritor`).
Rate limit por `dispositivo_id`, janela 60s/limite 20 (config) → 429
`LIMITE_IDENTIFICACAO` + Retry-After; **e grava auditoria mesmo no limitado**
(`resultado:'limitado'`) — ordem importa: audita ANTES de responder 429.
Calcula distância euclidiana contra todas pessoas ativas, pega a menor;
`reconhecido = distancia < 0.45` (limiar fixo aqui, MESMO valor de
`limiarAceiteCadastro` default — mas hardcoded 0.45 nesta função, não usa
`opts.limiarAceite`; **divergência a checar com o Arquiteto**: cadastro é
configurável via opts, identificação está fixa em 0.45 — preservar como está,
não "consertar" a inconsistência sem perguntar). Grava
`registrarAuditoriaIdentificacao` SEMPRE (reconhecido ou não).
Não reconhecido → 200 `{ok, resultado:'nao_reconhecido', request_id}`.
Reconhecido → 200 com `pessoa{pessoa_id,nome,equipe_id,papel}`, `distancia`,
`pode_registrar:true`, `fora_do_escopo_offline` (bool). Se papel=gestor E
distancia<0.45 (redundante com o `reconhecido` já checado — repetição
literal no código-fonte, não decisão minha mudar): cria sessão de gestor
(token 256 bits, expira 10min absoluto + 5min inatividade deslizante),
adiciona `sessao_gestor` + `sessao_expira_em` na resposta.
Repo: `lerDispositivo`(auth), `contarNaJanela`(rate limit, balde
`identificacao`), `registrarAuditoriaIdentificacao`, `listarPessoas`,
`criarSessaoGestor`.

## 5. POST /efrat/gestor/equipe-hoje
Auth: bearer = token de sessão de gestor (`sessaoGestorValida` — lê+valida+
renova atividade). Inválida/expirada → 401 `SESSAO_EXPIRADA`.
`data_local` precisa casar `/^\d{4}-\d{2}-\d{2}$/` → senão 400 `DATA_INVALIDA`
(campo `data_local`).
Filtra pessoas por `sessao.equipes_ids` + ativas; para cada uma, acha a
ÚLTIMA marcação do dia (`marcado_em` prefixo igual à data), deriva
`estado` (`ausente`/`em_intervalo`/`em_jornada`) por `tipo` da última
marcação. Resposta 200: `resumo{em_jornada,em_intervalo,ausentes}` +
`pessoas[]` com `ultima_marcacao{tipo,em}|null`.
Repo: `lerSessaoGestor`, `listarPessoas`, `listarMarcacoes` (filtrado em
memória por pessoa+dia — repositório não tem query dedicada).

## 6. POST /efrat/gestor/ajustar
Auth: mesma sessão de gestor. `pessoa_id` fora do escopo/inexistente/inativa
→ 403 `PESSOA_FORA_DO_ESCOPO`.
Idempotency-Key no HEADER, obrigatória (checagem manual, não usa o helper
`idempotente()` do corpo) → sem ela, 400 `IDEMPOTENCIA_AUSENTE`; conflito →
409 `IDEMPOTENCIA_CONFLITANTE`; repetida → replay do status/resposta.
`acao` precisa ser uma de `incluir_marcacao|alterar_marcacao|excluir_marcacao`
e `motivo` ≥10 chars → senão 422 `AJUSTE_INVALIDO`. Se `acao!='incluir'` e
`marcacao_id` não existe → 404 `MARCACAO_NAO_ENCONTRADA`.
Cria registro em `correcoes` (não em `marcacoes` — é uma PROPOSTA, estado
`pendente_rh`), 202 `{ok, estado:'pendente_rh', correcao_id, criado_em, request_id}`.
Repo: `lerSessaoGestor`, `lerPessoa`/`listarPessoas`, `lerMarcacao`,
`inserirCorrecao`, `lerIdempotencia`/`gravarIdempotencia` (via header, não
body — a rota terá que chamar os métodos de idempotência direto, não usar
um helper genérico que assume corpo).

## 7. POST /efrat/marcacoes  ⭐ rota mais crítica (dedup)
Auth: gate genérico (token OU bearer de dispositivo). Latência artificial
`opts.latenciaMs||60` (SÓ TESTE — não portar).
NUNCA responde 403 por estado de aparelho — sempre 200 item a item.
Para cada item do lote `body.marcacoes[]`:
1. Campos obrigatórios ausentes (`id_cliente`,`pessoa_id`,`marcado_em`) →
   item `{status:'rejeitado', motivo:'campos obrigatorios ausentes'}` (SEM
   motivo_codigo aqui — divergência de forma vs os outros rejeitados,
   preservar).
2. Já existe em `marcacoes` (por `id_cliente`) → `{status:'duplicado', motivo:null}`.
   **Repo: `inserirMarcacaoSeAusente` é quem decide isso atomicamente — a
   checagem manual acima na rota FAKE é check-then-act que a interface
   real existe pra eliminar; a rota real não deve replicar esse padrão,
   deve chamar `inserirMarcacaoSeAusente` direto e ler `inserida:false`.**
3. Estado do aparelho (`resultadoPorEstadoAparelho`, função pura já
   exportada) → se não-null: monta item com campos extras de auditoria de
   aparelho; se `status==='retido'`, GRAVA (`inserirMarcacaoSeAusente`) e
   incrementa `incrementarRetidasPosRevogacao`; se `rejeitado`, NÃO grava.
4. Estado da pessoa (`resultadoPorEstadoPessoa`, função pura) → análogo:
   `retido` grava, `rejeitado` não.
5. Caminho normal: `requer_revisao` calculado (veredito≠aceito OU
   origem=manual OU papel=gestor OU deriva_relogio>120s), grava via
   `inserirMarcacaoSeAusente`, `status:'aceito'`.
Resposta 200: `{ok, servidor_hora, resumo{aceitas,duplicadas,retidas,rejeitadas}, resultados[]}`.
Repo: `lerDispositivo` (dispositivoDoLote — SÓ leitura, não `dispositivoAutenticado`
de novo, já autenticado no gate), `inserirMarcacaoSeAusente` (ATOMICO, chamada
ÚNICA por item que vai persistir — funde a checagem de duplicata com a escrita),
`incrementarRetidasPosRevogacao`, `listarPessoas`/`lerPessoa`.
**`resultadoPorEstadoAparelho`/`resultadoPorEstadoPessoa`/`FRASES_MOTIVO` são
funções PURAS já exportadas do arquivo — devem ir para o núcleo tal como
estão (mesma assinatura), não reimplementar.**

## 8. POST /efrat/rh/sal
Auth: NENHUMA (rota pública dentro do bloco /rh/ — está ANTES da checagem
usuario+chave, que só roda pra outras rotas /rh/*). Só devolve
`{ok:true, sal, iteracoes}` do usuário de RH fixo (usuário único, sem
parâmetro — pega direto de `rhUsuario`). Repo: `lerUsuarioRh` — mas com QUE
usuário, se a rota não recebe `usuario` no corpo? No fake há só 1 usuário de
RH fixo; a API real provavelmente recebe `usuario` no corpo mesmo aqui.
**Perguntar**: o fake não expõe isso porque só testa 1 usuário — checar
docs/fase3-contrato.md pra ver se `/rh/sal` espera `{usuario}` no corpo real.

## 9-19. POST /efrat/rh/* (dados, equipe, colaborador[/inativar|/reativar],
decidir, aparelho/{aprovar,recusar,revogar}, aparelhos, face/cadastrar,
face/convite[/s|/revogar])
Auth comum a todas (checada uma vez no bloco pai): `body.usuario ===
rhUsuario.usuario && body.chave === rhUsuario.chave` → senão 401
`{ok:false, erro:'usuario ou senha invalidos'}` (formato ANTIGO, sem
`erro.codigo` — preservar). Repo: `lerUsuarioRh(usuario)` devolve
`{usuario,nome,sal,iteracoes,chave,ativo}` e a ROTA compara a chave (a
comparação em si — hash vs valor — é responsabilidade da rota, repositório só
lê o registro).

### 9. /rh/dados
Sem idempotência, sem corpo de escrita. Monta: `marcacoes` (todas, com
`pendente`/`marcado_dia` derivados), `pessoas` (com `telefone_compartilhado`
via `telefonesCompartilhados()` de js/regras.js — FUNÇÃO PURA compartilhada
com o cliente, não reimplementar), `equipes` (todas), `recadastros` (SEM o
campo `coerencia` — removido de propósito na leitura, nunca na escrita),
`aparelhos_pendentes` (contagem), `servidor_hora`, `periodo_dias` (=`body.dias||30`,
mas não filtra nada por ele no fake — **CUIDADO**: parâmetro aceito mas
NUNCA aplicado ao filtro de marcações no fake; preservar esse comportamento
"declarado mas não filtra" ou é bug do fake que a API real deveria corrigir?
**Perguntar** — pode ser um limite conhecido do piloto, não meu para decidir).
Repo: `listarMarcacoes`, `listarPessoas`, `listarEquipes`, `listarRecadastros`,
`listarDispositivos` (contar pendentes).

### 10. /rh/equipe (criar OU atualizar, mesmo path)
Com `equipe_id` → atualizar: nome (valida 2-60 chars, dedup case-insensitive
entre ativas) → 422 `NOME_INVALIDO` / 409 `EQUIPE_DUPLICADA`; `unidade` livre;
`ativo:false` com membros ativos → 422 `EQUIPE_COM_MEMBROS` +
`membros_ativos:N`; inativar de fato remove a equipe do escopo de TODOS os
dispositivos que a tinham e incrementa `configuracao_versao` de cada um
(side-effect em cascata — repo: `removerEquipeDoEscopoDosDispositivos`).
Sem `equipe_id` → criar: mesma validação de nome, `EQUIPE_DUPLICADA` se
colidir. Repo: `lerEquipe`, `atualizarEquipe` (ATOMICO — `renomeada:false` se
colidiu) / `inserirEquipeSeNomeLivre` (ATOMICO), `removerEquipeDoEscopoDosDispositivos`.
Note: rota FAKE faz check-then-act pro nome duplicado (`.some()` antes de
gravar) — a rota real deve usar o `inserida:false`/`renomeada:false` do
método atômico, não replicar o check manual.

### 11-12. /rh/colaborador/inativar e /reativar
Idempotência por CORPO (`body.idempotency_key`, helper padrão, obrigatória).
`pessoa_id` não existe → 404 `{ok:false,erro:'pessoa nao encontrada'}`
(formato antigo). Já no estado pedido → NO-OP (idempotente sem checar versão).
Senão: version check (`body.versao_cadastro !== pessoa.versao_cadastro`) →
409 `CADASTRO_DESATUALIZADO` + `registro_atual` (pessoa serializada via
`pessoaParaResposta`). Reativar exige telefone válido
(`validarTelefoneOuDuplicado`, pode devolver 422 TELEFONE_* ou 409
TELEFONE_DUPLICADO). Inativar exige `motivo` 10-500 chars → 422
`MOTIVO_INVALIDO`; ZERA vetores/miniatura (biometria descartada). Ambos
incrementam `versao_cadastro`.
Repo: `lerPessoa`, `atualizarPessoaSeVersao` (ATOMICO — compare-and-set com
`versaoEsperada`; a rota real usa o `trocado:false` do repo pra devolver
409+registro_atual, em vez do check manual do fake).
Resposta 200: `{ok, pessoa_id, ativo, versao_cadastro}`.

### 13. /rh/colaborador (criar OU editar)
`ativo` no corpo → sempre 400 `CAMPO_NAO_EDITAVEL` (campo `ativo`) — usar
inativar/reativar. Campos derivados (`tem_biometria`,`sem_equipe`,
`miniatura`,`telefone_compartilhado*`) no corpo → 400 `CAMPO_DERIVADO`.
Com `pessoa_id` → editar: version-check igual acima (409
`CADASTRO_DESATUALIZADO`); `matricula` só pode mudar se pessoa NUNCA
marcou ponto (senão 422 `MATRICULA_IMUTAVEL`); telefone opcional (só valida
se `body.telefone !== undefined`); `equipe_id`/`papel` livres (inclusive
`null` em equipe_id — "sem equipe é estado válido"). Incrementa
`versao_cadastro`.
Sem `pessoa_id` → criar: nome+matricula obrigatórios, telefone validado
(não opcional na criação), gera `pessoa_id` novo.
Repo: `lerPessoa`, `atualizarPessoaSeVersao` (ATOMICO) / `inserirPessoa`.

### 14. /rh/decidir
`id` obrigatório → 422 sem código (`{ok:false,erro:'id obrigatorio'}`,
formato antigo). Registra em `estado.decisoes` (ver ambiguidade
`registrarDecisaoRh` no topo do doc). Se `tipo==='template'`: remove de
`recadastros` por `template_id` (repo: `removerRecadastro`). Senão: acha a
marcação por `id`, seta `veredito:'aceito', origem:'biometria',
requer_revisao:false` (repo: `atualizarMarcacao`). Sem validação de `tipo`
nem de existência antes de agir (se `id` não bate em nada, silenciosamente
não faz nada e ainda devolve 200 — **preservar**, não virar 404).

### 15. /rh/aparelho/aprovar  ⭐ prova de posse, rate-limited
Idempotência por corpo. Rate limit por USUÁRIO de RH (não por aparelho):
10 tentativas erradas/5min → 429 `LIMITE_APROVACAO` + Retry-After (calculado
da tentativa mais antiga na janela) — **e AUDITA mesmo bloqueado**
(`registrarAuditoriaAprovacao('limitado')`) ANTES do idem-check acontecer
de novo (idem já rodou antes deste bloco, então idempotência tem prioridade
sobre rate-limit).
Normaliza código (upper, remove espaço/traço); letra fora do alfabeto
(O,I,L,0,1 ou não-alfanumérico) → 422 `CODIGO_COM_LETRA_INVALIDA` (audita
`letra_invalida`, SEM contar como tentativa errada de rate-limit — checagem
estática não conta pro limite, achado do QA citado no comentário).
Código vazio, ou não resolve pra dispositivo pendente não-expirado → 404
`CODIGO_NAO_ENCONTRADO` (mensagem deliberadamente ambígua — não distingue
"nunca existiu" de "expirou" de "já foi usado", contra oráculo de força
bruta); CONTA como tentativa errada + audita `codigo_nao_encontrado`.
`equipes_ids` vazio → 422 `ESCOPO_VAZIO` (audita `escopo_vazio`, com
`pendente_id`, NÃO conta tentativa errada de rate-limit — só código errado
conta). Equipe inválida/inativa → 422 `EQUIPE_INVALIDA` (audita
`equipe_invalida`). Equipes de unidades diferentes → 422
`EQUIPES_DE_UNIDADES_DIFERENTES` (audita `equipes_de_unidades_diferentes`).
Sucesso: ATIVA o dispositivo (SÓ por código, nunca por id), `unidade`
DERIVADA da equipe (nunca do corpo), audita `'aprovado'` com `pendente_id`.
Repo: `aprovarDispositivoPorCodigo` (ATOMICO compare-and-set —
`codigo=..., estado=pendente, criado_em>criadoDepoisDe`), `lerEquipe`/
`listarEquipes`, `registrarTentativaErrada`+`tentativasNaJanela` (rate
limit, balde `aprovacao_rh` por usuário), `registrarAuditoriaAprovacao`.
**Nota**: CODIGO_AMBIGUO (409) existe no contrato mas é estruturalmente
impossível no fake (Map por código) — só existe com banco real com
possível colisão; a rota real PRECISA desse caminho mesmo sem teste pra
provar, porque `aprovarDispositivoPorCodigo` real pode ter índice não-único
até a migration do API-3 garantir unicidade — **confirmar com API-3/Arquiteto**.

### 16. /rh/aparelho/recusar
Idempotência por corpo. Resolve por `pendente_id` (NUNCA dispositivo_id —
defesa em profundidade). Não encontrado → 404 `PENDENTE_NAO_ENCONTRADO`
(campo `pendente_id`). Já `ativo` → 409 `APARELHO_JA_ATIVO`. Já `negado` →
NO-OP idempotente (não regrava `recusado_por`/`recusado_em`/`motivo_decisao`
de novo). Repo: `lerDispositivoPorPendenteId`, `trocarEstadoDispositivo`
(ATOMICO, `de:['pendente'], para:'negado'`).

### 17. /rh/aparelho/revogar
Idempotência por corpo. Resolve por `dispositivo_id`. Não encontrado → 404
`APARELHO_NAO_ENCONTRADO`. Nem ativo nem já revogado → 422
`APARELHO_NAO_ATIVO`. Já revogado → NO-OP idempotente. Revogar: zera
`equipes_ids`, grava `revogado_em` (âncora da janela de 30 dias),
`retidasPosRevogacao:0`. Repo: `lerDispositivo`, `trocarEstadoDispositivo`
(ATOMICO, `de:['ativo','revogado'], para:'revogado'`).

### 18. /rh/aparelhos (listagem)
Sem escrita, sem idempotência. Três listas: `pendentes` (ordenado por
`criado_em`, com `pedidos_da_mesma_rede_1h` calculado por `ip_hash` na
última hora — cross-dispositivo), `ativos` (ordenado por `ultimo_uso` desc),
`encerrados` (negados/revogados dentro de 30 dias — mesma
`JANELA_DRENAGEM_MS` de `/marcacoes`). Repo: `listarDispositivos` (filtra/
ordena tudo em memória na rota — repositório não tem query dedicada por
estado).

### 19. /rh/face/cadastrar
Idempotência por corpo. `pessoa_id` não existe → 404 (formato antigo).
`modelo_id` OBRIGATÓRIO aqui (diferente de `/efrat/cadastro` legado, que
tolera ausência) → 400 `MODELO_AUSENTE`. Avalia lote via `avaliarLoteFace`
(FUNÇÃO PURA de js/coerencia.js, mesma usada em TODAS as rotas de cadastro —
não duplicar) → falha vira 422 com `erro.maior_distancia` extra. Classifica
modelo (`classificarModelo`, local — grava observação + compara à
referência). `origem` = `rh_upload` ou `rh_camera` (default). `rh_camera` →
grava DIRETO em `pessoa` (template ativo imediato, RH está vendo ao vivo).
`rh_upload` → vai pra `recadastros` (fila humana, estado `pendente`, nunca
sobrescreve o vigente). Repo: `lerPessoa`, `atualizarPessoa` (SEM invariante
de versão — campos de template) / `inserirRecadastro`,
`registrarModeloObservado`+`modeloJaObservado`/`lerReferenciaModeloApp`
(via `classificarModelo`).

### 20. /rh/face/convite (emitir)
Idempotência por corpo. `pessoa_id` não existe → 404. Inativa → 422
`PESSOA_INATIVA`. Sem telefone → 422 `PESSOA_SEM_TELEFONE`. Telefone
compartilhado com outra pessoa ativa → 422 `TELEFONE_COMPARTILHADO_SEM_LINK`
(usa `telefonesCompartilhados`, mesma função pura de `/rh/dados`).
"Um convite vivo por pessoa": QUALQUER emitido/aberto anterior vira
`substituido` (não é erro, é substituição automática — a resposta inclui
`substituiu:<id_antigo>` se havia um). Gera token 256-bit CSPRNG, grava só
o HASH (`token_hash`), token claro só aparece nesta resposta, nunca mais.
`url = ORIGEM_PUBLICA + '/#c=' + token`. `telefone_mascarado` calculado
(regex de telefone BR, formato `(DD) X****-NNNN`).
Repo: `lerPessoa`, `listarConvitesVivosDaPessoa` (pra achar os "anteriores"
a substituir — mas a substituição PRECISA ser atômica com a emissão do
novo, senão duas emissões concorrentes podem ambas ver "nenhum vivo" e
nenhuma marca a outra como substituída; **isso não está coberto por
nenhum método ATOMICO da interface — é uma composição que preciso
perguntar ao Arquiteto/Orquestrador antes de implementar**, porque
"emitir substitui os anteriores" não é check-then-act inofensivo — é
exatamente o padrão que a interface existe pra eliminar em outros lugares,
mas aqui não tem um `trocarEstadoConvite` em lote), `inserirConvite`,
`trocarEstadoConvite` (por convite anterior, `de:['emitido','aberto'],
para:'substituido'`).

### 21. /rh/face/convites (listar)
Sem escrita. Devolve todos, com `estado` EFETIVO (calculado na leitura —
`estadoEfetivoConvite`, nunca um valor gravado por timer), SEM `token`/`url`
(nunca vazam depois da emissão). Repo: `listarConvites` +
`estadoEfetivoConvite` como lógica de rota/núcleo sobre `agoraMs` (o
contrato diz "instantes viajam ISO, comparações em ms" — a função pura
provavelmente migra pro núcleo tal como está).

### 22. /rh/face/convite/revogar
Idempotência por corpo. Não encontrado → 404 (formato antigo). Só age se
estado efetivo é `emitido`/`aberto` (revogar um já expirado/consumido/
substituído é NO-OP idempotente, não erro). Repo: `lerConvite`,
`trocarEstadoConvite` (ATOMICO, `de:['emitido','aberto'], para:'revogado'`).

## 23. POST /efrat/face/convite/abrir  (pública, allowlist CORS)
Auth: token de convite via bearer (NÃO usuario+chave, NÃO dispositivo).
Corpo >4KB → 413 `CORPO_GRANDE` (checado ANTES de ler o token — barato
primeiro). Rate limit por IP (volume anônimo, generoso: 300/min config) →
429 `LIMITE_VOLUME` + Retry-After.
Convite não existe OU estado efetivo fora de
`emitido|aberto|consumido` → 404 `CONVITE_INVALIDO` (erro único —
anti-oráculo, não distingue expirado/revogado/substituído/inexistente).
`consumido` → 200 `{ok,estado:'consumido',request_id}` (sem dados da
pessoa — já foi usado, nada a mostrar). `emitido` → marca `aberto` +
`aberto_em` (só na 1ª abertura; reaberturas não regravam nem estendem
janela). Resposta 200: `primeiro_nome`, `fotos_exigidas:3`,
`coerencia_maxima` (=limiarAceiteCadastro), `expira_em`.
Repo: `lerConvitePorTokenHash` (resolve por HASH — token claro nunca entra
no armazenamento nem em busca por igualdade de texto claro, só hash),
`trocarEstadoConvite` (ATOMICO só se for a transição emitido→aberto —
mas MÚLTIPLAS aberturas simultâneas da MESMA pessoa abrindo 2 abas não
devem conflitar feio: a 2ª só precisa ver `aberto` já setado, não é um
compare-and-set que deve falhar "de verdade" — **checar com o Arquiteto se
`trocarEstadoConvite` com `de:['emitido']` e `trocado:false` deve então
reler e tratar como sucesso silencioso, porque isso é diferente do padrão
de "perdedor da corrida não grava nada e responde pelo estado terminal"
usado em todo resto — aqui o estado terminal da corrida AINDA é uma
resposta de sucesso, não um erro**), `contarNaJanela` (volume anônimo).

## 24. POST /efrat/face/convite/enviar  (pública, allowlist CORS)  ⭐ ameaça 1.3
Auth: mesma (bearer = token de convite). Corpo >200KB → 413 `CORPO_GRANDE`.
Rate limit de volume igual à rota acima.
Convite inexistente/estado fora de `emitido|aberto|consumido|bloqueado` →
404 `CONVITE_INVALIDO`.
**Idempotency-Key no HEADER, ANTES de checar estados terminais** — de
propósito: retry com a mesma chave precisa ver a resposta 200 gravada
mesmo depois do PRÓPRIO envio ter consumido o convite (senão vira 409
"consumido" contra o cliente que só está reenviando por causa de rede
instável). Isso é sequência importante: idem-check vem ANTES do check de
`bloqueado`/`consumido`.
`bloqueado` (5 recusas) → 429 `CONVITE_BLOQUEADO`. `consumido` → 409
`CONVITE_CONSUMIDO`.
`modelo_id` obrigatório → 400 `MODELO_AUSENTE`. Miniatura >64KB → 413
`CORPO_GRANDE` (mensagem "miniatura maior que o esperado" — MESMO código
`CORPO_GRANDE`, mensagem diferente da checagem de corpo inteiro; preservar
os dois textos distintos com o mesmo `codigo`).
Avalia lote (`avaliarLoteFace`) → falha: INCREMENTA `tentativas` (recusa é
RETORNO, não consumo — não gasta o link), 5ª recusa seguida → vira
`bloqueado`; resposta 422 com `erro.maior_distancia`.
Sucesso: SEMPRE vai pra `recadastros` como `pendente` (nunca sobrescreve
direto, mesmo sendo o 1º cadastro — humano tem que conferir, ninguém do RH
viu a captura), `origem:'link'`, guarda `convite_id`. Convite vira
`consumido` — ESTE É O compare-and-set que fecha a ameaça 1.3.
Resposta 200: `{ok,estado:'recebido',template_estado:'pendente',coerencia,request_id}`.
Repo: `lerConvitePorTokenHash`, `lerIdempotencia`/`gravarIdempotencia` (via
header, mesmo padrão de `/gestor/ajustar`), `contarTentativaConvite`
(ATOMICO — incrementa e já troca pra bloqueado na mesma operação se bater
o limite), `trocarEstadoConvite` (ATOMICO, `de:['emitido','aberto'],
para:'consumido'` — **ESTE é o compare-and-set mais crítico do sistema
inteiro**, dois envios concorrentes com o mesmo token: um leva
`trocado:true` e grava `inserirRecadastro`; o outro leva `trocado:false` e
DEVE responder 409 `CONVITE_CONSUMIDO` sem gravar nada — releitura do
estado atual, nunca grava em cima do que perdeu a corrida), `inserirRecadastro`.

## 25. POST /efrat/cadastro  (legado, rota antiga do aparelho de campo)
Auth: gate genérico (token OU bearer dispositivo — rota comum, não é v3
autenticada nem convite). Avalia lote (`avaliarLoteFace`). `origem` =
`'gestor'` se `body.origem==='gestor'`, senão `'rh'` (default é RH — ao
contrário do que o nome "rota do aparelho de campo" sugere; **preservar
literalmente**, é o default do fake e o comentário do código confirma que é
proposital: "rota antiga continua existindo só para o aparelho em campo,
origem: gestor").
`pessoa_id` fornecido OU gerado de `matricula` (`'p-' + matricula` ou
random se nem matrícula veio — **gerar ID a partir de matrícula é um
padrão só desta rota legada**, não replicar em outras). `modelo_id`
OPCIONAL aqui (única rota de cadastro que tolera ausência — cliente de
campo antigo). `origem==='rh' && pessoa nova` → grava DIRETO na pessoa
(cria via push, não usa fluxo de `/rh/colaborador` primeiro — cadastro cria
a pessoa junto). `origem!=='rh'` → vai pra `recadastros` pendente (nunca
sobrescreve). Resposta 200 (SEM envelope `ok:false` mesmo em variações —
sempre 200 se passou da validação de coerência): `{ok,pessoa_id,
template_id,versao,status:('ativo'|'pendente'),coerencia,...camposModelo}`.
Repo: `lerPessoa`, `inserirPessoa` (se origem=rh e nova) /
`inserirRecadastro` (senão), `registrarModeloObservado` (se modelo_id veio).

---

## Rotas client-side sem correspondência 1:1 encontrada
Nenhuma — todas as chamadas em js/api.js e publico/js/api-face.js batem
com uma das 25 acima (cross-check por grep, ver comandos usados). n8n/ tem
6 workflows legados que cobrem um SUBCONJUNTO destas mesmas 25 (carga,
marcacoes, cadastro, dispositivo/registrar, dispositivo/estado, e um 6º a
confirmar) — não são rotas adicionais, são a versão n8n de rotas já
listadas acima.

## Resumo de ambiguidades a levar adiante (não decidir sozinho)
1. `registrarDecisaoRh` sem uso óbvio correspondente no fake — mapeamento
   pra `/rh/decidir` incerto.
2. `/efrat/carga` sem `dispositivo_id` (modo "demo fixa") — existe em
   produção ou é só artefato de teste?
3. `/rh/sal` no fake não recebe `usuario` (usuário único fixo) — conferir
   contrato pra ver se a rota real recebe `usuario` no corpo.
4. `/rh/dados`: `body.dias` aceito mas nunca aplicado a filtro nenhum no
   fake — preservar "aceita e ignora" ou é lacuna a fechar?
5. `dispositivo/registrar` com token legado: sequência
   `consumirTokenLegado` + gravar dispositivo migrado — uma operação
   composta, não uma atômica só; ordem/atomicidade certa a confirmar.
6. `/rh/face/convite` (emitir): "substituir convites vivos anteriores" ao
   emitir um novo é uma composição multi-linha sobre `trocarEstadoConvite`
   — corrida entre duas emissões simultâneas pra mesma pessoa não está
   coberta por nenhum método atômico único da interface.
7. `/efrat/face/convite/abrir`: corrida de abertura dupla (duas abas) —
   `trocarEstadoConvite` retornando `trocado:false` aqui deveria ser
   tratado como sucesso silencioso (reler e responder 200), não como erro
   — foge do padrão "perdedor nunca grava, responde erro terminal" usado
   em todo o resto da interface.
8. CODIGO_AMBIGUO (409) em `/rh/aparelho/aprovar`: estruturalmente
   impossível no fake (Map por código), mas pode ser real com banco —
   preciso saber se `aprovarDispositivoPorCodigo` garante índice único em
   `codigo_curto` (a doc da interface diz que sim, "parcial, só onde
   estado=pendente") — se garantido, o caminho 409 nem existe na prática
   e não preciso escrever esse ramo; se não, preciso.
