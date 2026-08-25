# P0 de produção + frente da API · 25/08/2026 (Orquestrador)

## O incidente, medido por mim

O v3 está publicado em `control-face-id.vercel.app` e **o ponto do cliente está
morto — não degradado**. Achado do Especialista n8n; verifiquei por `curl`:

```
/efrat/carga                  → 401
/efrat/dispositivo/registrar  → 404 NOT REGISTERED
/efrat/identificar            → 404 NOT REGISTERED
/efrat/carga-v3               → 404 NOT REGISTERED
```

**O hotfix está descartado, e o motivo é lógico e não de preferência.** A saída
"fazer os 3 workflows v2 aceitarem `Authorization: Bearer`" não resolve: sem
`dispositivo/registrar` em produção, **nenhum aparelho obtém credencial**. Não
existe Bearer para mandar nem contra o que validar. Aceitar Bearer só moveria a
falha de lugar. Sobra rollback.

**Ordem dada ao DevOps:** histórico de deploy da Vercel primeiro, depois rollback
promovendo o último deploy anterior ao v3 (entrou em `main` via `d13d39a`),
confirmado **por `curl` e não pelo painel**. Proibido tocar em workflow do n8n —
aquela instância hospeda 79 workflows e só uma fatia é do ponto.

**Tensão não resolvida, e ela importa:** `e9bb653` conserta um defeito que o
cliente relatou tendo reconhecido um gestor e batido ponto **em produção**. Com
`registrar` em 404, isso não podia ter acontecido no v3. Ou o relato veio da v2,
ou algo mudou depois. O histórico de deploy responde; adivinhar não.

## O que o inventário do n8n revelou

Das 24 rotas que o cliente chama: **5 funcionam** (RH básico), **3 estão
quebradas** (as de aparelho), **16 nunca tiveram workflow**. Boa parte do que o
quadro marcava CONCLUÍDO em Fase 2/3 era frontend + `servidor-falso.js`; **o
backend nunca acompanhou**.

Consequência boa para o plano de corte: 16 rotas já dão 404, então migrá-las é
trocar 404 por funciona, **sem regressão possível**. Corte de verdade é só nas 8
com workflow ativo.

Discrepância `/efrat/carga` vs `carga-v3`: resolvida, não era mistério — path
temporário decidido em 19/08 para coexistir com o workflow antigo (que só existe
em n8n, `iykvFQQfkNv4jIxM`). Com a API entrando, vai do v2 direto para a API.

## Decisões que tomei neste ciclo

1. **Rollback, não hotfix** — pelo argumento do `registrar` acima.
2. **Fatia vertical, não largura.** O Full-Stack travou porque `nucleo/` só tinha
   a interface de repositório; (a) núcleo puro e (c) adaptador HTTP não existiam
   em branch nenhum. Esperar serializava o caminho crítico; ele portar a lógica
   colidia de frente com a parte 2/2 viva do Arquiteto. Repartição: o Arquiteto
   entrega **uma** rota fim-a-fim (`/efrat/marcacoes` — exercita o caminho
   atômico, a checagem de estado do aparelho e é a primeira que o cliente toca
   amanhã) e o Full-Stack replica o padrão nas outras 24. Uma fatia define a
   forma; o resto é volume, e volume paraleliza.
3. **Idempotência vira cartão (T-692AE3), não muda agora.** Hoje o que segura as
   escritas perigosas são as operações ATÔMICO por baixo — e isso ninguém
   escreveu e nenhum teste prova. O cartão exige que a decisão **nomeie, escrita
   por escrita**, de qual das duas ela depende.
4. **Núcleo importando de `js/` fica como está**, adiado de propósito até o API-2
   entregar a forma do deploy: "a API depende do bundle do cliente" só é problema
   se a API for publicada separada do repo. Mover `js/` agora compraria conflito
   com Full-Stack e Biometria por zero ganho.
5. **Nono membro aberto:** Engenheiro de Persistência e Dados (`34150c15fa`), para
   API-3 correr em paralelo com API-4 contra a mesma interface. O gargalo era uma
   pessoa só no caminho crítico.

## Achado do Arquiteto que vale registrar

Ele encontrou **quatro** operações do mesmo molde além das duas que eu exigi, e
marcou ATÔMICO: `aprovarDispositivoPorCodigo`, `trocarEstadoDispositivo`,
`atualizarPessoaSeVersao` e `consumirTokenLegado`. A última é a mais grave e
ninguém tinha visto: hoje é booleano lido e depois gravado, e **dois aparelhos
podem migrar com a mesma credencial**.

Também: a suíte tem **174** e2e, não 173. O número que eu vinha repetindo era
herdado; o dele é medido (`--list`, 22 arquivos).

## Frente aberta, quem está com o quê

| Cartão | Quem | Estado |
|---|---|---|
| P0 rollback | DevOps `e86a2624ee` | executando |
| T-C8316C · API-1 fatia vertical | Arquiteto `cf19388e43` | interface entregue (`49d23c1`), parte 2/2 em obra |
| T-25C98B · API-3 persistência | Persistência `34150c15fa` | recém-aberto |
| T-D3DC5C · API-4 rotas | Full-Stack `615dfda777` | mapeando as 25 rotas |
| T-7A35B5 · API-5 arnês | QA `cfb62f5154` | arnês antes das rotas |
| T-5D99FB · API-6 plano de corte | n8n `21e3bab28e` | entregue, em review |
| T-D96E06 · API-7 migração de dados | n8n `21e3bab28e` | recém-aberto |
| roteiro de teste em produção | Designer `1e5e2eb3ea` | recém-aberto |
| T-A17B32 + T-55A616 | Biometria `bdf5f40f33` | paralelos, não bloqueiam |

## Risco de prazo número 1, e ele é novo

**API-7.** O cliente tem dados vivos nas Data Tables — pessoas, equipes,
dispositivos, histórico, templates de face. A API nasce com banco **vazio**.
Virar a chave sem migrar apaga o cadastro do cliente da vista dele, e aí nem o
rollback salva, porque os dados novos ficaram do outro lado. Pedi ao n8n que me
diga **hoje** se o volume torna "produção amanhã" impossível — prazo que morre
calado é o pior resultado possível.

## Pendência da mão do usuário

`central-agentes task move T-92D567 done` — conferido no código, bloqueado pelo
classificador duas vezes.

## Próximo passo

Receber: histórico de deploy + rollback confirmado por `curl` (DevOps), fatia
vertical (Arquiteto), mapa das 25 rotas com a coluna do primeiro turno
(Full-Stack), volume dos dados (n8n). O corte de escopo, se precisar, sai dessa
coluna do primeiro turno.

---

## Reversão: eu ordenei o rollback e ele estava errado

Registrado como decisão revertida, com a proposta, o motivo e o contra-argumento
— não apagado.

**O que eu ordenei:** rollback do deploy para `269cd42`, o último antes do v3.

**Por que estava errado, e o DevOps não tinha como ver — está dentro de `js/`:**
`js/store.js` do v2 faz `indexedDB.open('efrat-ponto', 1)`; o v3 faz `open(..., 2)`.
Aparelho que já virou v3 tem o banco na versão 2, e abrir IndexedDB com versão
**menor** que a existente lança `VersionError` por especificação. O shell v2 não
abriria nem o armazenamento. **O rollback trocaria 401 por app que não sobe** — e
o token que precisaríamos em mãos está dentro desse mesmo banco inalcançável.

**O que a apuração do DevOps mudou, e é o fato que reposiciona tudo:** o n8n
**nunca saiu do v2**, e o conjunto v2 está **íntegro**. Não há nada quebrado para
consertar — há duas metades despareadas.

**A frota está partida**, e a data prova: o conserto do "já marcou" foi commitado
`21/08 15:58 UTC`; o v3 subiu `20/08 01:40 UTC`. O relato do cliente é de dentro
da janela v3, e o v3 não alcança `carga` nem `identificar` — logo aquele aparelho
servia o **shell v2 do cache**. Quem nunca ativou o SW v3 continua batendo ponto;
quem ativou está morto. O "desde 24/08" do incidente é na verdade "desde que o SW
daquele aparelho ativou".

**Nova direção: para frente.** Os workflows v3 existem escritos em `n8n/` e nunca
foram publicados. Publicar `dispositivo/registrar`, `dispositivo/estado` e
`identificar` é de graça — hoje dão 404, não quebram ninguém — e destrava o
registro de aparelho, que é a raiz da paralisia. `carga-escopada` já nasceu no
path `efrat/carga-v3` exatamente para coexistir com o v2: a decisão de 19/08
estava certa e ninguém tinha executado.

**Restrição que manda em tudo:** não substituir os workflows ativos de `carga`,
`marcacoes` e `cadastro` — eles servem a frota que ainda está em v2.

**Crédito onde é devido:** o DevOps provou as três impossibilidades no Neon real
em vez de aceitar do meu handoff, e já deixou a origem da API no ar
(`control-face-id-api.vercel.app`). O comando de rollback fica **anotado, não
apagado**: se a frente para frente falhar hoje, ele volta à mesa — acompanhado de
um conserto do `VersionError`.
