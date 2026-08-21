# FASE 3 · Segurança — link público de face, liberação de aparelho, validação e o lote de 3 fotos

Parecer de segurança da fase 3, escopo dos itens **A**, **C**, **D1** e **D3** de
`docs/fase3-rh-pessoas.md`. **Documento apenas — zero código, zero teste nesta rodada**
(o Full-Stack está escrevendo em `js/` e `tests/`). Base: `integra/v3-r3`.

Cada seção entrega o mesmo par: **o que o adversário consegue** → **a invariante que o
teste tem de sustentar**. Invariante aqui quer dizer afirmação que continua verdadeira
depois de qualquer refactor — é o que o teste crava, não o passo a passo da tela.

Decisões travadas que este documento **não** reabre: página separada do app do operador,
uso único, validade curta, revogável, sem PII na URL, telefone obrigatório, três fotos com
coerência verificada, dois papéis, liberação de aparelho primeiro.

---

## 0. Leitura de abertura — o diagnóstico muda a prioridade de segurança

`docs/fase3-rh-pessoas.md` abre dizendo que **o app nasce trancado**: não existe a tela
onde o RH libera o aparelho. Isso tem uma consequência de segurança que o diagnóstico não
declara, e é o ponto de partida deste parecer.

Hoje os testes aprovam o aparelho **mexendo direto no estado do servidor-falso**
(`tests/e2e/fluxo.spec.js:34-44` e `tests/e2e/acesso.spec.js:35-43` setam
`d.estado = 'ativo'` no `Map` de dispositivos). Não é preguiça do teste — é que **a rota
de aprovação não existe**: `ApiRh` tem `sal`, `dados`, `equipe`, `colaborador`, `decidir`
(`js/api.js:39-45`) e o servidor-falso só atende `/dados`, `/equipe`, `/colaborador`,
`/decidir` (`tests/e2e/servidor-falso.js:493-537`).

Ou seja: **R2 do `docs/ameacas-v3.md` (prova de posse física na aprovação) está
especificado no ADR e não está implementado em lugar nenhum.** O único teste que hoje
afirma algo sobre o código curto é `acesso.spec.js:75` (critério 3), e ele afirma a
metade defensiva — que o código não vaza do DOM. A metade que autentica — que o RH só
ativa digitando o código que leu na tela física — não tem contraparte executável.

Isso não muda a ordem do plano (A continua primeiro). Muda o critério de pronto do item A:
**A não está pronto quando a aba existe e o botão aprova. Está pronto quando o caminho de
aprovação passa pela digitação do código e o teste prova que clicar sem digitar não ativa.**

---

## 1 · D1 — Threat model do link público de cadastro de face

### Por que esta superfície é diferente de tudo que já existe no produto

Toda outra superfície do produto exige, antes de qualquer coisa, uma credencial de
máquina de 256 bits gerada no aparelho e aprovada pelo RH (`js/app.js:36-37`,
`docs/adr-acesso-v3.md`). O link público é a primeira rota do produto em que **o único
fator é o conhecimento de uma URL**. Não há aparelho aprovado, não há usuário, não há
segundo fator. O token na URL *é* a sessão inteira.

Consequência direta de desenho, e é o eixo de tudo abaixo: **o que esse link entrega tem
de ser dimensionado para "quem tem o link, tem tudo que o link dá"** — porque é
exatamente isso que ele dá.

### 1.0 Achado que precede a tabela: "página separada" não é separação

A decisão travada é *"página separada do app do operador... não vê IndexedDB, não vê
painel"*. **Uma segunda página no mesmo domínio não entrega nada disso.** Verificado no
repo:

- A credencial do aparelho vive em `indexedDB.open('efrat-ponto')`, store `cfg`, chave
  `credencial` (`js/store.js:10`, `js/app.js:111`). IndexedDB é isolado por **origem**,
  não por caminho. Uma página em `/face.html` na mesma origem lê a mesma base — inclusive
  a credencial de 256 bits do aparelho.
- O service worker é registrado na raiz e intercepta **todo** GET de mesma origem
  (`sw.js:57-60`). A página pública passaria a ser controlada pelo SW do app do operador.
- Pior, o fallback offline do SW é `caches.match('./index.html')` (`sw.js:65`): sem rede,
  um GET de `/face.html` **devolve o shell do app do operador** para o celular do
  colaborador. É o oposto literal de "não vê painel".
- O SW ainda cacheia qualquer resposta `ok` de mesma origem (`sw.js:63`), então o
  conteúdo da página pública entra no mesmo cache do app do operador.

Isso rebaixa a gravidade de qualquer XSS na página pública de "vaza o cadastro de uma
pessoa" para "vaza a credencial do aparelho e o caminho para a carga biométrica da
equipe". Não é hipotético: é consequência mecânica de compartilhar origem.

**Invariante 1.0.** A página pública roda em origem própria (subdomínio dedicado, ex.
`cadastro.<dominio>`), com CSP própria, sem service worker registrado, e o SW do app do
operador nunca a controla.
**Teste:** requisição à URL pública com o SW do app instalado devolve a página pública, e
nunca `index.html`; `navigator.serviceWorker.controller` é `null` no contexto da página
pública; `indexedDB.databases()` na página pública não contém `efrat-ponto`.

Se o subdomínio for recusado por custo de deploy, a alternativa mínima é: `sw.js` passa a
ignorar explicitamente o caminho público no `fetch` **e** no fallback, e a página pública
nunca abre o IndexedDB. Isso é mitigação, não isolamento — o XSS continua na mesma origem
e continua conseguindo abrir `efrat-ponto` por conta própria. Registro a diferença para
que a escolha seja consciente.

### 1.1 Quem intercepta o link

O link vai por WhatsApp/SMS para o celular pessoal do colaborador. Intercepta quem tiver:
acesso ao aparelho de origem (o do RH), acesso ao aparelho de destino, backup de nuvem do
WhatsApp de qualquer um dos dois, ou o número reciclado/portado por outra pessoa. O
produto **não controla** nenhum desses canais — não adianta desenhar como se controlasse.

O que o produto controla é a **janela** e o **poder** do link.

**Invariante 1.1a.** O link só é válido por uma janela curta a partir da emissão, medida no
servidor. Recomendo **30 minutos**, com o RH podendo reemitir quantas vezes quiser: é
tempo suficiente para "mandei, ele abriu", e curto o bastante para que um backup de nuvem
lido dias depois valha nada.
**Teste:** token emitido, relógio do servidor avançado além da janela, `GET` da página
responde expirado sem revelar nome nem matrícula, e `POST` de submissão é recusado com o
mesmo código de erro.

**Invariante 1.1b.** A janela é do **servidor**, não da URL. Nada de `?exp=` assinado no
link. O servidor é a única fonte de validade, porque é a única que também sabe se o token
foi usado ou revogado.
**Teste:** submissão com token expirado é recusada mesmo que o cliente não tenha feito o
`GET` prévio (chamada direta ao endpoint, sem passar pela tela).

**Invariante 1.1c.** O link é **write-only para face**: submeter as capturas de uma pessoa
já conhecida. Ele não lê o cadastro, não lista pessoas, não mostra ponto, não mostra
biometria anterior.
**Teste:** varredura da resposta do `GET` público — o corpo não contém matrícula, telefone,
`equipe_id`, `pessoa_id`, miniatura, descritor, nem qualquer campo de outra pessoa.

### 1.2 Quem recebe o link por engano

O caso mais provável de todos, e não é ataque: o RH digita um dígito errado no telefone. O
link chega em um desconhecido, que abre uma página pedindo três fotos do rosto.

Esse cenário é a razão de **1.1c** e de **1.2** juntas: se a página abrir com *"Olá, Maria
Aparecida da Silva — matrícula 4471, Equipe Norte"*, o número errado acabou de receber
dado pessoal de um terceiro. Isso é incidente de LGPD por erro de digitação, sem
adversário nenhum.

**Invariante 1.2a.** A página pública, antes de qualquer prova de identidade, mostra
**apenas o primeiro nome** e o nome da empresa. Nada de sobrenome completo, matrícula,
equipe, telefone ou foto anterior — nem no HTML, nem em `<meta>`, nem em variável de JS,
nem na resposta da API que a página consome.
**Teste:** `GET` público de um token válido → corpo da resposta e DOM renderizado não
contêm a matrícula nem o sobrenome da pessoa-alvo (asserção por string, contra o fixture).

**Invariante 1.2b.** Antes de habilitar a câmera, a pessoa confirma um dado que só ela e o
RH têm — os **quatro últimos dígitos do telefone cadastrado**, digitados, não escolhidos
de uma lista. Errou três vezes, o token queima e o RH precisa reemitir.
**Teste:** três tentativas erradas → o token vai a estado `queimado`; a quarta tentativa,
**mesmo com o valor certo**, é recusada; e uma submissão direta ao endpoint sem ter passado
pela confirmação também é recusada (a confirmação é estado no servidor, não flag no cliente).

Isso não é autenticação forte — os quatro dígitos são adivinháveis em 10⁴ e o telefone
pode ser conhecido. É a barreira certa para o **modelo de ameaça certo**: destinatário
errado de boa-fé, que simplesmente não sabe o número da outra pessoa e para ali. Contra o
adversário deliberado, quem trabalha é 1.5 (uso único), 1.6 (entropia) e 1.7 (limite).

### 1.3 Quem tenta cadastrar a própria face no lugar de outro

Este é o ataque com consequência mais séria do produto inteiro, e a razão é o efeito de
segunda ordem, não o cadastro em si: **cadastrar a própria face no `pessoa_id` de outro é
sequestrar o ponto daquela pessoa** — o atacante passa a bater ponto como ela, e a vítima
passa a falhar no reconhecimento (e a cair em registro manual, que é justamente o caminho
que ninguém audita com atenção).

Um link roubado ou desviado dá exatamente essa capacidade, porque o `pessoa_id` está
amarrado ao token e o rosto é o que o token pede.

**Invariante 1.3a.** O submit do link público **nunca sobrescreve template vigente**. Ele
grava sempre em estado `pendente`, e o template só passa a valer depois que o RH aprova na
fila de recadastro (`efrat_recadastro`/`decidir`, o caminho que já existe —
`tests/e2e/servidor-falso.js:527-536`).
**Teste:** pessoa com biometria ativa, submissão por link concluída com sucesso → a carga
(`/efrat/carga`) continua devolvendo o template **antigo**; só depois de `decidir` a nova
versão aparece.

Vale registrar por que isto é barato: `origem: 'rh'` grava `status: 'ativo'` e
`origem: 'gestor'` grava `status: 'pendente'` (`tests/e2e/servidor-falso.js:543,557`). A
origem `link` entra como o terceiro caso, no ramo já existente do pendente. Não é
mecanismo novo.

**Invariante 1.3b.** Substituição de biometria de pessoa que **já tem template** exibe ao
RH, na fila, a miniatura antiga e a nova lado a lado. O que a fila protege depende do RH
conseguir ver que o rosto mudou — sem isso a aprovação vira carimbo.
**Teste:** item de recadastro por link, de pessoa com biometria prévia, renderiza as duas
miniaturas; sem miniatura anterior, o item se identifica como primeiro cadastro.

**Invariante 1.3c.** O primeiro cadastro por link também é pendente. Tentador liberar
direto ("não tem o que sobrescrever"), mas é justamente o caso em que ninguém nunca viu o
rosto certo — a única defesa é o RH olhar.
**Teste:** pessoa sem biometria, submissão por link → `status: 'pendente'`, não `'ativo'`.

### 1.4 Quem colhe nome ou matrícula pela URL

A decisão travada já diz "sem PII na URL". Três vazamentos que essa frase não cobre
sozinha, e que precisam de invariante própria porque acontecem **depois** de a URL estar
limpa:

- **`Referer`.** Qualquer recurso externo carregado pela página vaza a URL — token
  incluído — no cabeçalho. `_headers:5` já define `Referrer-Policy: same-origin`, e a CSP
  atual (`_headers:2`) já é `default-src 'self'`. Bom ponto de partida; precisa valer também
  na origem nova.
- **Histórico e compartilhamento.** O token fica na barra de endereço, no histórico do
  navegador e em qualquer print que a pessoa mande no grupo.
- **Log de servidor e CDN.** Token em query string entra em access log por padrão.

**Invariante 1.4a.** A URL pública não contém nome, sobrenome, matrícula, telefone,
`pessoa_id` nem `equipe_id` — só o token opaco, sem estrutura decodificável.
**Teste:** a URL emitida, decodificada de base64url/hex, não bate com nenhum campo do
cadastro da pessoa; e dois links para a mesma pessoa produzem tokens sem prefixo comum.

**Invariante 1.4b.** Consumido o token (sucesso ou queima), a página **substitui a própria
entrada de histórico** por uma URL sem token (`history.replaceState`), para que o token não
sobreviva no histórico nem em print de tela.
**Teste:** após a submissão, `location.search`/`location.pathname` não contêm mais o token.

**Invariante 1.4c.** A página pública não emite requisição para nenhuma origem externa —
sem fonte remota, sem analytics, sem CDN. CSP `default-src 'self'`, `frame-ancestors 'none'`.
**Teste:** a resposta traz os cabeçalhos de CSP e `frame-ancestors 'none'`; nenhuma request
para host de terceiro é observada no carregamento da página.

### 1.5 Quem reusa o link

"Uso único" está travado, mas há uma armadilha específica no meio: **o cadastro de face
tem três capturas**, então existe um estado intermediário em que o token já foi usado e o
fluxo ainda não terminou. Se "uso único" for implementado como "queima no primeiro POST",
a pessoa que perde a conexão entre a segunda e a terceira foto fica sem caminho — e o
suporte vai pedir para reemitir, o que treina o RH a reemitir por qualquer motivo.

**Invariante 1.5a.** O token queima na **conclusão** (lote das 3 aceito ou recusado) e não
na abertura. Enquanto o lote não fecha, o mesmo token continua válido dentro da janela de
1.1a, com o progresso mantido no servidor.
**Teste:** submissão parcial, nova abertura do mesmo link dentro da janela → retoma; depois
do lote concluído, a mesma URL responde consumido.

**Invariante 1.5b.** Queimado é definitivo: nem sucesso, nem recusa por incoerência (§4),
nem expiração são reversíveis. Reabrir exige o RH emitir **outro** token.
**Teste:** lote recusado por incoerência → o mesmo token não aceita uma segunda tentativa;
a mensagem manda falar com o RH, não "tente de novo".

Registro a tensão de UX aqui, e é uma decisão de produto que não é minha: recusar o lote e
queimar o token custa uma ida ao RH para quem só tirou três fotos ruins. A alternativa —
permitir N tentativas dentro do mesmo token — reabre o oráculo de §4.2. Minha recomendação
é queimar, e o RH reemitir com um clique; se o piloto mostrar que isso vira rotina, o
número de tentativas é o parâmetro a mexer, não a invariante.

**Invariante 1.5c.** Emitir um token novo para a mesma pessoa **revoga** os anteriores dela.
Senão "revogável" não fecha: o RH reemite achando que invalidou o antigo, e não invalidou.
**Teste:** dois links emitidos em sequência para a mesma pessoa → o primeiro responde
revogado; só o segundo funciona.

**Invariante 1.5d.** A revogação explícita pelo RH é imediata e não depende de o link ter
sido aberto.
**Teste:** RH revoga → o `GET` seguinte já responde revogado.

### 1.6 Quem força bruta o token

O código de aparelho tem 6 caracteres em alfabeto de 31 (`n8n/dispositivo-registrar.workflow.js`)
— ~30 bits, aceitável porque é **de leitura humana** e tem prova de posse do outro lado. O
token do link **não é lido por humano**: chega por clique. Não existe motivo para ele ser
curto, e portanto não existe motivo para ele ser adivinhável.

**Invariante 1.6a.** Token com no mínimo **128 bits** de CSPRNG (`crypto.getRandomValues`),
sem parte derivada de `pessoa_id`, matrícula, timestamp ou sequencial.
**Teste:** N tokens emitidos são todos distintos, têm o comprimento esperado e não
compartilham prefixo; a geração usa CSPRNG e não `Math.random`.

**Invariante 1.6b.** Token inválido, expirado, revogado e inexistente produzem **a mesma
resposta**, com o mesmo código e o mesmo tempo de resposta observável. Diferenciar entrega
um oráculo de enumeração de graça.
**Teste:** as quatro condições devolvem corpo e status idênticos.

**Invariante 1.6c.** O token é comparado no servidor por lookup de hash, não por igualdade
de string em varredura linear — e nunca é gravado em log ou em auditoria.
**Teste:** o registro de auditoria da submissão traz `pessoa_id`, instante e resultado, e
não traz o token nem o descritor (mesma regra de
`efrat_auditoria_identificacao`, `docs/adr-acesso-v3.md`).

### 1.7 Quem enfileira cadastros

Dois floods diferentes, com defesas diferentes — e este é o item onde a fase 3 herda um
problema que `docs/ameacas-v3.md` já catalogou (Cenário 1, fadiga de aprovação) e agora
ganha uma segunda porta.

**Flood externo (na rota pública).** Quem tem um link válido tem um endpoint que aceita
imagem. Sem limite, é upload ilimitado com custo de processamento facial por chamada.
**Invariante 1.7a.** Limite por token (tentativas de lote), por IP e por janela, com
`429` + `Retry-After` — o mesmo padrão de `LIMITE_CADASTRO` que já existe
(`tests/e2e/servidor-falso.js:192-205`) e a mesma tabela `efrat_limite_api` do ADR.
**Teste:** N+1 submissões na janela → `429` com `Retry-After`, e a submissão legítima
seguinte volta a passar depois da janela.

**Flood interno (na fila do RH).** Este é o mais perigoso e o menos óbvio: cada link
consumido vira um item na fila de aprovação de recadastro (invariante 1.3a). Um RH com 40
itens pendentes aprova em lote e sem olhar — e a fila era a **única** defesa contra §1.3.
O produto, sozinho, destrói a defesa que acabou de criar.
**Invariante 1.7b.** A fila de recadastro mostra quantos itens vieram por link no mesmo
dia, e itens de **substituição** de biometria vigente aparecem separados dos de primeiro
cadastro — nunca misturados numa lista uniforme aprovável de uma vez.
**Teste:** com M itens do dia, a contagem visível bate com M e a seção de substituição não
contém item de primeiro cadastro.

Isto é o mesmo critério que o Orquestrador já registrou para propostas de ajuste do gestor
em `docs/ameacas-v3.md` ("a fila precisa mostrar quantas propostas vieram do mesmo gestor
no mesmo dia"), aplicado à fila nova. Coerência de produto, não invenção minha.

**Invariante 1.7c.** Não existe "aprovar todos". A aprovação de substituição de biometria é
item a item.
**Teste:** a fila não expõe controle de aprovação em lote para itens de substituição.

### 1.8 Tabela-resumo do D1

| # | Adversário / evento | Ganha o quê, sem a defesa | Invariante |
|---|---|---|---|
| 1.0 | XSS na página pública, mesma origem | credencial do aparelho no IndexedDB, shell do operador via SW | origem própria, sem SW, sem `efrat-ponto` |
| 1.1 | intercepta o link (backup, número portado) | cadastro válido dias depois | validade curta no servidor, link write-only |
| 1.2 | recebe por engano (dígito errado) | PII de terceiro sem ataque nenhum | só primeiro nome antes de provar; 4 dígitos do telefone; queima em 3 erros |
| 1.3 | cadastra a própria face no lugar de outro | sequestra o ponto da vítima | submissão por link é sempre pendente; RH vê antes/depois; sem exceção para 1º cadastro |
| 1.4 | colhe identidade pela URL | nome/matrícula por `Referer`, log, print | URL só com token opaco; `replaceState`; zero origem externa |
| 1.5 | reusa o link | segundo cadastro na mesma pessoa | queima na conclusão; queima é definitiva; emitir novo revoga o anterior |
| 1.6 | força bruta / enumera | token adivinhado, existência de pessoa | ≥128 bits CSPRNG; respostas indistinguíveis; token fora do log |
| 1.7 | enfileira cadastros | fadiga de aprovação → §1.3 volta a valer | rate limit; contagem visível na fila; sem aprovação em lote |

---

## 2 · A — Liberação de aparelho

### 2.1 O código curto não pode virar chave adivinhável

O que impede aprovar o aparelho de um estranho é **uma coisa só**: o código na tela do
aparelho físico ser a *única* forma de resolver qual pendente ativar. Toda a segurança do
item A depende disso, então listo o que a quebra:

**Invariante 2.1a (a que sustenta todas as outras).** A ativação é **resolvida pelo
código**, não pela linha selecionada. O RH digita o código; o servidor encontra o único
pendente correspondente e ativa esse. Não existe caminho que ative um pendente a partir do
`dispositivo_id` que o painel já conhece.
**Teste:** chamada de aprovação com `dispositivo_id` e **sem** código é recusada; com
código errado é recusada; e o teste que hoje aprova mexendo no `Map`
(`fluxo.spec.js:34-44`) ganha um irmão que exercita a rota real de ponta a ponta.

**Invariante 2.1b.** Nenhuma resposta de leitura do RH devolve `codigo_curto` — nem na
lista de pendentes, nem em `/rh/dados`, nem em campo escondido do HTML. É o "Novo 2" de
`docs/ameacas-v3.md`, e é a diferença entre prova de posse e copiar de um campo para o
outro.
**Teste:** o corpo de toda rota de leitura do RH, serializado, não contém o valor de
`codigo_curto` de nenhum pendente. Complementa `acesso.spec.js:75`, que já cobre o lado do
aparelho (o código some do DOM depois de aprovado).

**Invariante 2.1c.** O campo de confirmação é **digitação livre**. Sem `datalist`, sem
autocomplete, sem dropdown de códigos — qualquer um deles devolve a resposta que o RH
deveria ter ido buscar na tela física.
**Teste:** o input não tem `list`/`datalist` associado, e a lista de pendentes não carrega
os códigos no cliente.

**Invariante 2.1d.** O código não é derivável do `dispositivo_id` nem de nada que o RH veja
logado (o ADR já exige; o teste precisa cravar).
**Teste:** para N pendentes, nenhuma função de `dispositivo_id`/`apelido`/`ua` reproduz o
código; os códigos são distintos e vêm de CSPRNG.

**Invariante 2.1e.** Tentativa de aprovação com código errado é limitada por sessão de RH e
por janela, e o contador de tentativas é visível na linha do pendente. São ~30 bits
(`31^6`), o que é bastante contra adivinhação cega — mas o alvo real é o RH que erra a
digitação três vezes e o atacante que testa códigos enquanto um pendente legítimo está na
fila.
**Teste:** N erros na janela bloqueiam novas tentativas com `429`; a contagem aparece na
lista de pendentes.

**Invariante 2.1f.** O pendente expira sozinho. Um pedido de aprovação que ninguém atendeu
não pode ficar aprovável por tempo indeterminado — é o que transforma um tablet perdido em
acesso futuro. Recomendo **24 horas**, com o aparelho reemitindo pedido e código novos.
**Teste:** pendente além da janela responde expirado e não pode ser ativado nem com o
código certo.

### 2.2 Marcações já enfileiradas num aparelho revogado

Aqui o repo tem um comportamento que **não é o que o produto quer**, e é um achado real,
não um risco teórico. Verificado:

1. `/efrat/marcacoes` **não checa o estado do dispositivo.** O gate de autenticação
   (`tests/e2e/servidor-falso.js:175-190`) confere que a credencial bate com um dispositivo
   existente — e nada mais. `/efrat/carga` checa `pendente`/`inativo`/`sem escopo`
   (`servidor-falso.js:286-294`); `/efrat/marcacoes` (`servidor-falso.js:447`) não checa
   nada disso. **Um aparelho revogado continua gravando ponto no servidor.**
2. Do lado do cliente, se o servidor passar a recusar, o lote **não sai da fila**: falha de
   `POST` cai no ramo que registra `sync_falhou` e retorna sem remover nada
   (`js/api.js:178-182`). A fila é retentada para sempre, em silêncio.

Os dois juntos são o pior arranjo possível: hoje o dado do aparelho revogado entra; quando
o servidor for corrigido ingenuamente, o dado do colaborador honesto some sem ninguém
avisar. Revogação existe para o caso "tablet sumiu" — e o tablet que sumiu tem, na fila,
marcações legítimas do turno inteiro que ninguém mais tem.

A regra que resolve os dois separa **quando a marcação aconteceu** de **quando ela subiu**:

**Invariante 2.2a.** Marcação de aparelho revogado **não entra direto**. O servidor recusa
o caminho normal com erro próprio e distinto de `rejeitado` por regra de negócio.
**Teste:** aparelho ativo enfileira offline → RH revoga → sincronização não grava marcação
aceita.

**Invariante 2.2b.** Ela também **não é descartada**: entra retida, na mesa do RH, marcada
com a origem "aparelho revogado", com o instante da marcação e o da revogação lado a lado.
Quem decide se vale é o RH, com o contexto de por que revogou.
**Teste:** depois da sincronização, o item aparece na fila de decisão do RH com o carimbo
de revogado; aprovar pelo RH o transforma em marcação válida.

**Invariante 2.2c.** No aparelho, esses itens **saem da fila local** e vão para o estado
retido/visível — o mesmo tratamento que `rejeitado` já tem hoje (`js/api.js:191-193`,
"rejeitado fica retido e visível em Ajustes", README). O que não pode é ficar em retentativa
infinita fingindo que vai subir.
**Teste:** após a resposta, a fila local esvazia daqueles ids, o contador de retidos sobe, e
uma segunda sincronização não os reenvia.

**Invariante 2.2d.** Revogação é imediata e **não espera o fim do dia**. `docs/ameacas-v3.md`
registrou (R6) que a carga expira só em `expira_em` e que o time aceitava esse SLA — vale
para *ler* a carga em cache. Não vale para *escrever* ponto: escrita passa pelo servidor,
e o servidor sabe agora.
**Teste:** revogado durante o turno → a próxima escrita já cai no caminho retido, sem
depender de expiração de carga.

**Invariante 2.2e.** O aparelho revogado mostra ao operador que há marcações retidas e
quantas — sem exigir devtools para descobrir.
**Teste:** a tela de bloqueio (`js/app.js:210-212`) informa a contagem de retidos junto da
mensagem de revogação.

---

## 3 · C — Validação

### 3.1 Telefone obrigatório: o que o servidor recusa

Estado atual, para não haver dúvida sobre o tamanho do buraco: o formulário não tem campo
de telefone (`js/rh.js:407-414`) e a rota valida **só nome e matrícula não vazios**
(`tests/e2e/servidor-falso.js:520-526`). Nada mais.

**O servidor recusa:**

| Recusa | Por quê |
|---|---|
| ausente, vazio ou só espaço | é o requisito travado |
| menos de 10 ou mais de 11 dígitos, após remover máscara | fixo (10) e celular (11) no Brasil |
| DDD fora da faixa válida | `11` a `99`, excluídos os não atribuídos |
| celular de 11 dígitos cujo 3º dígito não é `9` | numeração móvel brasileira |
| todos os dígitos iguais, ou sequência trivial | `99999999999` é o que se digita para escapar de campo obrigatório |
| repetido de outro colaborador **ativo** | dois cadastros com o mesmo canal significa que um deles não tem canal |

O último merece nota: bloquear repetição é a regra certa para o modelo do produto (o
telefone é o canal com **aquela** pessoa), mas ela vai bater em casos legítimos — pai e
filho no mesmo canteiro, um celular só. Recomendo recusar por padrão e dar ao RH um
caminho explícito de exceção que grave quem autorizou. Recusar sem saída faz o RH digitar
um número falso, que é pior do que o compartilhamento que a regra queria evitar.

**Invariante 3.1a.** Cada recusa acima é uma resposta `422` com `campo: 'telefone'` e
mensagem que diz o que fazer, no formato de erro do ADR.
**Teste:** um caso por linha da tabela; todos `422`, todos apontando o campo, nenhum
gravando.

**Invariante 3.1b.** O telefone é **normalizado no servidor** para uma forma canônica antes
de gravar e de comparar. Sem isso, `(67) 99999-8888` e `67999998888` são duas pessoas
diferentes para a regra de duplicidade — que passa a não valer nada.
**Teste:** o mesmo número em três formatações distintas colide na regra de duplicidade.

### 3.2 Por que no servidor, e não só na tela

Cinco motivos, em ordem de força — e os três primeiros são verificáveis neste repo hoje:

1. **A tela não é a única cliente da rota.** `ApiRh.colaborador` é chamada de dois lugares
   diferentes em `js/rh.js` (`:431` no formulário e `:512` dentro de `salvarBiometria`).
   O segundo reenvia o cadastro **sem passar pelo formulário**. Validação só na tela já
   nasce contornada por dentro do próprio produto.
2. **A validação de tela é `.value.trim()`** (`js/rh.js:432`). Qualquer `POST` fora da
   página — devtools, `curl`, uma versão antiga em cache do SW — passa por cima.
3. **O SW serve `js/rh.js` do cache** (`sw.js:28`, `sw.js:62`). Uma máquina de RH com
   versão velha em cache continua validando pela regra velha por tempo indeterminado. Regra
   no servidor entra em vigor no deploy; regra no cliente entra em vigor "quando cada
   máquina atualizar".
4. **A regra de duplicidade é impossível no cliente.** Ela depende do conjunto de todos os
   telefones ativos — o cliente teria que baixar todos, o que é exatamente o tipo de
   preload que R1 do `docs/ameacas-v3.md` fechou.
5. **O servidor é o que responde na auditoria.** "O sistema garante canal de contato" é
   afirmação sobre o dado gravado, não sobre a tela que estava aberta.

A tela continua validando — é o que dá erro na hora e evita ida e volta. Ela só não é onde
a garantia mora. **Cliente para agilidade, servidor para garantia.**

### 3.3 Matrícula duplicada

**Invariante 3.3a.** Matrícula é única entre colaboradores **ativos**, comparada após
normalização (trim, caixa, zeros à esquerda).
**Teste:** segundo cadastro com a mesma matrícula → `409` com `campo: 'matricula'`; e
`0042` colide com `42` se a normalização de zeros for a escolhida (a decisão precisa ser
tomada e cravada — as duas são defensáveis, o que não é defensável é ficar indefinida).

**Invariante 3.3b.** Reaproveitar matrícula de **inativo** é permitido e explícito: o
servidor responde com um conflito que informa a quem pertence, e o RH escolhe entre
reativar aquela pessoa ou seguir com cadastro novo. Nunca decide sozinho.
**Teste:** matrícula de inativo → resposta identifica o titular anterior e não grava até a
escolha; reativar preserva o histórico de marcações da pessoa original.

Por que isso é de segurança e não de UX: reaproveitar matrícula em silêncio é o caminho
mais curto para o histórico de ponto de uma pessoa passar a ser lido como o de outra.

### 3.4 Pessoa em duas equipes

O modelo é de uma equipe por pessoa (`efrat_pessoa.equipe_id`, `js/rh.js:433`), e a carga é
escopada por `equipes_ids` do aparelho (R1). "Duas equipes" hoje é um estado impossível de
representar — o risco não é conflito de dados, é **contorno operacional**: o RH que precisa
de uma pessoa em dois canteiros vai duplicar o cadastro, com matrículas ligeiramente
diferentes para escapar de 3.3a.

Duas pessoas biométricas com o mesmo rosto na mesma unidade quebram o 1:N de
`/efrat/identificar`: a margem entre 1º e 2º candidato (`ranquear`, `js/regras.js:24-32`)
vai a zero, e o desempate vira sorteio.

**Invariante 3.4a.** O produto continua com uma equipe por pessoa; remanejamento é atendido
por `/efrat/identificar` on-line, que já é o caminho desenhado (`fluxo.spec.js:237`).
**Teste:** já coberto; nada novo.

**Invariante 3.4b.** O cadastro rejeita **rosto já cadastrado em outra pessoa ativa**: no
momento de gravar template (por qualquer dos 3 caminhos), o servidor compara com a galeria
da unidade e recusa se a menor distância ficar abaixo do limiar de aceite.
**Teste:** cadastrar as fotos da pessoa A no `pessoa_id` da pessoa B → recusa, com mensagem
que diz que aquele rosto já pertence a um cadastro ativo (sem revelar **qual**, se o RH
que opera não tiver escopo sobre a outra pessoa).

3.4b é a defesa de fundo do §1.3: mesmo que um link vaze e o atacante submeta a própria
face, ela é recusada se ele já for cadastrado — e o caso restante (atacante de fora do
quadro) é o que a fila de aprovação pega.

### 3.5 Colaborador inativo com fila pendente

Já há teste para inativo (`fluxo.spec.js:337`, rejeição no servidor), mas ele cobre a
rejeição, não a **ordem dos eventos**. O caso real: a pessoa bate ponto às 7h, o RH inativa
às 9h (desligamento), o aparelho sincroniza às 11h. A marcação das 7h é legítima.

**Invariante 3.5a.** A validade da marcação é decidida pelo estado da pessoa **no instante
da marcação** (`marcado_em`), não no instante da sincronização.
**Teste:** marcação com `marcado_em` anterior à inativação sobe como válida; posterior é
rejeitada.

**Invariante 3.5b.** Rejeitada nesse cenário fica **retida e visível**, com o motivo
("colaborador inativado em <data>"), nunca descartada em silêncio — mesma disciplina de
2.2b.
**Teste:** o item aparece em Ajustes com o motivo; não some da fila sem decisão.

**Invariante 3.5c.** Inativar **não apaga** biometria nem histórico (a decisão travada em
`docs/fase3-rh-pessoas.md` já diz "sem apagar histórico"); apenas tira a pessoa das cargas
seguintes e do 1:N.
**Teste:** após inativar, `/efrat/carga` não traz a pessoa e `/efrat/identificar` não a
reconhece; reativar devolve as duas coisas sem recadastrar face.

### 3.6 Edição concorrente do mesmo cadastro

Hoje é **last-write-wins silencioso**: `/rh/colaborador` recebe o registro inteiro
(`js/rh.js:431-434` e `:512-515`) e grava. Dois operadores com a mesma pessoa aberta — um
corrigindo o telefone, outro trocando a equipe — e o segundo a salvar apaga a alteração do
primeiro sem que ninguém veja.

O caso que dói de verdade é a combinação com 3.5: operador A inativa a pessoa, operador B
tinha a tela aberta de antes e salva um campo qualquer — o registro inteiro volta, e a
pessoa é **reativada por acidente**. Volta para as cargas e volta a bater ponto.

**Invariante 3.6a.** Toda edição carrega a versão que o operador leu; o servidor recusa com
`409` se a versão vigente for outra.
**Teste:** dois `POST` a partir da mesma leitura → o segundo é `409` e não grava.

**Invariante 3.6b.** No `409` a tela mostra **o que mudou e quem mudou**, e oferece
recarregar — não "erro ao salvar, tente de novo", que treina o operador a salvar duas
vezes até passar.
**Teste:** o corpo do `409` traz os campos divergentes e o autor da alteração vigente.

**Invariante 3.6c.** Ativo/inativo **nunca** é alterado por edição de cadastro. É ação
própria, com confirmação própria.
**Teste:** `POST` de edição com `ativo: true` sobre pessoa inativa não reativa; só a rota de
reativação reativa.

---

## 4 · D3 — As 3 fotos: um lote com duas pessoas não pode gerar template

### 4.1 Onde a regra mora hoje, e por que ali não serve

A verificação de coerência existe e está em **`js/rh.js:504-509`**, no navegador. Três
problemas, e cada um sozinho já invalida:

```js
const coer = Math.max(
  euclidiana(c[0].descritor, c[1].descritor),
  euclidiana(c[0].descritor, c[2].descritor),
  euclidiana(c[1].descritor, c[2].descritor));
if (coer > 0.55 && !confirm('As 3 capturas estão pouco parecidas entre si (' + coer.toFixed(3) +
  ').\n\nIsso costuma virar falso negativo depois. Salvar assim mesmo?')) return;
```

1. **É um aviso, não uma recusa.** `confirm()` — o operador clica OK e grava. O item D3 diz
   "recusa o lote em vez de gravar um template sujo"; o código pede licença para gravar.
2. **O limiar é 0,55, não 0,45.** Com as referências medidas do `README.md:129`
   (mesma pessoa 0,094 · diferentes 0,61 e 0,80 · aceite 0,45), 0,55 fica **entre** o par de
   pessoas diferentes e o aceite. A janela 0,45–0,55 grava calada.
3. **O servidor não verifica nada.** `/efrat/cadastro` exige só `vetores` não vazio
   (`tests/e2e/servidor-falso.js:544-546`). O campo `coerencia` que o cliente manda
   (`js/rh.js:520`) é **um número calculado pelo cliente e ignorado pelo servidor** — o
   atacante manda `0.01` com os vetores que quiser.

E há o agravante estrutural, que é o item 4 de `docs/validacao-biometrica.md:14`: **o
embedding é gerado no navegador**. O servidor recebe vetores, não imagens
(`js/api.js:131-138`). Ele pode verificar a coerência **entre os vetores que recebeu**, mas
não pode verificar que aqueles vetores vieram das fotos enviadas. Isso é limite conhecido
da arquitetura do piloto, não regressão desta fase — e é exatamente o que a migração para
extração no servidor resolve, fora do escopo aqui.

### 4.2 Onde a regra tem de morar

**No servidor, na rota de cadastro, como condição de gravação — e também no cliente, como
retorno imediato.** Não é redundância: são funções diferentes, pelo mesmo raciocínio do
§3.2. O cliente existe para dizer na hora "essa foto não serve, tire outra". O servidor
existe para que o template não possa ser gravado incoerente por nenhum caminho — RH, câmera
do PC, ou link público, que é onde não há operador nenhum vigiando.

**Invariante 4.2a.** O servidor recusa o lote quando a **maior** distância par a par entre
os três descritores for maior ou igual a `limiarAceite` (**0,45**, `js/config.js`). Maior, não
média: a média de (0,094 · 0,094 · 0,61) esconde o par ruim.
**Teste:** lote com dois descritores da pessoa A e um da B (par a 0,61) → recusa, nada é
gravado; lote de três da mesma pessoa (0,094) → grava. São exatamente os números medidos
do `README.md:129`, então o teste usa fixture real, não número inventado.

**Invariante 4.2b.** Recusa é `422` e **não grava nada** — nem template parcial, nem os dois
vetores que combinam entre si, nem pessoa com biometria "em andamento".
**Teste:** após a recusa, a pessoa continua sem template e a carga seguinte não a traz com
biometria.

**Invariante 4.2c.** O limiar vem da mesma configuração que decide o reconhecimento
(`limiarAceite`), não de uma constante paralela. Duas fontes divergem no primeiro ajuste de
calibração — e `docs/validacao-biometrica.md:85` avisa que esse número **vai** ser
recalibrado com dados da população da Efrat.
**Teste:** unitário sobre a função pura, alimentado com o valor de `cfg.limiarAceite`;
mudar a configuração muda o veredito do lote, sem mexer no código da regra.

**Invariante 4.2d.** Exatamente três descritores, exatamente um rosto por foto, cada um com
128 números finitos (`docs/adr-acesso-v3.md`, validação de `/efrat/identificar`). Dois
rostos numa foto é lote recusado — não "usa o maior".
**Teste:** 2 fotos, 4 fotos, foto com dois rostos, descritor com 127 posições, descritor com
`NaN` → todos recusados, cada um com seu código.

**Invariante 4.2e.** A regra é uma **função pura**, testável em Node sem DOM e sem rede —
mesmo padrão de `js/regras.js` ("sem DOM, sem rede, sem IndexedDB", `js/regras.js:1-3`) — e
é a mesma função que os três caminhos de cadastro chamam. Se o link público tiver a própria
cópia, ela vai divergir.
**Teste:** unitário da função pura com a matriz de casos acima; e um teste que confirma que
os três caminhos recusam o mesmo lote incoerente.

**Invariante 4.2f.** O `confirm()` de `js/rh.js:508` sai. Não vira `confirm()` mais severo:
sai. Enquanto existir um caminho em que o operador clica OK e grava, a invariante "lote com
duas pessoas não gera template" é falsa por construção.
**Teste:** com um lote incoerente, nenhum diálogo é oferecido e o botão de salvar não grava.

### 4.3 O teste que prova a recusa

**Escrito e rodando** em `tests/e2e/cadastro-coerencia.spec.js`, com o fixture calibrado em
`tests/e2e/fixtures-biometria.js`. Nasce vermelho de propósito (7 vermelhos / 1 verde hoje);
o verde é o aceite do T-8ADD9C.

> **`lote de 3 fotos com duas pessoas diferentes é recusado e não grava template`**
>
> Dado um colaborador sem biometria, e três descritores em que os dois primeiros são da
> mesma pessoa em poses diferentes (0,094) e o terceiro é de outra pessoa (0,61 do
> primeiro) — quando o lote é submetido a `/efrat/cadastro` — então a resposta é `422`;
> **e** a pessoa continua sem template; **e** nenhum diálogo de confirmação é oferecido em
> nenhum ponto do caminho.
>
> Contraprova no mesmo arquivo: três capturas da mesma pessoa (maior par 0,133) gravam
> normalmente — senão o teste passa por estar recusando tudo.

**Duas correções minhas, descobertas ao escrever o teste** (a versão anterior desta seção
estava errada nas duas, e o brief do T-8ADD9C herdou o erro):

1. **O triângulo 0,094 / 0,61 / 0,80 não existe.** A desigualdade triangular obriga a
   terceira distância a cair em `[0,61 − 0,094 ; 0,61 + 0,094]` = `[0,516 ; 0,704]`, e 0,80
   está fora. Os números de `README.md:129` são **dois pares medidos independentes**
   ("pessoas diferentes: 0,61 **e** 0,80"), não os três lados de um mesmo lote. O teste usa
   um par por vez — há um caso para 0,61 e outro para 0,80.
2. **`vetorDe` não serve de fixture aqui.** Medido:
   `distancia(vetorDe('p-ana'), vetorDe('p-bruno')) = 4,069` — uma ordem de grandeza acima
   de qualquer número real do domínio. Um teste que recusa a 4,069 prova que a regra recusa
   lixo, não que ela respeita o limiar de 0,45. Daí o fixture próprio, com distância
   construída, que senta no limiar de verdade (0,44 grava · 0,46 recusa).

**Questão de contrato que deixei em aberto de propósito, e que o T-8ADD9C precisa decidir:**
o comportamento em **exatamente 0,45**. `vereditoPorDistancia` (`js/regras.js:14`) aceita com
`dist <= limiarAceite`, então espelhar a regra do reconhecimento aceitaria o lote no limiar;
tratar o cadastro como mais conservador recusaria. O teste usa 0,44 e 0,46 para não cravar
por conta própria uma decisão que não é minha — mas ela precisa ser tomada, porque hoje as
duas leituras são defensáveis e um desencontro aqui vira bug silencioso.

Cobertura irmã, no mesmo lugar: **o link público submete o lote incoerente e recebe a mesma
recusa** — é o caminho sem operador, e portanto o que mais precisa da regra no servidor.

---

## 5 · O limite que o RH precisa conhecer: foto de foto passa

**Não há prova de vida, e isso é intencional** (`README.md:125`;
`docs/validacao-biometrica.md:107-135`). Não proponho liveness aqui — proponho o que o
produto **diz** ao RH, porque um limite conhecido é um risco gerenciado e um limite não
dito é uma surpresa em auditoria.

O ponto que torna isto urgente nesta fase: `docs/validacao-biometrica.md:33` registra que
**liveness também é necessário no cadastro** — *"sem isso, dá para cadastrar a foto de
alguém"*. A fase 3 acabou de criar dois caminhos de cadastro onde ninguém está olhando: o
upload de 3 fotos e o link público. A decisão de aceitar ausência de liveness foi tomada
para *marcação de ponto*, cujo pior caso é "colega bate ponto pelo outro, fica retido para
revisão". O pior caso no **cadastro** é diferente em espécie: um template errado grava-se
uma vez e vale para sempre, e a partir dali todas as marcações daquela pessoa passam a ser
de outra — corretamente aceitas, sem nada retido, sem nada para o RH revisar.

Não estou reabrindo a decisão. Estou registrando que ela foi tomada para o outro caso, e
que a compensação nesta fase é a fila de aprovação de §1.3 — que é humana, e por isso
precisa que o humano saiba o que está aprovando.

### 5.1 O que o produto diz, e onde

**Na tela de upload das 3 fotos, antes de escolher os arquivos** — visível, não em link de
ajuda:

> **O sistema não distingue uma pessoa de uma foto dela.** Use fotos que você mesmo tirou,
> ou recebeu diretamente do colaborador. Foto de tela, foto de crachá e foto de foto são
> aceitas normalmente pelo sistema — quem garante que é a pessoa certa é você.

Três razões para o texto ser esse: fala do que o RH faz (escolher arquivo), não do que a
tecnologia é; nomeia os três casos concretos que ele de fato vai encontrar; e é honesto
sobre onde a responsabilidade está, sem jargão — o usuário é leigo, e o item E de
`docs/fase3-rh-pessoas.md` pede exatamente isso.

**Na fila de aprovação de recadastro por link**, junto do par de miniaturas (§1.3b):

> Confira se é a pessoa certa. Este cadastro veio pelo celular do colaborador e ninguém do
> RH acompanhou a captura.

**No detalhe da pessoa**, permanente, como procedência do template:

> Face cadastrada em 21/08/2026 por Ana (RH) · por upload de foto

Procedência importa porque é o que permite auditar depois: "quais templates entraram por
upload, sem ninguém ver a pessoa?" é a primeira pergunta de qualquer incidente, e sem esse
campo ela não tem resposta.

**Invariante 5.1a.** Todo template registra origem (`rh_camera`, `rh_upload`, `link`), autor
e instante, e a origem aparece no detalhe da pessoa.
**Teste:** cadastrar pelos três caminhos → o detalhe mostra as três origens distintas.

**Invariante 5.1b.** O aviso de "foto de foto passa" aparece nos caminhos de **upload** e
**link**, e não no de câmera do PC — onde o RH está de fato vendo a pessoa. Aviso em todo
lugar é aviso em lugar nenhum.
**Teste:** o texto está presente na tela de upload e na fila de aprovação de link, e ausente
na captura por câmera.

**Invariante 5.1c.** O aviso é conteúdo da página, não `title`/`tooltip`/`aria-label`.
**Teste:** o texto é encontrado no conteúdo visível da tela.

### 5.2 O que **não** propor

- Não propor detecção de "foto de foto" no cliente (moiré, reflexo, textura). É PAD caseiro,
  passa a impressão de que existe defesa, e `docs/validacao-biometrica.md:126` já explica por
  que não há como fechar isso num PWA.
- Não propor bloquear upload. É um dos três caminhos que o cliente pediu, e para quem está
  em obra distante é o único viável.
- Não propor exigir "foto tirada agora" via metadado EXIF. EXIF é editável em um comando.

A defesa desta fase é **procedência registrada + fila humana informada**. É o que cabe
dentro da decisão que já foi tomada, e é honesto sobre o que garante.

---

## 6 · Resumo executável — invariantes por item

| Item | Invariantes | Onde o teste vive |
|---|---|---|
| **D1** link público | 1.0a · 1.1a-c · 1.2a-b · 1.3a-c · 1.4a-c · 1.5a-d · 1.6a-c · 1.7a-c | `tests/e2e/face-link.spec.js` (novo) + unit do token |
| **A** aparelho | 2.1a-f · 2.2a-e | **`tests/e2e/aparelho-liberacao.spec.js` (escrito)** + `fluxo.spec.js:130-155` |
| **C** validação | 3.1a-b · 3.3a-b · 3.4a-b · 3.5a-c · 3.6a-c | `tests/e2e/rh-pessoas.spec.js` (novo) + unit das regras puras |
| **D3** 3 fotos | 4.2a-f | **`tests/e2e/cadastro-coerencia.spec.js` (escrito, vermelho)** + `fixtures-biometria.js` |
| **limite** | 5.1a-c | e2e das telas de upload e da fila |

### Ordem sugerida, se a fase não couber inteira

1. **4.2a-b, 4.2f** — o `confirm()` que grava template sujo é o único item da lista que já
   está errado em produção hoje, não uma lacuna de coisa que ainda não existe.
2. **2.1a-b** — sem eles o item A entrega uma aba que aprova, não uma aprovação que prova
   posse. É a diferença entre fechar o achado e parecer fechado.
3. **1.0a, 1.3a** — os dois que definem o teto de gravidade do link público: isolamento de
   origem e "nunca sobrescreve template vigente". Com esses dois, o pior caso de um link
   vazado é um item a mais na fila do RH.
4. **2.2a-c** — o dado do colaborador honesto que hoje some em silêncio.
5. O restante na ordem da tabela.

### O que este documento não resolve

- **A chave PBKDF2 do RH continua sendo credencial permanente** (`js/rh.js:22-28`, dívida já
  registrada em `docs/ameacas-v3.md` com custo estimado de ~2,5–3 dias). Toda invariante de
  §2 e §3 pressupõe que quem está logado como RH é o RH. Vazada a chave, nada aqui segura.
- **O embedding continua sendo gerado no navegador** (§4.1). A coerência do lote é
  verificável no servidor; a procedência dos vetores não é.
- **O limiar 0,45 não foi calibrado com a população da Efrat** — as invariantes de §4 são
  corretas para o limiar configurado, seja ele qual for, e é por isso que 4.2c exige fonte
  única.

---

## Apêndice · Três padrões de teste que esta fase produziu

Não são teoria: cada um saiu de um defeito real desta rodada, e os três são a
mesma família — **verde que não prova o que o nome do teste promete**. Ficam aqui
porque as invariantes acima só valem se os testes que as sustentam não mentirem.

### 1. Guarda que documenta um defeito declara a própria obsolescência

Um teste escrito para travar um comportamento **errado** (para que ninguém dependa
dele sem saber) vira mentira no dia em que o comportamento é consertado. A
mensagem de falha dele é o lugar certo para dizer isso — ela é lida exatamente por
quem estiver olhando quando acontecer.

Instância: a guarda 2.1g afirmava que `#btnPonto` vinha habilitado embaixo da tela
escondida, com a mensagem *"se isto virar false, btnPonto passou a discriminar e
este guarda pode ser revisto"*. `index.html` passou a nascer `disabled`, a guarda
ficou vermelha, e a mensagem disse o que fazer: inverter a afirmação para
`toBeDisabled()` e travar a correção. Sem essa frase, o vermelho pareceria
regressão e alguém "consertaria" o produto de volta.

**Regra:** todo teste cuja asserção descreve um defeito aceito carrega, na
mensagem, a instrução para o dia em que o defeito morrer.

### 2. Não inferir de ausência

Afirmar que algo **não** aconteceu só vale se algo positivo provar que o caminho
rodou. Sem essa âncora, o verde não distingue *"foi impedido"* de *"ninguém correu
ainda"* — e sob CPU disputada a segunda hipótese fica mais provável, então o teste
fica mais verde justamente quando a máquina está pior.

O discriminador não é a forma da asserção, é se a coisa afirmada ausente **era
possível naquele instante**:

- `expect(locator).toHaveClass(/hide/)` re-tenta até o timeout: afirma "continuou
  escondido o tempo todo". Sólida.
- `expect(valorJs).toBeFalsy()` / `toBe(0)` fotografa um instante. Frágil **se** o
  tempo tornar possível o que ela nega.
- Uma ausência garantida por contrato (a operação é proibida) é permanente:
  esperar mais não a torna presente. Sólida.

Instâncias desta fase, todas do mesmo formato: o teste de offline verde porque a
checagem de dispositivo travava contra produção; `toBeEnabled()` que não olha
visibilidade; o critério 5b, cuja tela já estava visível antes do passo; e o
`chamadas.carga === 0` lido como fotografia. Consertos: âncora positiva antes da
negativa — a mensagem que só o ramo de falha escreve, ou o contador do caminho que
tinha de ter rodado.

### 3. Contraprova antes da negação

Um teste que só nega **passa contra uma rota que não existe** — `404` não ativa
nada. Verde por ausência de implementação mente pior que vermelho, porque não pede
atenção de ninguém.

Instância: os testes armados de 2.1 provam primeiro o caminho feliz (com o código
certo, ativa) e só então negam. Foi essa ordem que pegou um erro meu no mesmo dia —
uma substituição de constante falhou calada e os testes apontavam para a rota
antiga; sem a contraprova eles teriam ficado verdes contra o `404`.

**Corolário para ler resultado sob concorrência:** contenção de CPU degrada a
rodada inteira, não escolhe um teste. Verde geral sob concorrência é mais forte,
não mais fraco; um vermelho **isolado** entre verdes também é confiável. O que
exige repetir com a pista limpa é vermelho **espalhado**.
