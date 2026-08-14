# Efrat — Fluxo operacional do ponto facial · v3

Substitui a v2. O que mudou: **gestor e RH deixaram de dividir tela**. O aparelho de campo abre numa porta com dois botões, e cada um leva a um app diferente — o gestor nunca vê opção de administração, e o RH nunca precisa do aparelho da equipe.

---

## Hierarquia e atores

```
Empresa
  └── RH ......................... cadastra, revisa, fecha
       └── Unidade ............... escopo da carga
            └── Equipe ........... 12 a 20 pessoas · tem local esperado
                 ├── Gestor ...... opera o aparelho · também marca o próprio ponto
                 └── Funcionários. só mostram o rosto
```

O colaborador não tem login, não instala nada, não opera nada.
Equipes podem estar em lugares distintos — por isso a equipe tem local esperado, e a geolocalização passa a ser **conferível** contra ele, não só guardada.

---

## Momento 0 — A porta

A tela inicial tem **dois botões e nada mais**:

```
┌─────────────────────────────┐
│                             │
│     REGISTRAR PONTO         │   ← câmera. Não pede login.
│                             │
│        Acessar              │   ← usuário e senha. Só o RH tem.
└─────────────────────────────┘
```

**REGISTRAR PONTO** abre a câmera e a primeira coisa que ela faz é descobrir *quem está segurando o aparelho*. O rosto do gestor é procurado na carga; achou, o sistema **já registra o ponto dele** e abre a fila com a equipe e o local dele carregados. Zero digitação, zero escolha — o gestor chega, olha para o aparelho e a fila está aberta.

Reabrir a fila no mesmo intervalo **não** remarca o gestor: o cooldown vale para ele igual a todo mundo.

**Acessar** pede usuário e senha, e leva ao painel do RH: cadastro de colaboradores, equipes, pendências, espelho de ponto e indicadores. Nada disso existe na tela do gestor.

Por que separar: o gestor com 20 pessoas na fila e o RH fechando a folha têm pressa de coisas opostas. Uma tela que serve aos dois atrapalha os dois — e "cadastrar colaborador" ao lado de "marcar ponto" é um botão errado a um toque de distância.

---

## Momento 1 — Cadastro

1. RH cria o colaborador e faz as 3 capturas com o gate de qualidade.
2. Coerência ruim → refaz na hora. Cadastro ruim não entra.
3. Colaborador passa a existir na equipe dele.

**Recadastro pelo gestor** — quando o colaborador passa a falhar com frequência (mudou muito, cadastro ficou ruim):

- o gestor captura de novo pelo próprio PWA;
- isso **adiciona uma versão nova, não apaga a anterior**;
- entra como pendência para o RH aprovar;
- reprovado, volta para a versão anterior com um toque.

Recadastro é o mesmo poder que cadastro entrando por outra porta. Por isso passa pelo RH.

---

## Momento 2 — Carga

O gestor faz login e o aparelho baixa **a unidade inteira**: templates + miniatura de referência + nomes.

| | |
|---|---|
| Tamanho | equipe de 20 ≈ 200 KB · unidade de 100 ≈ 1,5 MB |
| Galeria padrão | **só a equipe do gestor** |
| Remanejado de outra frente | botão "buscar na unidade" — resolve sem manual e sem internet |
| Validade | expira no fim do turno |
| Renovação | **automática no login**, nunca um botão para o gestor lembrar |
| Em repouso | cifrada, presa à sessão, sem foto em resolução original |

Carregar a unidade e filtrar pela equipe resolve remanejamento sem inflar a galeria de reconhecimento — que continua sendo 12 a 20 pessoas.

**Carga velha é o risco real:** demitiu na sexta, gestor não atualizou, demitido marca na segunda. Por isso a expiração é automática, e o servidor **rejeita marcação de gente inativa** quando o lote sobe, mesmo que o aparelho tenha aceitado. Vira pendência, não passa batido.

---

## Momento 3 — Marcação

**Duas por dia: entrada e saída.** Intervalo pré-assinalado.
→ 20 pessoas × 2 = 40 capturas diárias por aparelho. Confortável.
*(Confirmar com o jurídico se a pré-assinalação de intervalo vale para REP-P.)*

Uma tela, uma ação:

```
1. Gestor abre a fila (e já marcou o próprio ponto ao ser reconhecido)
2. Colaborador olha
3. Captura automática quando a qualidade passa
4. Sistema propõe o nome → gestor confirma → registrado
5. Próximo
```

Entrada ou saída o sistema deduz do que já existe no dia. O gestor nunca escolhe.

**Quatro desfechos:**

| Desfecho | Ação | Vai ao RH |
|---|---|---|
| Reconhecido | Registra + comprovante | Não |
| Zona cinzenta | **Registra** e sinaliza | Sim |
| Não reconhecido | Não registra, tenta de novo | Só se virar manual |
| Não capturou | Orienta (luz, adorno) e tenta de novo | Só se virar manual |

Após 3 tentativas, aparece **Registrar manualmente**: nome + motivo. Sempre vai ao RH.

**O ponto do gestor.** Ele opera e também marca — então é a única marcação sem ninguém conferindo. Fica **sempre marcada para revisão do RH**. Não trava nada no campo, só não passa despercebida.

A tela mostra o tempo todo: quantos marcaram, quem falta, quantos pendentes de envio.

Cada marcação guarda: horário, foto de auditoria, score, geolocalização, aparelho, quem operava.

---

## Momento 4 — Sincronismo silencioso

**Nenhuma operação de campo espera pela internet. Nunca.**

1. A marcação é gravada **primeiro no aparelho** e confirmada na tela na hora.
2. Vai para uma fila de envio local.
3. Um processo de fundo esvazia a fila sempre que houver rede.
4. Sem rede, nada muda para o gestor — a fila só cresce.
5. O único sinal visível é um contador discreto: *"3 pendentes"*. Sem pop-up, sem bloqueio, sem aviso.

Quatro cuidados que isso exige:

**Duplicidade.** Cada marcação nasce com um identificador único gerado no aparelho. Reenvio depois de timeout não vira ponto dobrado — o servidor descarta o repetido. Sem isso, uma falha de rede vira erro de folha.

**Relógio.** O horário vem do aparelho. Relógio errado — ou alterado de propósito — vira ponto errado. O aparelho guarda também a diferença para o relógio do servidor, medida na última sincronização, e o servidor registra a hora em que recebeu. Divergência grande vira pendência. *(No aparelho corporativo, travar hora automática no MDM resolve na raiz.)*

**Espaço.** O navegador pode limpar o armazenamento sozinho sob pressão de disco — e aí some ponto não enviado. O app precisa pedir armazenamento persistente na primeira execução. É o risco mais sério dessa fase, e ele desaparece quando virar app nativo.

**Volume.** 40 marcações com foto de auditoria dão uns 4 MB por dia. Tranquilo. Se um dia subir vídeo para o liveness do servidor, a fila offline precisa de teto: a foto vai sempre, o vídeo só quando houver espaço e rede.

A carga é a mesma máquina, na direção contrária: entra equipe, sai marcação. As duas em silêncio.

---

## Momento 5 — Fechamento (RH)

1. **Pendências** — zona cinzenta, registros manuais, ponto do gestor, recadastros aguardando aprovação, divergência de relógio. RH vê a foto de auditoria ao lado da de cadastro e decide.
2. **Espelho por colaborador** — correções entram como lançamento novo, nunca como edição.
3. **Exportação** — AFD e AEJ.

---

## Indicadores

**Gestor, no app:** quantos marcaram, quem falta, quantos pendentes de envio. Só isso.

**RH, no painel:**

| Operacional | Saúde |
|---|---|
| % da equipe que marcou | % que não capturou |
| Atrasos e ausências | % em zona cinzenta |
| Pendências abertas por equipe | **% de registro manual** |
| Equipes sem marcação hoje | Tempo médio por marcação |
| | Marcações presas na fila há mais de 24h |

**Taxa de registro manual por equipe é o alarme principal.** Subiu numa equipe: ou a biometria parou de funcionar ali, ou alguém está contornando ela. Nos dois casos você quer saber antes do fechamento da folha.

---

## Regras invioláveis

1. O ponto **nunca** é negado por falha técnica.
2. Nenhuma operação de campo espera pela internet.
3. Nada é sobrescrito — correção é lançamento novo.
4. Toda exceção termina na mesa do RH.
5. O colaborador recebe comprovante de toda marcação.

---

## Três pontos novos para você confirmar

1. **Duas marcações por dia com intervalo pré-assinalado** — foi assim que entendi o seu "item 1 sim". Se forem quatro, me avise: dobra a carga do aparelho e muda o dimensionamento da fila.
2. **Ponto do gestor sempre em revisão** — proposta minha, já que ninguém o confirma. Se achar burocrático demais, a alternativa é só destacá-lo no indicador, sem virar pendência.
3. **Gestor substituto.** A regra garante que sempre existe um gestor — mas não garante um aparelho funcionando. Se o celular quebrar ou ficar sem bateria, o substituto precisa conseguir puxar a carga daquela equipe no aparelho dele. Ou seja, gestor e equipe não podem ser um-para-um fixo na permissão.

---

## Estado da implementação

| | Item | Onde |
|---|---|---|
| ✅ | Porta com dois botões, sem menu | `js/app.js` |
| ✅ | Gestor identificado pela face ao abrir a fila, com o próprio ponto registrado | `js/fila.js` |
| ✅ | Captura automática — sem botão de disparo | `js/face.js` |
| ✅ | Nome proposto + confirmação com um toque | `js/fila.js` |
| ✅ | Entrada ou saída deduzido do dia | `regras.tipoDaVez` |
| ✅ | Registro manual com motivo, após 3 falhas | `js/fila.js` |
| ✅ | Fila de envio local, id único e armazenamento persistente | `js/store.js`, `js/api.js` |
| ✅ | Envio único em voo (cadeado da deduplicação) | `Api.sincronizar` |
| ✅ | Carga da unidade com galeria filtrada por equipe | `js/api.js` |
| ✅ | Comprovante ao colaborador | `js/fila.js` |
| ✅ | Geolocalização no instante da marcação, nunca em segundo plano | `js/fila.js` |
| ✅ | Painel do RH: pendências, pessoas, equipes, registros e indicadores | `js/rh.js` |
| ✅ | Recadastro pelo gestor entrando como pendência | `js/fila.js` |
| ⬜ | Exportação AFD / AEJ | — |
| ⬜ | Prova de vida certificada (ISO/IEC 30107-3 Level 2) | — |
| ⬜ | Reconferência do embedding no servidor | — |

Os três em aberto são justamente os que dependem de sair do piloto: os dois últimos exigem servidor fazendo o trabalho pesado, e o primeiro exige o registro do REP-P no INPI (Portaria MTP 671/2021, art. 91).
