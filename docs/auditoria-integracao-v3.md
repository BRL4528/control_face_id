# Auditoria de integração entre os 4 branches — T-CFE7BA

Não é revisão de qualidade de diff — cada branch, isolado, está correto e com CI
verde. O que se procura é o vão entre entregas: peça A e peça B corretas cada uma
por si, que nunca foram checadas juntas porque nenhum CI roda os dois lados ao
mesmo tempo. Método: `git diff 269cd42 <branch>` para cada um dos 4 branches
(base comum, `main`) e checagem cruzada de toda referência de um arquivo a outro
que atravessa fronteira de dono.

## Achado 1 — `css/fontes.css` nunca é linkado em `index.html` (FECHADO, com ressalva)

> **Atualização do Orquestrador:** Full-Stack linkou o `css/fontes.css`. Mas o
> conserto trouxe `css/fontes.css` + os `.woff2` do branch do DevOps via
> `git checkout` pegando a versão **antiga** — 18 arquivos com `latin-ext`, de
> antes da poda de 224 KB → 103 KB que o DevOps tinha acabado de fazer. Um
> `checkout` entre branches traz um snapshot congelado no tempo; se o branch
> de origem evoluiu depois desse ponto, o `checkout` reverte silenciosamente
> essa evolução, e como as duas versões são cada uma internamente consistentes
> (fontes existem, CSS válido), nenhum teste acusa — é a mesma classe de bug
> do Achado 2, não coincidência: cópia de arquivo entre branches por
> referência a um commit específico envelhece assim que a origem segue andando.
> Resolvido na integração (branch `integra/v3`): 8 arquivos, 103 KB, suite
> verde. Registro original abaixo, para o histórico.

Confirmado no HEAD atual dos dois branches (DevOps `20483a3`, Full-Stack `3ca8f61`).

Confirmado no HEAD atual dos dois branches (DevOps `20483a3`, Full-Stack `3ca8f61`).
`index.html` não tem nenhum `<link rel="stylesheet">` além de manifest/ícone — só
o `<style>` inline original. As duas metades, cada uma, estão certas:

- DevOps entregou `css/fontes.css` com `@font-face` para as 8 variações de
  Plus Jakarta Sans/IBM Plex Mono, todos os `url()` resolvendo para arquivo real
  em `vendor/fontes/` (conferido; o teste próprio do DevOps já garante isso).
- Full-Stack aplicou `var(--font-sans)`/`var(--font-mono)` e as classes `.mono`/
  `.num` exatamente como o design system pede, com os hex certos
  (`#2d6cdf`, `#e0a800`, `#28a745`, `#e5e9f0`, `#8390a6` — batem com
  `docs/plano-v3.md`).

Sem o `<link>`, tudo isso cai no fallback de sistema (`ui-monospace`,
`-apple-system` etc.) — o design aprovado pelo cliente não aparece, mas nenhum
teste acusa, porque nenhum dos dois lados tem motivo pra testar a ponte: o
DevOps testa que o CSS existe e é válido; ninguém testa que o HTML o referencia
(o teste do DevOps para scripts, `"todo script referenciado no index existe"`,
só varre `src="..."`, nunca `<link href>` — não é descuido, é o próprio
fronteira de arquivo, DevOps foi proibido de tocar `index.html`).
`sw.js` já pré-cacheia `css/fontes.css` (arquivo morto, nunca aplicado).

**Ação:** falta 1 linha em `index.html`
(`<link rel="stylesheet" href="./css/fontes.css">`), de quem for dono do
arquivo na hora — não é meu arquivo. Nota secundária, baixa prioridade:
`vercel.json`/`_headers` também não têm regra de cache longo para `/css/*`
(só `/vendor/*` e `/models/*` são `immutable`) — só importa depois que o link
existir.

## Achado 2 — `tests/e2e/servidor-falso.js` editado em paralelo por dois donos, sem se verem (FECHADO, com prova)

> **Atualização do Orquestrador:** fechado com prova, não com leitura de código
> — branch `integra/v3` mesclando DevOps + Arquiteto, suite completa rodada:
> 56 testes unitários passando, **incluindo o teste do DevOps que importa
> `extrairCspDeHeaders` do `servidor-falso.js` do Arquiteto** (a dupla
> função+teste rodou junta pela primeira vez em algum lugar), e 23/23 e2e com
> a CSP real ativa. Confirma que estava certo em não dar como fechado só
> porque os dois arquivos pareciam iguais — registro original abaixo.

DevOps (`20483a3`, dentro de T-97088E/D2) e o Arquiteto (`47c8a54`…`49c13de`,
T-E1B1CB) modificaram o mesmo arquivo a partir da mesma base, sem saber um do
outro — o próprio checkpoint do Orquestrador só atribuiu a propriedade do
arquivo ao Arquiteto **depois** que o DevOps já tinha mexido nele. O DevOps
acrescentou `extrairCspDeHeaders()` e passou a aplicar a CSP real do `_headers`
nas respostas estáticas do servidor de teste — e escreveu um teste próprio
(`tests/unit/estaticos.test.js`, ainda só no branch dele) que importa
justamente essa função do `servidor-falso.js`. A reescrita do Arquiteto (300+
linhas para o contrato v3) partiu de antes desse commit: no HEAD que o
Orquestrador conferiu (`49c13de`), `extrairCspDeHeaders` não existia mais nesse
arquivo. Juntar os dois sem reconciliar quebraria o teste do DevOps no import
(função inexistente) — e nenhum dos dois CIs isolados acusaria, porque
`estaticos.test.js` nunca roda contra a versão do Arquiteto.

**Isso parece ter sido corrigido appenas agora:** o commit `210098d`
("test: aplica cabecalhos de seguranca no servidor falso"), no branch do
Arquiteto, reaplica exatamente a mesma função e a mesma injeção de cabeçalhos
que o DevOps tinha escrito — 3 minutos depois do checkpoint mais recente, fora
da lista de commits que você conferiu (`47c8a54 069050e 4bd88b8 49c13de`).
Registro como achado porque cheguei nele antes de saber que já tinha sido
tratado, mas **não valido como fechado**: `tests/unit/estaticos.test.js`
continua existindo só no branch do DevOps, então o par função+teste nunca
rodou junto em lugar nenhum ainda. Vale um "confere aí" com o Arquiteto antes
de dar como certo — é exatamente o tipo de correção que parece igual e pode
ter uma vírgula diferente do original.

**Boa notícia à parte:** a reescrita do Arquiteto trata compatibilidade
retroativa com cuidado real — `/efrat/carga` e `/efrat/dispositivo/registrar`
(inclusive migração de `token` legado) ramificam corretamente entre o
contrato v2 (que meus 23 testes atuais usam) e o v3, o `estado` interno
manteve todos os campos legados (`marcacoes`, `inativos`, `fora`,
`equipesCriadas`, `colaboradoresCriados`, `decisoes`, `maxLotesSimultaneos`)
ao lado dos novos, e até o texto de erro `"token invalido"` do v2 foi
preservado de propósito (commit `49c13de`). Isso reduz bastante o risco de eu
trazer esse arquivo pro meu branch para a T-38A7C1.

## Lição que se repetiu duas vezes — cópia entre branches envelhece

Os dois achados fechados vieram da mesma causa, em duas formas: `git checkout
<branch> -- arquivo` (ou copiar conteúdo) traz um instantâneo preso ao commit
de origem no momento da cópia. Se a origem segue evoluindo depois — o
Arquiteto reescrevendo `servidor-falso.js` a partir de antes do D2 do DevOps,
o Full-Stack puxando `css/fontes.css` de antes da poda de fontes — o destino
fica com uma versão velha que é **internamente consistente**, então nenhum
teste isolado acusa. Vale como regra geral pra fase 2: depois de qualquer
`checkout`/cópia de arquivo de outro branch, rodar a suite do lado que cedeu
o arquivo (ou, melhor, mesclar de verdade e rodar tudo junto) antes de dar
como pronto — foi exatamente rodar os 23 e2e depois de trazer o
`servidor-falso.js` (não só ler o diff) que baixou meu risco percebido nesta
auditoria.

## Verificado e sem achado

Checagens que fiz e não renderam problema, para não parecer que só rodei o
óbvio: cores/tokens usados por Full-Stack em `js/face.js`/`fila.js`/`rh.js`
batem com `docs/plano-v3.md`; as 5 telas (`porta`, `fila`, `rh`, `loginRh`,
`pareamento`) continuam intactas no `index.html` do Full-Stack; `.mono`/`.num`
estão definidos no CSS exatamente como o JS os usa; `vendor/chart.umd.min.js`
é um bundle real do Chart.js 4.4.1 (205 KB, não placeholder) e bate com o
fallback que `js/rh.js` já esperava; CSP em `_headers`/`vercel.json`
consistente com `apiBase`/`connect-src`; `manifest.json` com `theme_color`
batendo com o token `--bg` do design; `package.json`'s `test:unit` usa glob
(`tests/unit/*.test.js`), então `estaticos.test.js` roda sozinho assim que
chegar em qualquer branch, sem precisar de mais fiação.

## Não fui atrás de (fora do escopo desta auditoria)

Correção dos códigos de erro do `servidor-falso.js` contra o texto do ADR
(`docs/adr-acesso-v3.md`) — isso é qualidade do diff de um único dono, não vão
entre dois; fica para quando eu efetivamente escrever `fluxo.spec.js` contra
esse contrato (T-38A7C1), e se algo não bater eu aviso em vez de consertar,
como combinado.
