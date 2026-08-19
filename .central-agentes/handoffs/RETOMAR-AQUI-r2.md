# RETOMAR AQUI — rodada r2 (fc42c1ff9f). Leia inteiro antes de agir.

Continuação de `RETOMAR-AQUI.md` (branch `central/50bbfbf909/f9024bcab1-control_face_id`),
que **continua válido** para contexto de cliente, decisões e backend n8n. Este arquivo é só
o delta da rodada r2.

## A primeira coisa: o kanban é o Pipeline do Ambiente

`/home/bruno-luiz/.local/bin/central-agentes task list` — **antes** de olhar código.
Os branches de cada rodada nascem do `main` (`269cd42`, 14/ago) e estão zerados em relação
ao v3. Quem deduzir o estado do projeto pelo git do próprio worktree conclui que está tudo
verde e pronto. Eu cometi esse erro no início desta rodada; o cliente me corrigiu.

## Base de trabalho: `integra/v3-r2`

Worktree em `.../6748a991-.../scratchpad/integra-v3`. **É só leitura para os especialistas** —
eles trabalham no worktree próprio e mesclam esta como base. Regra criada porque encontrei
dois agentes editando esse diretório sem commit ao mesmo tempo (ver incidentes).

`integra/v3` antigo (`aa8d8e7`) intacto, também em `backup/integra-v3-aa8d8e7`.

Commits:
- `20951de` integração dos 4 branches + correção das guardas 6 e 7
- `4661285` WIP Revisor (T-38A7C1): `fluxo.spec.js` reescrito — **salvamento, não aceite**
- `c5b94a7` WIP Full-Stack (T-8FB792): painel do gestor, `js/gestor.js`, `gestor.spec.js`

## Testes

Última medição confirmada: **59 unit verdes**, 7 e2e verdes (`acesso.spec.js` 6 + `offline.spec.js` 1).

**MEDIÇÃO EM VOO no fim do ciclo** — não foi concluída. Rodando a suíte completa em
`integra/v3-r2` (já com a reescrita do Revisor e o painel do Full-Stack):
`suite.json` + `suite.err` no worktree de integração; o resumo por arquivo sai no
task output `br9d29yon`. **Se `suite.json` existir, leia-o primeiro** — ele responde a
pergunta que travou dois cartões. Se não existir, refaça:
`PLAYWRIGHT_JSON_OUTPUT_NAME=suite.json npx playwright test --retries=0 --reporter=json`

Por que ela importa: se a reescrita do Revisor estiver verde, **a quarentena da guarda 8 não
é necessária** e o DevOps não deve construir a catraca. Ele está em standby esperando esse
número, que pode ser zero.

## Duas regras operacionais criadas (custaram medições perdidas)

1. **Nunca dois Playwright ao mesmo tempo.** `fullyParallel:false`, `workers:1`, cada teste
   sobe o próprio servidor falso; duas rodadas disputam porta e o sintoma é teste vermelho
   que parece bug de código. Antes de e2e: `pgrep -cf 'playwright test'` deve ser 0.
   Unit (`node --test`) pode sempre. **Eu mesmo perdi duas medições assim.**
2. **`integra/v3-r2` é só leitura.** Ver acima.

## Cartões

Fechados nesta rodada, com prova:
- **T-607E5A** — mutei `js/app.js:173` (`ultimoEstado==='ativo'` → `true`, o fail-open de
  volta) e o **critério 5b reprovou**. Ressalva registrada: o 5a passa mesmo mutado, logo
  não prova o gate.
- **T-5A062C** — guardas do DevOps provadas em uso: pegaram 2 bugs na integração.

Abertos:
- **T-38A7C1 (Revisor)** — reescrita FEITA e salva em `4661285`; falta a medição sozinho.
  Ele já puxou a base e conferiu que o resgate é byte-idêntico ao que escreveu.
- **T-8FB792 (Full-Stack)** — `gestor.spec.js` 5/5 com mutação dirigida real (quebrou o `if`
  de `nomesAbertos`, viu cair, reverteu). Escopo: só `incluir_marcacao`.
- **T-E1B1CB (Arquiteto, em revisão)** — `84d8cf1` verificado por mim: base ancestral ok,
  `alwaysOutputData` em todos os `get` dos 6 workflows. Fecha quando entregar **4 mutações
  dirigidas** (1 falha esperada em cada, 4 verdes) + **2 casos novos de 422** para
  alterar/excluir. Aguardando liberação de e2e.
- **T-B1D7F6 (DevOps, novo)** — `npm run serve` nunca pode apontar para produção.
- **T-D9CDF8** — backlog, painel RH admin.

## Achados que valem mais que os cartões

**`alwaysOutputData` ausente nos 6 workflows** (corrigido). No n8n, Data Table `get` que casa
zero linhas emite zero itens e os nós seguintes não executam. Em `gestor-ajustar` isso
quebrava o **caminho normal**: `Consultar Idempotencia` retorna zero linhas em toda primeira
requisição com chave nova → a cadeia morria antes do `Responder` → cliente pendurado, sem
202 e sem erro. Mesmo sintoma do bug de CORS já documentado: "sumiu", não "deu erro".

**Contrato: `gestor-ajustar` aceita 3 ações, `equipe-hoje` não expõe `marcacao_id`.** Duas das
três eram inalcançáveis. Arquiteto escolheu (b): só `incluir_marcacao`.
**O ADR precisa registrar o motivo CERTO** — o Revisor analisou e **liberou** expor o id
(não é credencial, família do `id_cliente`, escopo já limitado pela sessão). Então (b) é
escopo/menor privilégio, **não** bloqueio de privacidade. Se ficar registrado como risco,
alguém fecha essa porta para sempre por um motivo falso. Condições do Revisor para quem
implementar (a) depois: nunca em querystring, nunca em `console.log`, nunca como texto
legível no DOM — só `data-*` ou estado interno.

## INCIDENTE ABERTO — decisão do cliente, não nossa

`js/config.js` traz `apiBase` de **produção** como padrão e `js/app.js:297` registra o
dispositivo no **boot, sem clique**. O Full-Stack abriu o app em duas abas reais para
validação visual e provavelmente criou **até 2 linhas pendentes** em `efrat_dispositivo`
de produção (`ativo=false`, apelido "Aparelho <uuid8>").

Risco baixo e o mecanismo funcionou: linha pendente nunca aprovada não dá acesso a biometria
— é o gate fail-closed provado hoje. Mas quebra a invariante "nenhum dado do piloto tocado".

**Não consegui verificar nem limpar:** as ferramentas de n8n disponíveis criam tabela e
coluna, mas **não leem nem apagam linhas**. Não inventei número — são "até 2", não 2.
**Pergunta em aberto ao cliente: essas linhas ficam ou saem?** Não apague sem ele decidir.

O defeito importa mais que o incidente: qualquer carregamento de página cria linha. É um jeito
trivial de encher a tabela do cliente sem má intenção. É a T-B1D7F6.

Bônus: comentário obsoleto em `js/config.js` fala do token digitado pelo gestor, que morreu no v3.

## Próximo passo, em ordem

1. Ler `suite.json` (ou refazer a medição, sozinho). É o que destrava o DevOps.
2. Liberar e2e por broadcast — 3 agentes estão em standby esperando só isso: Revisor
   (medir T-38A7C1), Arquiteto (4 mutações + 2 casos 422), Full-Stack (`gestor.spec.js`).
3. Levar a decisão das linhas de produção ao cliente.

## Herdado e mantido

Nenhum cartão fecha sem teste que alguém **viu reprovar** — foi o que fechou a T-607E5A e o
que mantém a T-E1B1CB aberta. Nada tocou workflow de produção; nenhum foi publicado.
Confirmação de recebimento entre agentes não se responde: queima contexto e não produz nada.
