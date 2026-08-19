# Privacidade da tela compartilhada — o que quem está atrás na fila vê

T-64668A. Ameaça diferente das de `docs/ameacas-v3.md`: lá o adversário é externo
(dispositivo comprometido, flood, spoof). Aqui não há adversário — é vazamento de
dado pessoal **entre colegas**, no uso normal e legítimo do aparelho. Não vira
incidente de segurança; vira problema trabalhista (constrangimento, fofoca sobre
banco de horas, sobre quem chega atrasado). Documento apenas — não sou dono de
`index.html`/`css/tema.css` (Full-Stack, T-607E5A/T-8FB792); isto é requisito de
conteúdo e critério de aceite para quem desenha essas telas.

## O que o ADR já resolve, e o que não resolve

`docs/adr-acesso-v3.md` (aceito, commit `35f7bbc`) já fecha o problema de **sessão
que fica aberta depois que a pessoa sai**: TTL de 90s de inatividade / 3min
absoluto pro colaborador, 5min/10min pro gestor, limpeza de DOM/memória ao expirar,
ao perder visibilidade por 30s, ao bloquear o aparelho ou tocar em "Sair". Isso é
necessário e está correto.

**O que o TTL não toca:** exposição **durante o uso legítimo, dentro do prazo**.
O aparelho é segurado por uma pessoa com a fila física a um braço de distância —
é a distância normal de conversa, não uma falha de operação. Toda vez que alguém
bate o ponto, por até 3 minutos (colaborador) ou 10 (gestor), a tela mostra dado
pessoal pra quem está pertinho, sessão válida, sem nenhum TTL ou expiração
envolvidos. TTL reduz o **tempo de exposição depois do uso**; não reduz a
exposição **durante** o uso, que é a maior parte dos casos reais — todo mundo
que bate ponto numa fila ocupada gera essa janela, todo santo dia.

## Cenários concretos

### 1 — Banco de horas e histórico na tela pessoal do colaborador (mais frequente, maior volume)

`docs/plano-v3.md` descreve a tela pessoal pós-reconhecimento com saudação
("Bom dia, Camila"), banco de horas, histórico e "solicitar ajuste" (mockup:
home `433`, histórico `553`, espelho `590`, ajuste `629`). A tela de **sucesso**
(`523`) já é minimalista — círculo verde, hora mono, comprovante chave→valor —
e isso é o correto: o que ali aparece (horário da própria marcação) já é
visível de qualquer forma pra quem está do lado. O problema são as telas
**depois** dessa: se banco de horas ou histórico aparecem na aba seguinte, a
um toque de distância, dentro da mesma sessão de 3 minutos, o padrão de uso
real é exatamente "bati o ponto, já aproveito e confiro meu saldo" —
comportamento normal, não descuido — e isso acontece com a fila ainda ali do
lado. Volume: uma equipe de 20 pessoas × 2 marcações por dia = 40 janelas de
exposição por aparelho por dia, todos os dias do piloto.

**O que fica exposto, especificamente:** saldo de banco de horas (pode ser
negativo — "devendo horas", informação que colaboradores tratam como
constrangedora) e o histórico de horários do dia/semana (revela atraso, saída
antecipada — adjacente a assunto disciplinar). Diferente do horário de uma
marcação isolada (que já é público pro grupo por natureza — todos veem quem
chegou), banco de horas e histórico completo são dados que a pessoa
tradicionalmente só compartilha com o RH.

### 2 — Painel "ver minha equipe" do gestor expõe várias pessoas de uma vez, pro grupo, não só pra quem está atrás

Este é estruturalmente pior que o cenário 1: o gestor segura o aparelho na
frente da própria equipe reunida (é literalmente o contexto de uso descrito no
plano — "vê o status atual da equipe"). A audiência não é "a próxima pessoa na
fila", é **o grupo inteiro que está ali**. Um card com `em_jornada` / `intervalo`
/ `ausentes` e nomes (`POST /efrat/gestor/equipe-hoje` no ADR devolve `pessoas`
com `nome` e `estado`) vira, na prática, um mural público de quem faltou ou
está atrasado, lido por todo mundo ao redor no exato momento em que o gestor
consulta — sem precisar de nenhum vazamento técnico, é o uso pretendido da
função funcionando exatamente como especificado.

### 3 — Nome completo lado a lado com número sensível, em fonte grande, à distância de leitura

`docs/plano-v3.md` define números sempre em IBM Plex Mono, "a assinatura do
design", em tamanhos que vão até 38px — pensado pra ser lido rápido e com
clareza, o que é bom para o comprovante de ponto e ruim para saldo de banco de
horas: fonte grande e de alto contraste é exatamente o que torna um número
legível a distância, por quem não devia estar lendo. A saudação com o primeiro
nome ("Camila") ao lado desse número resolve a atribuição em menos de um
segundo de relance.

## Recomendações (requisito de conteúdo, não de sessão — endereçadas ao Full-Stack)

Nenhuma delas contradiz ou reabre o TTL do ADR; são independentes e se somam.

- **M1 — Dado sensível nunca no primeiro estado da tela pós-reconhecimento.**
  A tela imediata (comprovante) mostra só o que já é público pro grupo por
  natureza: nome, tipo de marcação, horário. Banco de horas e histórico
  completo ficam atrás de uma aba separada que exige um toque adicional e
  deliberado — não elimina a exposição, mas tira do caminho do "bati o ponto e
  já vi de relance", que é o padrão de maior volume.
- **M2 — Números sensíveis (banco de horas, histórico) não usam a mesma escala
  tipográfica de leitura-a-distância do comprovante.** Fonte menor, sem o
  destaque de 26-38px reservado ao horário da marcação — o objetivo aqui é o
  oposto do resto do design system: dificultar leitura de relance, não facilitar.
- **M3 — Painel "ver minha equipe" do gestor não deveria abrir automaticamente
  no fluxo de reconhecimento em sequência com a fila operando.** Ele expõe
  N pessoas de uma vez para quem estiver por perto, um risco maior em espécie
  que o do colaborador individual (cenário 2). Isto é tensão real com "sessão
  curta sustentada pela face" do plano — não é uma decisão minha pra tomar
  sozinho; registro como ponto que o Orquestrador/cliente precisa decidir
  conscientemente, com o trade-off explícito, antes do Full-Stack implementar
  T-8FB792.
- **M4 — Saudação por nome não fica no mesmo cartão visual que qualquer número
  sensível.** Pode ficar com jornada/comprovante (já público), não com banco de
  horas/histórico.
- **M5 — Retorno automático (TTL do ADR) continua sendo a defesa de última
  linha, não a primeira.** M1–M4 reduzem exposição durante os 90s/3min úteis;
  o TTL cobre o que sobra depois que a pessoa se afasta.

## Critérios de aceite para a T-38A7C1 (testes a criar)

- A tela imediatamente após o reconhecimento (comprovante) não contém, em
  nenhum nó do DOM, valor de banco de horas ou histórico — só confirma a
  marcação atual. Verificação no DOM, não só visual, porque impede também
  inspeção casual via zoom de foto/câmera de quem está por perto.
- Banco de horas e histórico só aparecem depois de uma ação explícita
  (clique/toque em aba própria), nunca como conteúdo inicial da sessão pessoal.
- Painel de equipe do gestor: teste de contrato confirma que `nome` +
  `estado` por pessoa é exatamente o que o ADR especifica em
  `/efrat/gestor/equipe-hoje` (nada além disso) — decisão de UI (M3) fica
  registrada aqui como pendência de produto, não como teste automatizável.

## Fora de escopo deste documento

Ataque técnico ao conteúdo da tela (ex.: gravação de tela por outro dispositivo,
câmera escondida) não é o modelo de ameaça aqui — é vazamento por proximidade
física normal, tratável por conteúdo/design, não por controle de acesso. Isso
já está coberto, no que depende de autenticação, por `docs/ameacas-v3.md`.
