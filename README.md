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

## As guardas de CI, e por que cada uma existe

Guarda sem motivo escrito é guarda que alguém remove por achar burocrática. Cada
uma abaixo nasceu de um defeito real, e cada uma foi verificada **sabotando a
própria invariante** e confirmando que o CI fica vermelho — não por leitura de
código.

**A versão do cache do `sw.js` acompanha o `ASSETS`.** O caso concreto: dois
ramos mexeram no `ASSETS` e cada um subiu `efrat-ponto-v7` para `v8`. Como a
linha da versão ficou **idêntica** nos dois lados, o git une as duas listas e
**não dá conflito**. O merge sai com um `v8` diferente do `v8` que os celulares
em campo já têm em disco — e como o número não mudou, o service worker não
invalida nada: cache velho e incompleto, sem um aviso. Combinar "conferimos o
número no merge" não resolve, porque nada avisa. A guarda compara o `ASSETS` com
o da base e só exige número novo quando a lista mudou de fato.

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
