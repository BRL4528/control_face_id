# Plano v3 — "a face é a credencial"

Briefing único da rodada. **Leia só este arquivo antes de começar.** Ele existe para
que ninguém precise reler o mockup (74 KB), varrer o repositório ou consultar o n8n
por conta própria. Confirme no código apenas o arquivo que você vai mexer.

## Objetivo do cliente (palavras dele, 19/08/2026)

Empresa de engenharia, várias equipes. A feature de bater ponto com a face já foi
testada e funciona. Agora é **lapidar**:

1. **Tirar o token que o app pede.** O funcionário só bate o ponto — nada de digitar.
2. **Gestor loga com a face**, vê o status atual da equipe e ajusta registro.
3. **RH entra como admin**: ajustes, relatórios, cadastro de face, equipes e locais.
4. **Aplicar o design** dos rabiscos aprovados no Claude Designer.

Backend n8n liberado para alteração pelo cliente ("possui api no n8n então pode
acessar e ajustar no que for necessário").

## Estado atual — o que já existe

### Frontend (PWA estático, sem build, ES modules)
| Arquivo | Papel | Linhas |
|---|---|---|
| `index.html` | shell + CSS inline (l.14-188) + 5 telas: `porta`, `fila`, `rh`, `loginRh`, `pareamento` | 285 |
| `js/app.js` | roteamento das portas, pareamento, boot, superfície de teste `window.__EFRAT` | 171 |
| `js/fila.js` | fila do gestor: identifica, propõe, confirma, comprovante, recadastro, sync do lote | 370 |
| `js/rh.js` | painel do RH: painel/pendências/pessoas/equipes/registros + Chart.js | 585 |
| `js/face.js` | face-api.js: detecção, qualidade, descritor 128d, ROI rastreada | 285 |
| `js/regras.js` | regras puras (tipo da marcação, cooldown, veredito, carga válida) — **coberto pelos testes unitários** | 266 |
| `js/store.js` | IndexedDB: `token`, `carga`, `deriva`, fila offline, eventos | 105 |
| `js/api.js` | `Api` (aparelho, por token) e `ApiRh` (por chave derivada) | 136 |
| `js/cripto.js` | PBKDF2-SHA256 150k iterações no navegador | 18 |
| `js/ui.js` | `$`, `mostrar`, `toast` | 26 |

Testes: `npm run test:unit` (**47**, Node puro) e `npm run test:e2e` (**23**, Playwright com
motor de reconhecimento fingido e `tests/e2e/servidor-falso.js`). **CI verde é
critério de aceite de toda task.**

### Backend n8n (webhooks ativos, base `https://n8n.samasc.com.br/webhook`)
| Workflow | ID | Rotas |
|---|---|---|
| Efrat Ponto · Carga da Unidade | `iykvFQQfkNv4jIxM` | `POST /efrat/carga` |
| Efrat Ponto · Recebimento de Marcações | `RZzyM9O3ybVWwgDL` | `POST /efrat/marcacoes` |
| Efrat Ponto · Cadastro | `Itr2erwEzwpf2Blm` | `POST /efrat/cadastro` |
| Efrat Ponto · Pendências e Decisão | `4CKpxjpsgcDAvijD` | `GET /efrat/pendencias`, `POST /efrat/decisao` |
| Efrat Ponto · Painel RH (leitura) | `ILyS0MQF2HWMmWTD` | `POST /efrat/rh/sal`, `/efrat/rh/dados` |
| Efrat Ponto · Painel RH (escrita) | `omGeaICuugB6xrJZ` | `POST /efrat/rh/equipe`, `/efrat/rh/colaborador`, `/efrat/rh/decidir` |
| Efrat Ponto · Monitor Diário | `A6RSAH9SBb2BSnhj` | cron 19h (inativo) |

Data Tables (projeto `iSQtz4jYvP9BS6nf`):
- `efrat_pessoa` — `pessoa_id, matricula, nome, equipe_id, papel, ativo, equipes_geridas`
- `efrat_equipe` — `equipe_id, nome, unidade, lat, lng, raio_m, ativo`
- `efrat_template` — `template_id, pessoa_id, versao, vetores, miniatura, coerencia, origem, criado_por, status`
- `efrat_dispositivo` — `token, gestor_id, gestor_nome, equipes_ids, descricao, ativo, ultimo_acesso, gestores_ids`
- `efrat_marcacao` — 18 colunas, `id_cliente` é a chave de deduplicação
- `efrat_correcao` — `alvo_tipo, alvo_id, acao, motivo, autor_id, criado_em`
- `efrat_usuario_rh` — `usuario, nome, sal, chave, iteracoes, ativo, ultimo_acesso`

Contrato detalhado: `docs/api-piloto.md`. Fluxo: `docs/fluxo-operacional.md`.

> Os números 19 e 37 que o README anuncia estão desatualizados. O real é 23 e2e e 47
> unitários (conferido por `grep -c '^test(' `). Quem mexer no README nesta rodada corrige.

## Direção arquitetural proposta (a validar na T-ARQ, não implementar antes)

O token digitado é hoje a **única** autenticação de dispositivo. Tirar sem substituto
transformaria `/efrat/carga` em endpoint público que devolve nome + descritor
biométrico de todos os colaboradores. Isso não é opção. Substituto proposto:

**Auto-provisionamento com aprovação do RH — digitação zero no aparelho.**

1. Primeiro acesso: o aparelho gera `dispositivo_id` (UUID) e guarda no IndexedDB.
2. `POST /efrat/dispositivo/registrar { dispositivo_id, apelido, ua, geo }` cria a
   linha em `efrat_dispositivo` com `ativo=false`.
3. A tela mostra **"Aguardando liberação do RH — código ABC-123"** (código curto
   derivado do `dispositivo_id`, só para o RH achar o aparelho na lista).
4. O RH aprova em **Aparelhos**, escolhendo o local/equipes → `ativo=true`.
5. `/efrat/carga` passa a responder para esse `dispositivo_id`. Enquanto pendente:
   `{ ok:false, estado:'pendente' }`.

Ganha-se: nenhum funcionário digita nada, descritor biométrico nunca sai por
endpoint aberto, e o RH controla que aparelho vê que equipe — o que casa com
"o RH define locais".

### R1 — BLOQUEANTE, achado do Revisor em `docs/ameacas-v3.md`

Trocar a autenticação do dispositivo **não reduz exposição nenhuma** enquanto
`/efrat/carga` continuar entregando a unidade inteira. `docs/fluxo-operacional.md:65`
é explícito: o aparelho baixa templates + miniatura + nomes de toda a unidade, e o
filtro por equipe é client-side. Aparelho comprometido = 100% da biometria da unidade,
antes e depois da mudança.

**Decisão do Orquestrador, a detalhar na T-ARQ:** `/efrat/carga` passa a ser escopada
**no servidor** pelas `equipes_ids` do dispositivo aprovado. Isso tem um custo real e
consciente: mata o "buscar na unidade" offline do colaborador remanejado
(`fluxo-operacional.md:69`), que existe para evitar registro manual. Substituto:
`POST /efrat/identificar { dispositivo_id, descritor }` faz o **1:N no servidor** quando
há rede — o descritor do desconhecido sobe, a galeria da unidade nunca desce. Sem rede,
o remanejado cai em registro manual com foto para o RH decidir. Trocamos um caso de
borda offline pela eliminação da cópia integral da biometria em cada celular de campo.

### Decisões que fecham os outros achados do Revisor

- **Prova de posse na aprovação (fadiga de aprovação, achados 1 e 2):** `apelido`, `ua`
  e `geo` são autodeclarados pelo aparelho e não valem como identidade. A aprovação
  exige o **RH digitar no painel o código curto exibido na tela do aparelho**. Quem
  digita é o RH, no painel — o funcionário de campo continua sem digitar nada, que é o
  que o cliente pediu. Mais: rate limit em `/efrat/dispositivo/registrar` por IP e por
  janela, e a lista de pendentes ordenada por chegada com contador de tentativas visível.
- **Face sem liveness autenticando privilégio (achado 3):** a face **nunca** dá acesso
  admin. Ela dá **escopo de gestor** e nada mais: ver o dia da própria equipe e
  **propor** ajuste. Todo ajuste do gestor entra em `efrat_correcao` como pendência que
  o RH aprova — o mesmo caminho do recadastro. O painel do RH continua atrás de
  usuário + senha. Assim um spoof de foto rende, no pior caso, ver o dia de uma equipe
  e propor uma correção que alguém confere. Identificação de gestor exige score abaixo
  de `limiarAceite` (0.45); zona cinzenta não abre painel, só registra ponto.

**Papéis depois da mudança**
- **Colaborador**: uma tela, um botão, câmera, comprovante. Sem login, sem fila do gestor.
- **Gestor**: mesma câmera. Quando o rosto reconhecido tem `papel='gestor'`, aparece
  "Ver minha equipe" → status de hoje (em jornada / intervalo / ausentes) e ajuste de
  registro. Sessão curta, sustentada pela face, não por senha.
- **RH/admin**: mantém usuário + senha (PBKDF2). Ganha locais, aparelhos, espelho de
  ponto, solicitações e relatórios.

**Ponto em aberto para a T-ARQ decidir:** o mockup do PWA tem tela pessoal ("Bom dia,
Camila", banco de horas, histórico, solicitar ajuste). No aparelho compartilhado isso
só existe **depois** do reconhecimento, como sessão pessoal de vida curta que volta
sozinha para a tela de ponto. Definir TTL e o que acontece se o app ficar aberto.

## Design aprovado — sistema extraído do mockup

Fonte: `UI mockups for HR panel.zip` → `Ponto - Mockup.dc.html` (886 linhas, canvas do
Claude Designer com `sc-if`/`sc-for`/`{{ }}`). **Não é para portar o arquivo** — é para
extrair o sistema abaixo. `support.js` é o runtime do editor: ignore.

> Atenção: o mockup nasceu no repo `bio-pdv` e fala "Ponto Coliseu" / "Rede Coliseu" /
> "Portaria 671". **Nada dessa marca entra aqui.** O produto é Control Face ID (Efrat).
> "Portaria 671" só entra se o cliente pedir — não está no escopo desta rodada.

### Tokens
```
--bg:#eceff4        --surface:#fff      --surface-2:#f7f9fc   --surface-3:#fafbfd
--ink:#101a2b       --ink-2:#3d4a60     --muted:#8390a6       --muted-2:#a3adbf
--linha:#e5e9f0     --linha-2:#eef1f6   --linha-3:#dde3ec
--azul:#2d6cdf      --azul-esc:#1f52ad  --azul-bg:#eef3fd
--ambar:#e0a800     --verde:#28a745     --verde-ink:#1f7a45   --verde-bg:#e8f6ee
--vermelho:#dc3545  --escuro:#0e1729    --escuro-2:#0b1220
raio: 9px botão · 14px card · 16-18px card mobile · 20px pílula · 36-46px moldura
```
Tipografia: **Plus Jakarta Sans** 400-800 no texto, **IBM Plex Mono** 400-600 em
**todo número** (hora, KPI, saldo). Números sempre mono — é a assinatura do design.
Escala usada: 10.5 / 11 / 12.5 / 13.5 / 21 / 24 / 26 / 38px.

### Telas do mockup (linha no arquivo, para consulta pontual)
RH: dashboard `51`, pessoas `139`, cadastro de face `178`, espelho `251`,
solicitações `298`, escalas `335`, relatórios `379`.
PWA: home `433`, câmera `492`, sucesso `523`, histórico `553`, espelho `590`,
ajuste `629`.

### Layout RH
Topbar 56px `#0e1729` com marca à esquerda. Sidebar 216px branca, borda
`#e5e9f0`, seção "OPERAÇÃO" em 10px/700/letter-spacing .09em, itens de nav,
e um cartão de aviso no rodapé. Conteúdo `padding:26px 28px 40px`, `gap:18px`.
KPIs em `repeat(5,1fr)`, card branco raio 14, número mono 26px colorido por estado.
Tabelas: cabeçalho `#fafbfd` com 10px/700/letter-spacing .07em em `#a3adbf`,
linhas com borda `#f3f5f9`, avatar quadrado 28px raio 9 em `#eef3fd`/`#2d6cdf`.
Donut de presença: `conic-gradient` com furo branco no meio.

### Layout PWA (mobile real, não moldura de celular)
Fundo `#f7f9fc`. Header branco com saudação + avatar 40px raio 14. Cartão "jornada
de hoje" com pílula de estado. Grid 2 colunas de marcações do dia. Botão primário
56px raio 18 `#2d6cdf` com `box-shadow:0 10px 22px rgba(45,108,223,.32)`.
Tab bar inferior branca. Câmera em tela cheia `#0b1220`: oval tracejado
`stroke-dasharray:20 14` em `#2d6cdf`, instrução, pílula de status ao vivo, e a
linha honesta *"Nenhuma imagem é armazenada, apenas o template biométrico"*.
Sucesso: círculo verde com check, hora mono 38px, cartão COMPROVANTE chave→valor.

**Restrição não negociável:** o app é PWA offline-first. Fonte do Google **não** pode
ser `<link>` para `fonts.googleapis.com` — precisa ser auto-hospedada em `vendor/` e
cacheada no `sw.js`, com fallback de sistema. Vale para as duas famílias.

## Regras de trabalho desta rodada

- Cada agente trabalha no **seu worktree**. Não mexa em arquivo que é de outra task.
- `npm run test:unit && npm run test:e2e` verde antes de mover o cartão para `review`.
- Mudança no n8n: **duplique o workflow ou versione**, nunca edite um ativo sem antes
  registrar no cartão o que muda. Os 6 webhooks estão em produção do piloto.
- Não reescreva `js/regras.js` sem avisar: é o núcleo testado.
- Commit pequeno, mensagem em português, no seu branch.
- Terminou: `central-agentes task move <ID> review` e `central-agentes report` com o
  diff resumido. Dúvida que bloqueia: `central-agentes send --to Orquestrador`.

## Requisito de conteúdo — privacidade da tela compartilhada

Origem: `docs/ameacas-v3.md` e `docs/privacidade-tela-compartilhada.md` (Revisor, T-64668A).
O TTL de sessão do ADR fecha a exposição **depois** que a pessoa se afasta. Não toca a
exposição **durante** o uso legítimo, que é o caso de maior volume: toda marcação numa
fila ocupada, todo dia. Regras para quem implementa tela:

1. **Primeiro estado pós-reconhecimento só mostra comprovante.** Nome, tipo, hora e nada
   mais. Saldo de banco de horas, histórico e espelho exigem toque explícito.
2. **Tamanho de fonte é decisão de privacidade, não só de estética.** Mono e
   `tabular-nums` valem para todo número — isso não muda. Corpo **grande** só para número
   que qualquer um pode ler: hora da marcação, contador da fila, KPI agregado do painel do
   RH. Saldo, histórico e nome completo em corpo pequeno. Legibilidade a distância é
   exatamente o que não se quer no saldo do colega.
3. **O painel do gestor não abre automático.** O reconhecimento do gestor marca o ponto
   dele e mostra um link discreto "ver minha equipe", que exige toque.
4. **Quando abre, abre agregado.** "Em jornada 8 · intervalo 2 · ausentes 1" primeiro.
   Nome individual só num segundo toque, e a lista de **ausentes antes da de presentes** —
   é o que o gestor precisa saber. Assim o uso comum não expõe o dia de ninguém ao grupo
   reunido, e o caso que precisa de nome exige ação deliberada, que o gestor pode dar de
   costas para a fila.

Critérios de aceite destes itens são verificação no DOM, não inspeção visual — não há
validação visual disponível nesta esteira.

## Critérios de aceite da tela do colaborador (T-607E5A)

Origem: Revisor, a partir de `docs/ameacas-v3.md` e `docs/privacidade-tela-compartilhada.md`.
São de **segurança e privacidade**, não de estilo. Verificação no DOM e no devtools, não a olho.

1. **Dado sensível não pode estar no DOM antes do toque.** Banco de horas e histórico não
   entram na árvore nem escondidos por `display:none` — quem abre o inspetor lê. Só o
   comprovante no primeiro estado.
2. **Expirar tem de apagar, não sobrepor.** No fim do TTL (90 s inativo / 3 min absoluto) ou
   após 30 s sem visibilidade, o dado sai da memória e do DOM. Se a tela só troca por cima e
   o objeto continua vivo num estado JS, um F12 ou o "voltar" do navegador desenterra.
3. **O código de aprovação do aparelho não pode existir em lugar consultável.** Sem
   `console.log`, sem querystring, sem atributo DOM fora do elemento visível pretendido. Esta
   é a tela onde ele nasce, então é aqui que ele vaza.
4. **Sem resquício entre pessoas.** Aparelho compartilhado processa um após outro: nome, foto
   ou dado da pessoa anterior não podem aparecer no instante da transição. É corrida entre o
   reconhecimento novo e a limpeza do anterior.
5. **Offline e pendente falham fechado.** Sem rede, ou com aparelho ainda pendente, não pode
   existir caminho que caia numa carga antiga em cache e libere marcação sem checagem. O
   critério não é "não trava" — é **"não abre por engano"**.
