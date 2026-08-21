# Control Face ID — Ponto por reconhecimento facial (Efrat)

PWA de marcação de ponto por reconhecimento facial, operado no **celular do gestor da equipe** (aparelho da empresa). O colaborador não instala nada, não tem login: só mostra o rosto.

Backend do piloto em n8n + Data Tables — contrato em [`docs/api-piloto.md`](docs/api-piloto.md). Fluxo operacional em [`docs/fluxo-operacional.md`](docs/fluxo-operacional.md).

[![CI](https://github.com/BRL4528/control_face_id/actions/workflows/ci.yml/badge.svg)](https://github.com/BRL4528/control_face_id/actions/workflows/ci.yml)

---

## Duas portas, dois apps

A tela inicial tem dois botões e nada mais:

```
   REGISTRAR PONTO      → câmera. Nenhum login.
   Acessar              → usuário e senha. Só o RH.
```

O gestor com 20 pessoas na fila e o RH fechando a folha têm pressa de coisas opostas. Uma tela que serve aos dois atrapalha os dois — e "cadastrar colaborador" ao lado de "marcar ponto" é um botão errado a um toque de distância.

## Como funciona um turno

```
1. Gestor toca em REGISTRAR PONTO   → a câmera descobre QUEM segura o aparelho
2. Reconheceu o gestor              → registra o ponto dele e abre a fila da equipe
3. Colaborador olha                 → sistema propõe o nome
4. Gestor confirma                  → comprovante, e já vai para o próximo
```

Sem digitar, sem rolar lista, sem escolher entrada ou saída — o sistema deduz do que a pessoa já tem no dia. O gestor nunca informa quem ele é: o rosto dele é a credencial, e o cooldown impede que reabrir a fila remarque o ponto dele.

## O painel do RH

Atrás de `Acessar`, com usuário e senha: **pendências** (zona cinzenta, manual, ponto do gestor, recadastros), **pessoas**, **equipes**, **registros** com espelho de ponto por colaborador e **indicadores** — com a taxa de registro manual por equipe em primeiro lugar, que é o alarme que antecipa problema de biometria em campo.

A senha nunca trafega: o navegador pede o sal, deriva PBKDF2-SHA256 (150 000 iterações) e envia só a chave.

**Nenhuma operação de campo espera pela internet.** A marcação é gravada no aparelho e confirmada na tela na hora; um processo de fundo esvazia a fila quando houver rede. O único sinal visível é o contador "Na fila".

## Rodando

Precisa de HTTPS — a câmera não funciona em `file://`.

```bash
npm install
npm run serve      # sobe o app + uma API simulada, sem depender do n8n
# abre a URL impressa; token: TOKEN-TESTE
```

Para produção, publique como site estático (sem build). Na Vercel: Framework Preset **Other**, sem build command, output na raiz. **Nenhuma variável de ambiente** — a URL da API fica em `js/config.js` e o token do aparelho nunca entra no bundle.

## Testes

```bash
npm run test:unit   # regras, estáticos e guardas de higiene, em Node puro
npm run test:e2e    # fluxo + offline, navegador com câmera falsa
```

Os números não estão escritos aqui de propósito: eles sobem toda semana e um número
desatualizado no README já fez uma estimativa nascer errada. Rode e veja.

O E2E roda com o **motor de reconhecimento fingido**, de propósito: o que está sob teste é o fluxo que escrevemos, não a biblioteca de terceiros. Assim o CI é determinístico e não depende do rosto de ninguém.

O motor real tem verificação própria em [`tests/e2e/biometria-manual.cjs`](tests/e2e/biometria-manual.cjs), que exige um vídeo com rosto de verdade e por isso fica fora do CI.

O que o E2E cobre, e por que cada um está lá:

| Cenário | Protege contra |
|---|---|
| Primeira marcação é entrada, segunda é saída | tipo errado na folha |
| Cooldown bloqueia repetição | fila registrando a mesma pessoa duas vezes |
| Offline enfileira e sobe depois | perder marcação sem rede |
| Reenvio do mesmo `id_cliente` não duplica | ponto dobrado por retentativa |
| Nunca há dois lotes simultâneos | a deduplicação depende disso |
| Colaborador inativo é rejeitado e retido | demitido marcando com carga velha |
| Ponto do gestor sempre vai para revisão | a única marcação sem conferente |
| Marcação aceita não carrega foto | encher o armazenamento de base64 |
| Remanejado aparece ao trocar o escopo | virar registro manual à toa |
| Sessão sobrevive ao recarregar | gestor preso na tela de login no meio da fila |
| A porta só libera o ponto depois do pareamento | aparelho novo marcando com carga vazia |
| Abrir a fila identifica o gestor e marca o ponto dele | gestor sem registro no próprio turno |
| Reabrir a fila no mesmo minuto não remarca o gestor | ponto dobrado por sair e voltar da tela |
| RH não entra com senha errada | painel aberto a quem tem só o link |
| RH vê a pendência do gestor e decide | marcação sem conferente passando batido |
| Espelho de ponto mostra as marcações do colaborador | fechamento sem rastro por pessoa |

## Estrutura

```
index.html              telas e estilos
js/config.js            configuração de runtime (editável sem rebuild)
js/regras.js            regras puras — é o que os testes de unidade cobrem
js/store.js             IndexedDB: sessão, fila de envio, histórico do dia
js/api.js               chamadas do aparelho e do RH, e o sincronismo da fila
js/face.js              motor: modelos, rastreamento, qualidade, captura
js/cripto.js            derivação PBKDF2 da senha do RH, no navegador
js/ui.js                helpers de tela — $, mostrar, toast, formatação
js/fila.js              app do gestor: identifica, marca, comprova
js/rh.js                painel do RH: pendências, pessoas, equipes, registros
js/app.js               a porta e o roteamento entre os dois apps
vendor/ models/         face-api.js 1.7.15 (@vladmandic) e pesos
tests/                  unidade, fluxo e o servidor falso
docs/                   fluxo operacional, API e as análises técnicas
publico/                Root Directory de OUTRO projeto da Vercel: a origem
                        pública do cadastro de face (ver publico/LEIA-ME.md)
```

## Decisões que valem saber antes de mexer

**Verificação é 1:1 com confirmação, não 1:N cego.** O sistema propõe e o gestor confirma. `FPIR ≈ N × FMR` — a galeria fica restrita à equipe (12 a 20 pessoas); a unidade inteira é baixada só para resolver remanejamento, atrás de um seletor.

**O detector completo só roda quando não há rosto rastreado.** Mesmo padrão do MediaPipe Face Mesh. Medido: 1188 ms → 488 ms por ciclo em ambiente lento.

**O gate de qualidade avalia o quadro que o usuário viu aprovado**, não um novo. Sem esse buffer, o rosto se move entre o "pronto" e a captura, e reprova injustamente.

**A nitidez é medida sobre o rosto reamostrado para 160×160.** Sem normalizar, o mesmo limiar se comporta diferente em cada câmera. Referência: nítido ≈ 48, desfoque forte ≈ 6.

**A deriva do relógio desconta metade da ida e volta.** Sem isso, latência de rede vira "relógio errado" e enche a fila do RH à toa. Acima de 2 minutos de desvio, a marcação vai para revisão.

**O cadeado de envio único fecha no mesmo tique da chamada.** `Api.sincronizar` não é `async` de propósito: se a checagem ficasse antes de um `await`, três chamadas seguidas passariam as três antes de qualquer uma marcar o voo — e a Data Table não tem índice único para segurar o resto. Quem chega no meio recebe a mesma promessa.

**Só sai da fila local o que o servidor confirmou.** `aceito` e `duplicado` somem; `rejeitado` fica retido e visível em Ajustes.

**A foto de auditoria só acompanha marcação que vai para revisão.** Nas aceitas ela não agrega e encheria o armazenamento.

**Não há prova de vida (liveness).** É intencional: foto na tela passa. Serve para justificar liveness certificado ISO/IEC 30107-3 Level 2 no sistema real, onde o adversário é o próprio gestor.

## Não inferir de ausência

Leia isto antes de mexer nas guardas, e antes de escrever teste, campo ou
protocolo novo. É o único princípio que explica todos os defeitos que esta fase
encontrou, e eles apareceram em código, em teste, em infraestrutura, em documento
e no nosso próprio canal de conversa.

**O princípio:** falta de dado não é resultado. Quando algo está ausente — um
atributo, uma base de comparação, um sintoma, uma resposta — o código quase sempre
escolhe o lado otimista sozinho, e ninguém percebe, porque o otimista é o lado
silencioso.

**A regra prática:** todo campo, teste ou protocolo que trate falta de dado como
resultado tem de **dizer qual dos dois lados a falta significa**. Se não disser,
alguém vai ler a ausência como confirmação.

O que reconhecer, com três exemplos de formas diferentes:

**No código.** `#btnPonto` (`index.html:29`) nascia sem `disabled`, e só
`irParaPorta()` (`js/app.js:53`, alcançável apenas com aparelho **ativo**) o
desabilita. `toBeEnabled()` então passava com aparelho pendente, com aparelho
aprovado, e antes de a página decidir coisa alguma — era o sinal de aceite de
aprovação de aparelho em sete pontos, e não verificava nada. A ausência do
atributo foi lida como "está habilitado porque pode".

**Dentro do próprio detector**, que é o caso que fecha o argumento. A guarda de
conteúdo do `sw.js` (`.github/workflows/ci.yml:119`) tratava "não há base para
comparar" como "nada a verificar" e saía **verde**. Ou seja: a comparação podia
parar de acontecer e a guarda continuaria dizendo que estava tudo bem. Hoje a
ausência de base só é aceitável no evento que legitimamente não tem base, e nos
outros ela **falha dizendo qual evento era**.

**Num documento operacional.** Os dois hostnames (`publico/LEIA-ME.md`) precisam
ser nomes distintos. Trocar um pelo outro ao substituir texto faz as duas origens
virarem uma, o `IndexedDB` (`js/store.js:10`) volta a ser compartilhado, e **nada
acende** — a página continua funcionando. A ausência de sintoma seria lida como
isolamento em pé.

O corolário que mais custa caro: **detector que mente é pior que detector
ausente.** Um teste que não existe deixa a pessoa desconfiada; um teste verde que
não mede nada compra confiança que não foi ganha. Vale igual para um hash
calculado sobre bytes que o aparelho nunca recebeu, e para uma linha de conversa
onde silêncio significou "está tudo bem".

## Guardar o resultado, não o mecanismo

Irmão do princípio acima, e a pergunta que decide de que lado uma guarda está:
**se alguém refatorasse isto corretamente, a minha assertiva continuaria
passando?** Se uma mudança que preserva o comportamento pode deixar a guarda
vermelha, ela está olhando para a implementação — e o inverso também vale: uma
mudança que quebra o comportamento pode passar.

Foi medido aqui dentro. A guarda que garante que o service worker não alcança a
página pública lia o **texto** do handler e comparava a posição de `FORA_DO_APP`
com a de `respondWith`. Trocar a linha do desvio por
`if (false && (…)) return;` — referência intacta, desvio morto — deixava a guarda
**verde**. Hoje ela executa o handler com `self`/`caches`/`location`/`fetch`
dublados e observa se `respondWith` foi chamado, o que também exige a contraprova:
o service worker **tem** de assumir `/index.html` e os modelos, senão a guarda
passaria por vacuidade e o app perderia o offline sem ninguém notar.

O mesmo par aparece na guarda do `apiBase`: ela não verifica que existe um
`Object.assign`, nem que a linha injetada está presente — ela executa o
`js/config.js` servido e lê o `window.EFRAT_CFG.apiBase` **resolvido**. Duas URLs
no arquivo é o estado normal e correto, então presença de string não diz nada; o
que importa é qual sobrevive.

Guarda de propriedade sobrevive à refatoração. Guarda de implementação vira
mentira na primeira limpeza — **e continua verde enquanto mente**, que é o que a
torna pior que guarda nenhuma.

## Conserto que apaga a prova

O terceiro modo de falha, e ele não é verde falso nem alarme falso: é trocar uma
assertiva por outra que **parece** equivalente e não prova a mesma coisa. Não
deixa rastro — o teste continua passando, o diff parece bom, o CI fica verde, e o
que se perdeu foi a prova que a assertiva antiga carregava.

**A regra prática:** antes de trocar uma assertiva, diga em voz alta **o que a
antiga provava**, e confirme que a nova prova o mesmo. Se você não consegue
enunciar o que a antiga provava, ainda não entendeu o que está trocando.

`#aguardando` nasce com `class="hide"` (`index.html:51`), e `mostrar()`
(`js/ui.js:17`) é quem remove a classe. Então `not.toHaveClass(/hide/)` sobre
`#aguardando` só passa se o app **ativamente** tirou a classe — a assertiva é
prova de execução, não de aparência. Trocá-la por algo mais bonito levaria a prova
embora, com a sensação de estar melhorando o teste.

**E a distinção que impede o padrão:** melhoria sem risco e conserto de defeito
não são a mesma coisa, e não vão no mesmo cartão. Trocar um `sleep` fixo por uma
espera por sinal, mantendo a mesma prova, é melhoria legítima — mais rápida, sem
número arbitrário. Mas se "melhoria" e "conserto" viajam juntas, cria-se o
precedente de trocar porque *parecia feio*, e a próxima troca leva a prova junto.

## As guardas de CI, e por que cada uma existe

Guarda sem motivo escrito é guarda que alguém remove por achar burocrática. Cada
uma abaixo nasceu de um defeito real, e cada uma foi verificada **sabotando a
própria invariante** e confirmando que o CI fica vermelho — não por leitura de
código.

**A versão do cache do `sw.js` acompanha o que ele pré-cacheia — lista *e*
conteúdo.** O caso concreto: dois
ramos mexeram no `ASSETS` e cada um subiu `efrat-ponto-v7` para `v8`. Como a
linha da versão ficou **idêntica** nos dois lados, o git une as duas listas e
**não dá conflito**. O merge sai com um `v8` diferente do `v8` que os celulares
em campo já têm em disco — e como o número não mudou, o service worker não
invalida nada: cache velho e incompleto, sem um aviso. Combinar "conferimos o
número no merge" não resolve, porque nada avisa. A guarda compara o `ASSETS` com
o  da base e só exige
número novo quando algo mudou de fato.

O segundo caminho para o mesmo estrago é o conteúdo: trocar os **bytes** de um
asset mantendo o nome — pesos em `models/`, `vendor/face-api.js` — não mexe na
lista. Como o handler é cache-first e esses caminhos vão com
`max-age=31536000, immutable`, o aparelho instalado serve o arquivo antigo por
tempo indefinido e o navegador nem revalida. A guarda compara o hash de blob do
git, que já é hash de conteúdo. Isso sustenta o carimbo de identidade do modelo
(T-D30529): um hash calculado no build descreveria bytes que aquele aparelho
nunca recebeu.

**O servidor de teste nunca entrega `apiBase` de produção.** `npm run serve` e
todo o E2E serviam `js/config.js` apontando para o n8n de produção. Efeito
medido: `tests/e2e/offline.spec.js` ficava verde **porque** a chamada falhava —
sem API o app cai em `#porta`, que era o que o teste afirmava. Em qualquer
máquina com rota para o host, runner do CI incluso, o E2E fazia `POST
/dispositivo/registrar` em produção a cada execução. Teste que passa por efeito
colateral de rede fica vermelho no dia em que a rede melhora.

**`_headers` e `vercel.json` declaram exatamente a mesma coisa.** Na Vercel o
`_headers` **não é lido** — quem vale é o `vercel.json`. O repo mantém os dois
porque o `_headers` é a fonte legível e o servidor falso do E2E lê dele; o preço
é que quem editar só o `_headers` **acredita** ter mudado produção e não mudou. A
comparação é exaustiva **por construção** — conjunto inteiro de caminhos, e para
cada caminho o dicionário inteiro de chave→valor — e não uma lista dos
cabeçalhos que alguém lembrou de conferir. Uma paridade que cobrisse só a CSP, ou
só a CSP e o `Cache-Control`, ficaria verde no dia em que o próximo cabeçalho
fosse acrescentado em um lado só, que é exatamente o dia em que produção
divergiria em silêncio.

**O servidor de teste realmente envia a política do `_headers`.** A paridade
acima compara arquivo com arquivo; esta compara o que sai **na resposta**. A
lacuna que fecha: o teste de CSP chama `extrairCspDeHeaders()`, que é função pura
lendo o arquivo — se o servidor falso parasse de *aplicar* os cabeçalhos, aquele
teste continuaria verde e o E2E passaria a validar uma política que não existe.
Nada pegava isso, e o risco é concreto sempre que `servidor-falso.js` é
reescrito.

**Nada no HTML inicial já satisfaz o que um spec espera.** `#porta` nascia sem
`class="hide"` e `#btnPonto` nascia sem `disabled`. Consequência medida em
navegador: `toBeEnabled()` no botão de ponto passava com aparelho **pendente**,
com aparelho aprovado, e antes de a página ter decidido qualquer coisa — e era o
sinal de aceite de aprovação de aparelho em 7 pontos de 6 specs, inclusive no
`aprovarDispositivo()` cuja docstring dizia "sinal de aceite é sempre de tela".
Não verificava nada. Assertiva **negativa** falharia com o flash do boot; é a
**positiva** que passa por engano, e por isso a correção é no HTML e não em cada
spec: aqui a classe inteira de defeito fecha de uma vez, e tela nova nascendo
visível também cai.

**A origem pública é isolada por ausência do arquivo.** `publico/` é o Root
Directory de outro projeto da Vercel e `.vercelignore` o tira do deploy do app.
Se ele voltar para o deploy do app, a página pública volta a estar na **mesma
origem** e alcança o IndexedDB `efrat-ponto` (`js/store.js`) — a credencial de
256 bits do aparelho. Caminho separado nunca foi fronteira: `IndexedDB`,
`localStorage`, `Cache Storage` e cookie isolam por origem, não por caminho.

**Nenhum asset externo em nada que vai ao ar.** Vale para os dois projetos. Uma
fonte remota ou um script de CDN quebra o app offline em campo e adiciona um
terceiro à cadeia de confiança de uma página que coleta biometria.

**Nenhum service worker na origem pública.** Página de uso único não ganha nada
com offline, e um SW ali reintroduziria exatamente o fallback-para-shell que
motivou a origem separada.

## Referências medidas

Mesma pessoa, pose diferente: **0,094** · pessoas diferentes: **0,61** e **0,80** · limiar de aceite: **0,45**.

Adornos, contra o template limpo da mesma foto:

| Adorno | Detectou | Distância |
|---|---|---|
| Boné | 5/6 | 0,169 |
| Capacete de obra | 4/6 | 0,257 |
| Capuz | 4/6 | 0,253 |
| Óculos escuros | 1/6 | 0,422 |
| Máscara | 1/6 | 0,440 |
| Balaclava | 0/6 | não detecta |

Adorno na parte de cima da cabeça não atrapalha. Oclusão de olhos e boca derruba a **detecção** — o sistema falha para o lado seguro, pedindo nova tentativa, em vez de aceitar a pessoa errada.

Detalhes em [`docs/oclusao-e-roteiro.md`](docs/oclusao-e-roteiro.md) e [`docs/validacao-biometrica.md`](docs/validacao-biometrica.md).

## Limites conhecidos

- A deduplicação depende de **envio único em voo** no cliente, porque a Data Table do n8n não tem índice único. Há teste cobrindo isso.
- O servidor **não reconfere a biometria** — a decisão é a que veio do aparelho. Fragilidade conhecida enquanto o adversário for o gestor; resolve quando a extração do embedding migrar para o servidor.
- Uma empresa só, sem isolamento por tenant. Token sem expiração.

Nada disso é acidente: o piloto existe para medir FNMR, FTA, latência e taxa de registro manual em campo.

## Licença dos modelos

face-api.js é MIT ([@vladmandic/face-api](https://github.com/vladmandic/face-api)). Os pesos vêm do pacote npm oficial.
