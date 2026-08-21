# Checkpoint · Orquestrador · FASE 3 (21/08/2026)

## Concluído neste ciclo

- Worktree trazido de `main` para **`integra/v3-r3`** (estava 81 commits atrás).
- App rodando no servidor falso; **59/59 unitários** verdes.
- **Causa do bloqueio do cliente encontrada**, e não é o navegador da Central:
  o produto nasce trancado. O aparelho pede liberação ao RH e **não existe rota
  nem tela onde o RH libere** — `ApiRh` (js/api.js:39) tem sal/dados/equipe/
  colaborador/decidir e nada de aparelhos; as abas do painel (js/rh.js:74) são
  painel/pendências/pessoas/equipes/registros. Daí a tela "Aguardando liberação
  do RH" pedir uma ação sem contraparte, e o fluxo do colaborador e do gestor
  ser inalcançável no navegador.
- Demanda do cliente especificada e commitada em `docs/fase3-rh-pessoas.md`
  (commit `fdd1ea8`, já em `integra/v3-r3`), com 6 decisões fechadas.
- Sexto membro aberto na grade: **Designer de Interface e Texto** (`750f40fef8`),
  justificado pelo requisito explícito de texto e layout profissionais para leigos.
- Seis cartões criados; quatro despachados com brief completo.

## Arquivos

- `docs/fase3-rh-pessoas.md` — novo, fonte única da fase.
- Nada mais tocado pelo Orquestrador. `js/`, `index.html`, `tests/` estão com o
  Full-Stack; `vercel.json`, `_headers`, `sw.js`, `.github/` com o DevOps.

## Testes

`npm run test:unit` → 59 pass / 0 fail. E2E não rodado neste ciclo (exige
`npm install` do Playwright; `node_modules` está vazio no worktree).

## Em andamento (não reiniciar enquanto escrevem)

- T-87615C · Full-Stack · liberação de aparelho + tela de espera + e2e do ciclo.
- T-65D806 · Arquiteto · contrato de dados e rotas (doc).
- T-AED04B · QA/Security · threat model do link público (doc).
- T-AABCC9 · DevOps · CSP, cache, rota e guarda de CI; fecha também T-B1D7F6.
- Designer · `docs/fase3-interface-e-texto.md`.

## Pendências

- T-8188C6 (equipes com membros, colaborador com telefone e edição) e T-D30529
  (face por link / câmera do PC / 3 fotos) ficam em **backlog de propósito**:
  destravam quando o contrato T-65D806 chegar em review.
- Flag **NAVEGADOR** desabilitada para o Orquestrador (`522882f9d7`) — sem ela eu
  não abro o app no navegador embutido para conferir na mão.
- T-8FB792 e T-38A7C1 seguem em andamento da FASE 2; conferir se colidem com a 3.

## Próximo passo

Receber os quatro relatórios, ler o contrato do Arquiteto contra o threat model do
QA antes de liberar T-8188C6 e T-D30529, e rodar o e2e do ciclo de liberação —
é ele que prova ao cliente que a tela do colaborador ficou alcançável.

## Atualização · T-AED04B em review (QA)

Três achados do QA, **todos verificados por mim no código** antes de virarem ação:

1. **Coerência das 3 fotos está errada em produção.** `js/rh.js:504-509` é `confirm()`
   com limiar 0,55 (entre o aceite 0,45 e o par de pessoas diferentes 0,61); o
   servidor ignora (`servidor-falso.js:544-546`) o campo que o cliente manda
   (`js/rh.js:520`). **Pior que o relatado:** `js/fila.js:262` manda `coerencia: 0`
   fixo. → T-8ADD9C. Decisão minha, divergindo do QA: **o servidor calcula** dos
   vetores e o campo sai do corpo — número que o cliente informa sobre si mesmo é
   número que o cliente escolhe, e a linha 262 é a prova disso no próprio repo.
2. **"Página separada" não era separação.** SW de raiz (`sw.js:57-60`), fallback
   `caches.match('./index.html')` (`sw.js:65`), credencial no IndexedDB por origem
   (`js/store.js:10`). → **origem própria (subdomínio)**, T-600DD4 com DevOps para
   o custo em DNS/certificado. A mitigação inferior fica na gaveta.
3. **A aprovação de aparelho nunca existiu** — os testes aprovam mexendo no Map
   (`fluxo.spec.js:34-44`). Critério de pronto da T-87615C reescrito: código
   digitado é a única forma de resolver o pendente, código nunca em leitura do RH,
   campo livre sem datalist, expiração em 24h, e teste de clicar-sem-digitar.
4. Achado extra: `/marcacoes` não checa estado do dispositivo (`servidor-falso.js:447`)
   e `js/api.js:178-182` nunca solta o lote → aparelho revogado grava ponto hoje, e
   a correção ingênua faria o dado do colaborador honesto sumir calado. → T-D00CE0.

Sétimo membro: **Engenheiro Full-Stack Biometria** (`6d0c426d7f`), para a trilha
biométrica não ficar na fila de um executor só. Divisão de arquivos registrada nos
dois briefs: `js/rh.js`+`index.html`+rotas `/rh/*` são do `508cd44fd2`;
`/efrat/cadastro`+`js/regras.js`+página pública+`n8n/` são do `6d0c426d7f`.

Dívida assumida sem disfarce: chave PBKDF2 do RH é credencial permanente
(`js/rh.js:22-28`) e toda invariante desta fase pressupõe que quem está logado como
RH é o RH. Fora do escopo, ~2,5-3 dias.

## Atualização 2 · integrações e decisões (mesmo dia)

**Integrado em `integra/v3-r3`:** ramo do DevOps (T-AABCC9 + T-B1D7F6) e ramo do
Designer (fila sem "aprovar todos"). 59 unitários verdes após os merges.

**Erro meu, corrigido:** `js/config.js:16` aponta para `https://n8n.samasc.com.br/webhook`
e o servidor falso não injetava nada, então a URL de `npm run serve` que entreguei ao
cliente falava com a **produção dele**. O QA me corrigiu, o DevOps já havia consertado
(T-B1D7F6) e eu verifiquei por `curl`: o config servido agora devolve
`apiBase http://127.0.0.1:PORTA/webhook`. O `offline.spec.js` estava verde *porque* a
chamada à produção falhava — o E2E fazia POST em `/dispositivo/registrar` de produção
a cada execução, em qualquer máquina com rota para o host.

**Decisões tomadas neste ciclo:**
1. **Projeto Vercel separado**, não regra por host — revertendo a recomendação do
   Arquiteto. O argumento dele (origem diferente ⇒ IndexedDB vazio) é correto quanto
   ao armazenamento e incompleto: `js/app.js:324` registra `./sw.js` sem condição, então
   o shell alcançável no host público **instalaria o SW de raiz do app naquela origem**,
   com o fallback-para-shell que a mudança existe para remover. Isolar por ausência.
2. **Em exatamente 0,45 o cadastro recusa** (`>=`), divergindo por um fio de
   `vereditoPorDistancia` (`js/regras.js:14`, que aceita com `<=`). Assimetria
   intencional: reconhecimento erra um evento reversível; cadastro grava para sempre.
3. **Telefone compartilhado:** exceção autorizada existe no cadastro, mas pessoa com
   telefone compartilhado **não recebe link de face** — sobram câmera do PC e upload.
   O telefone é o canal de entrega do link; número errado entrega template a outro.
4. **Coerência sai da requisição, não da resposta:** o servidor calcula, persiste e
   devolve, porque `js/rh.js:358` a renderiza na fila humana — que é a compensação
   assumida pela ausência de liveness no cadastro.

**Achados de terceiros aceitos:** `js/rh.js:512` usa a credencial do **aparelho** para
o cadastro de face do RH, então a câmera do PC não funciona hoje em PC que nunca se
registrou (Arquiteto); `vetorDe()` dá distância 4,069 e o triângulo 0,094/0,61/0,80
viola a desigualdade triangular — as duas orientações erradas eram minhas, no brief do
`6d0c426d7f` (QA); colisão de `sw.js` em `v8` nos dois ramos com mesmo valor não dá
conflito de git e sairia com cache velho sem aviso (DevOps).

**Bloqueio restante:** falta a **string do hostname** de produção. O cliente opera o
DNS e o CORS do n8n ele mesmo; o DevOps está escrevendo as duas folhas em `docs/`.

## Atualização 3 · suíte verde, medida por mim

`integra/v3-r3` com DevOps, Designer, QA, Full-Stack, Biometria e contrato integrados.
Instalei o Playwright no worktree para parar de somar relatos: **77 unitários + 65 e2e
passando, 5 skipped, zero falhas**. Os 8 vermelhos de coerência fecharam — o servidor
calcula, recusa em 0,45, e o bug que estava em produção morreu. `offline.spec.js` verde
e agora medindo o que promete.

Merge resolvido por mim: `sw.js` para `v9` (a colisão em `v8` que o DevOps previu) e os
testes do QA mantidos na versão dele, mais nova — a do Biometria não tinha a correção
do fixture de fronteira (0,45011 por deslocamento ortogonal → três pontos colineares).

**Cortes de escopo desta rodada:** entidade `locais` recusada (fica `unidade` como
texto, com normalização e seletor) — o Arquiteto concordou e o argumento decisivo foi
que o único poder exclusivo da entidade é o que não queremos: aparelho seguindo o lugar,
equipe nova entrando no escopo sozinha. E o número de coerência sai da tela do RH
(derrubou uma decisão minha): com recusa em 0,45, o número só varia onde a resposta é
sempre a mesma. Persiste no banco e na resposta, para auditoria e recalibração.

**Achados de terceiros aceitos nesta rodada:** rate limit por IP é a chave errada para
quem abre link em dados móveis (NAT de operadora tranca uma turma inteira) → duas
camadas com chaves diferentes; `#porta` é a única seção que nasce visível, então
asserção positiva sobre ela passa pelo flash do boot → `class="hide"` + try/catch no
boot + guarda "nenhuma seção nasce visível".

**Bloqueios com o cliente:** a string do hostname de produção, e qual proxy está na
frente do n8n (a resposta "nenhum" muda a recomendação de rate limit).

## Atualização 4 · fecho do dia (medido, não reportado)

**Medição válida: 93 unitários + 106 e2e passando, 5 armados, zero falhas** (mais 15
etapas de guarda — eram 15 e não 16; o DevOps recontou e corrigiu o próprio número), medida pelo DevOps em 9341dc9 com procedência declarada — anúncio
de pista mais observação no fim. Substitui a minha medição anterior (95 e2e em 6151115),
que teve um vermelho não explicado e portanto procedência contendida: reconferir só o
vermelho responde se *ele* era real, não se a rodada era confiável.

**Concluído** (10): liberação de aparelho por código digitado · coerência calculada no
servidor com recusa em 0,45 · equipes com membros, telefone obrigatório e edição ·
aviso de liveness também no upload · decimais fora da tela · contrato (1893+ linhas) ·
threat model · CSP/cache/guardas de CI · guarda do `apiBase` efetivo · prova de posse
religada.

**Em construção:** cadastro de face (câmera do PC pronta no ramo do Biometria, upload
em obra, link por último de propósito) · marcação de aparelho revogado.

**Aberto com o cliente:** hostname de produção da origem pública · quatro fotos com e
sem capacete (2 poses cada) para testar a hipótese da sombra da aba · sim/não à Parte 1
(rotas do convite pela Vercel — recomendada: grátis, reversível, devolve a camada de
volume para fora da aplicação).

## O princípio que o dia produziu

**Não inferir de ausência.** Nove instâncias em um dia, em cinco camadas:
`offline.spec.js` verde porque a chamada à produção travava · `toBeEnabled()` que não
olha visibilidade (26+7 asserções, incluindo um teste que não conseguia falhar) ·
manifesto de modelo gerado antes do dado existir · meu "se eu não disser nada, está
verde" · fim de rodada que nunca chega travando a pista · guarda do `sw.js` tratando
base ausente como satisfeita · dois hostnames onde ausência de sintoma seria lida como
isolamento em pé · teste que passaria por vacuidade sem campo gravado · três asserções
de ausência temporal nos invariantes de acesso. Está no README, antes da seção das
guardas. Regra prática: todo campo, teste ou protocolo que trate falta de dado como
resultado tem de **dizer** qual dos dois lados a falta significa.

E o meu: o quadro derivou porque eu integrava sem mover cartão, e derivou para o lado
otimista — a conferência do Arquiteto produziu garantia falsa. `[PRONTO]` nesse CLI é
*ready*, não *terminado*.

## Atualização 5 · o que falta, e de quem depende

**Entregue dos quatro pedidos do cliente:** equipes com membros geridos de dentro da
equipe · colaborador com telefone obrigatório, edição e inativar/reativar por rota
própria · liberação de aparelho por código digitado (a causa do app nascer trancado) ·
cadastro de face pela **câmera do PC** — que consertou um defeito existente: `js/rh.js`
usava a credencial do *aparelho*, então a câmera não funcionava em PC de RH nunca
registrado.

**Em construção:** upload de 3 fotos (T-92D567, Biometria, dono da região da biometria
em `js/rh.js`) · marcação de aparelho revogado (T-D00CE0) · fatia de segurança da §1
(T-C20AD3, fora do backlog de propósito — sua ausência é invisível).

**Espera o cliente** (corrigido: o link do celular está sendo CONSTRUÍDO com placeholder
— o hostname só publica, não desenvolve): resposta ao capacete (quatro fotos,
com e sem, duas poses) · Parte 1 na Vercel (recomendada).

**OBSOLETO — corrigido abaixo.** Dizia que oito das dez telas não tinham verificação
visual e que os prints estavam pedidos. Os prints chegaram e eu verifiquei duas por
imagem (equipe aberta com membros; telefone duplicado). O texto original seguia: equipe
aberta com membros, ficha do colaborador com telefone, diálogo de telefone duplicado,
câmera do PC. É o único requisito do cliente sem conferência de olho.

**Achado aberto com conserto pronto:** `aparelhos.spec.js:102` gasta um ciclo de poll
(15,7 s contra teto de 30) porque o servidor falso responde `consultar_apos_s` 10/15
(`servidor-falso.js:428,444,464`) e `js/app.js:207` reagenda com esse valor. Baixar para
1-2 s nesse cenário faz o único vermelho suspeito da suíte deixar de existir, sem tocar
na prova. T-9C35B7 com o QA.

## Medição final do dia · janela travada

`integra/v3-r3` em d000718: **98 unitários + 130 e2e passando, 1 armado, zero falhas.**
Procedência: janela travada por anúncio, os seis confirmaram parada, `pgrep` 0 no fim.
Substitui as medições anteriores minha e do DevOps — as duas tinham observação parcial.
**Cobertura, não arredondar:** isso mede unitário e e2e. As 15 etapas de guarda do CI
não rodam em `node --test` nem em `playwright test`. Medidas depois, contra f0d9fc3:
**15 de 15 verdes**, invocadas com base real (sem base, a guarda do `sw.js` falha de
propósito — endurecimento do próprio dia contra ausência lida como satisfação) — e foi exatamente ali que apareceu o `sw.js` preso em v10 com oito
arquivos pré-cacheados mudados depois (corrigido em f0d9fc3, v11).

`pgrep` antes/depois só pega sobreposição que **começou** antes da entrada e ainda
estava viva no fim; não pega a que começa e termina entre as duas fotos, que é o caso
mais provável porque spec isolado dura segundos. O instrumento erra na sobreposição mais
comum. Janela travada não tem esse buraco porque não depende de detectar nada.

**Entregue e medido:** liberação de aparelho · equipes com membros · colaborador com
telefone, edição e inativar/reativar · cadastro de face pela **câmera do PC** e por
**upload de 3 fotos** · marcação de aparelho revogado (retida na mesa do RH, nunca
descartada; os quatro status soltam a fila).

**Falta:** link do celular (em construção com placeholder; o hostname só publica) ·
T-C20AD3, a fatia de segurança da §1 · métrica de pose (T-55A616).

## Cobertura completa do dia (as três medições)

| | número | procedência |
|---|---|---|
| unitário | 98 / 0 falhas | janela travada |
| e2e | 132 / 0 falhas, 1 armado | janela anunciada, sem anúncio de terceiro |
| guardas de CI | 15 / 0 falhas | anúncio + pgrep nas duas pontas; quase insensível a contenção (nenhuma abre navegador) |

Nenhuma das três é "a" medição: cada uma cobre o que cobre, e as três juntas são o
estado. Foi o erro que eu cometi ao registrar unitário+e2e como *a* medição válida.

## Auditoria do próprio checkpoint (o documento também envelhece)

O QA achou um parágrafo obsoleto no documento de segurança dele — declarava uma lacuna
que ele mesmo já havia fechado no mesmo dia — e a distinção que ele fez vale para este
arquivo: comentário errado tem o código ao lado para desmenti-lo; **documento é a única
fonte, e ninguém tem com o que confrontar.** Lacuna declarada que já foi fechada faz
alguém fechar de novo, ou tratar como aberto um risco coberto.

Auditei este checkpoint e achei duas afirmações minhas que ficaram falsas:
1. "oito das dez telas não verificadas visualmente, prints pedidos" — os prints chegaram
   e eu verifiquei duas por imagem. Marcado como obsoleto acima em vez de apagado.
2. "link do celular espera o hostname" — ele está sendo construído com placeholder; o
   hostname **publica**, não desenvolve. A redação antiga fazia o hostname parecer
   bloqueio de desenvolvimento, que foi um erro meu de sequenciamento antes.

**Verificado visualmente por mim, em imagem:** app destrancado · aba Aparelhos · equipe
aberta com membros, remover e adicionar de dentro · ficha do colaborador em edição com
telefone e o diálogo de telefone duplicado (que avisa, na hora da autorização, que a
pessoa não poderá receber o link de cadastro de face).

## Fecho: a §1 ficou completa, não "completa com ressalva"

`integra/v3-r3` em d821ff3: **97 unitários · 139 e2e (zero armados) · 16 guardas** —
zero falhas nas três coberturas. Nenhum `test.fixme` sobrou.

A fatia de segurança do aparelho fechou inteira. Aprovar deixou de dar acesso a todas as
equipes. E a última lacuna declarada, o **rastro auditável**: toda tentativa vira
registro (quem, quando, qual aparelho, resultado) **independente de ter batido no
limite** — registrar só o bloqueio mostraria a enxurrada e esconderia a tentativa
paciente. O código tentado nunca é guardado.

**Erro meu:** escalei um defeito ao cliente antes de ter o alcance. Disse que a câmera do
PC provavelmente estava quebrada; o defeito estava na página do link, nunca integrada.
Quatro leituras independentes confirmaram os dois caminhos intactos — a câmera porque o
vídeo é **irmão** e não filho do container reescrito, o upload porque usa delegação no
container pai, imune por construção. Fiz as perguntas certas e falei antes das respostas.

**Lacuna de coordenação:** a regra de pista filtrava por Playwright e não via o navegador
visível. Ampliada para qualquer consumo de navegador ou CPU pesada, com o recurso
nomeado na procedência.

**Limite de verificação visual do upload:** o navegador da Central não tem comando de
upload de arquivo, e clicar num slot abre o diálogo nativo do sistema, que travaria a
sessão. Então "as três em sequência", "retry de uma posição" e "recusa por falta de
rosto" estão provados **funcionalmente e não vistos por olho humano**. O estado
vazio-vs-falhou está provado em dois níveis: classe pelo teste, aparência pelo CSS
(`css/tema.css:174-176` — tracejado vs sólido, que sobrevive a daltonismo).

**Aberto:** link do celular (defeito em investigação) · métrica de pose · as quatro
decisões do cliente.

## Medição válida do dia · janela travada, os seis confirmando

`integra/v3-r3` em **2717eb4**: **97 unitários · 173 e2e · zero falhas · zero skipped.**
Procedência: janela travada, os seis confirmaram parada nomeando os recursos, ninguém
entrou durante. As guardas de CI são a terceira cobertura e correm em separado.

**A conta, por arquivo** (o total caiu fora da faixa que eu previ, e faixa não é
previsão): a soma dos 22 arquivos de spec dá 173 exatos — fluxo 26, equipes-pessoas-
contrato 19, convite-contrato 19, aparelho-liberacao 13, rh-face-cadastrar 11,
marcacao-revogado-contrato 10, cadastro-coerencia 9, pagina-publica 8, aparelhos 8,
rh-biometria 7, acesso 7, e o resto.

**Regra adotada, do Arquiteto:** conferir o total contra a soma por arquivo **sempre**,
não quando o número parece estranho. Eu só conferi porque caiu fora da faixa — sorte, não
método. Total plausível é o caso em que ninguém confere, e o único em que a conta errada
sobrevive.

**Fora de propósito:** o ramo do QA (748e155) com 3 vermelhos que guiam a métrica de pose,
esperando `avaliarPose`. Número limpo com o fato ao lado, não número limpo por omissão.

## A escala que vale para o cliente

| grau | exemplo |
|---|---|
| **visto** | porta destrancada · aba Aparelhos · equipe aberta com membros · telefone duplicado |
| **medido** | as três coberturas, com procedência declarada |
| **provado, não visto** | três fotos em sequência · retry de uma posição · recusa sem rosto |
| **inferido, não medido** | navegador órfão · a política de produção da origem pública, conferida por guarda que **lê** o arquivo e nunca exercida num servidor |

A média disso vira "o sistema está testado" — verdadeiro e inútil.

## Decisão de fecho: o gate absoluto de pitch NÃO entra

Sequência: o Biometria achou, lendo o código antes de implementar, que o motor 2D não tem
zero natural de pitch — o nariz fica abaixo da linha dos olhos por anatomia. Qualquer
métrica 2D precisa de uma razão antropométrica **dentro da fórmula**, e ela, errada,
**desloca** a leitura de quem foge da razão assumida (variação por anatomia, ancestralidade,
idade). Decidi contra a constante global pelo tipo de defeito trocado: hoje o gate é cego de
forma **uniforme**; a constante trocaria isso por um gate que recusa mais algumas pessoas.
Média melhor, distribuição pior — e no gate é pior que no matcher, porque o matcher errado
manda para revisão e o gate errado nem tenta.

Aprovei o candidato do QA (razão entre duas medidas do próprio rosto) e **ele mesmo o
derrubou 20 minutos depois, com medição**: a razão cancela **escala**, não **forma** — duas
anatomias frontais dão 0,6154 e 0,2778, fator 2,2 na mesma pose. Trocava uma constante por
outra.

O que funciona, medido: **diferença** entre duas fotos da mesma pessoa cancela o
deslocamento exatamente (zero exato nas duas anatomias); a escala difere, então compara
fotos e nunca mede ângulo absoluto.

**Resultado:** o eixo relativo entra ("as 3 fotos estão em poses consistentes?", mesma forma
da coerência que já existe, sem viés). O gate absoluto **não entra** — não é adiamento, é
não-respondível em 2D sem viés. Fica a cegueira uniforme, que é o defeito justo. Vai ao
cliente como **limite conhecido e nomeado**.

Os 3 vermelhos do QA passariam com qualquer das duas fórmulas erradas — ele vai declarar no
arquivo que não cobrem viés antropométrico.

## Estado final do dia

`integra/v3-r3` em **c0f7937**, `sw.js` em v16: **102 unitários · 173 e2e · 16 guardas —
zero falhas nas três coberturas.**

**Entregue:** equipes com membros geridos de dentro da equipe · colaborador com telefone
obrigatório, edição e inativar sem apagar histórico · liberação de aparelho por código
digitado · cadastro de face pela câmera do PC e por upload de 3 fotos · marcação de
aparelho revogado retida na mesa do RH · link do celular construído e testado, aguardando
só o hostname · consistência de pose entre as 3 fotos como função pura testada e **não
ligada** (ligação fica cliente-side, cartão em backlog).

**Quatro defeitos que já estavam em produção, consertados com teste que os pega:** app
nascendo trancado · coerência aceitando duas pessoas no mesmo template · aprovação de
aparelho dando acesso a todas as equipes · refoco atrasado no login escrevendo a senha no
campo de usuário.

**Aberto e documentado:** rastro de tentativa errada de código (T-81C721 fechado; a lacuna
2.1e segue em `docs/fase3-seguranca.md`) · unidade sem seletor nem normalização (T-13FDDF) ·
ligar `avaliarPoseLote` no cliente (T-A17B32) · `fluxo.spec.js:245` falhou uma vez sem
reproduzir e **sem ser de margem apertada** (T-D13271 — hipótese: estado compartilhado do
servidor falso entre specs) · e as quatro decisões do cliente.

**O que não vai existir nesta versão, por decisão e não por falta de trabalho:** gate
absoluto de pose. Em 2D exige constante antropométrica, e ela recusaria umas anatomias mais
que outras. Cegueira uniforme é o defeito justo. O eixo relativo cobre o cadastro (3 fotos)
e não a portaria (1 captura, sem referência reconstruível do descritor 128d).
