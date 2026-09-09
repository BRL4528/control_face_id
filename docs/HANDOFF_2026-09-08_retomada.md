# Retomada — Control Face ID (08/09/2026)

Documento de contexto para continuar o trabalho. Tudo abaixo está em `main` e em
produção (https://control-face-id.vercel.app). Nenhum cliente real usa ainda; a
empresa "Efrat" no banco é a conta de testes do Bruno (RH `rh`).

## Onde estamos

**Decisão de produto do dia:** o sistema deve ser um *agente facilitador*. O RH
cadastra a escala uma vez e só volta quando a equipe muda de local ou quando há
pendência. O colaborador não pode ver barreira nenhuma para bater ponto.

**Fluxo em produção hoje**

1. RH manda o **link da empresa** (Configurações → Link da empresa), ex.
   `https://control-face-id.vercel.app/e/9xnpql8s`.
2. Colaborador abre, toca **BATER PONTO**, olha para a câmera. Sem código, sem
   matrícula. O aparelho nasce `pendente`; a batida grava sem colaborador com
   foto, GPS e o cadastro facial capturado no ato. Matrícula é opcional depois.
3. RH vê em **Pendências → "Aparelho não identificado"**, escolhe a pessoa (ou
   cadastra nova) e libera. O aparelho vira ativo, a foto vira o cadastro facial,
   as batidas pendentes valem retroativamente.
4. **Bloqueio:** RH bloqueia o aparelho, ou desativa o colaborador (tela ou
   importação com Status "Inativo") → aparelho `bloqueado`, API responde 403, app
   trava e para de sincronizar.

**Também entregue hoje** (commits de 47350ec a 9b5664c em `main`):
merge da v4 em produção; tela de entrada nova; Escala com nome de projeto,
renovação diária (cron 03:00 UTC, `CRON_SECRET` configurado) e bloqueio de
conflito entre escalas; "Alocações" virou "Ajustes do dia"; vincular/desvincular
em Equipes; Pendências com badge coerente, antigas e hora local; importação por
planilha xlsx/csv com prévia + planilha modelo; Mapa corrigido (cercas do dia
nunca chegavam) e "hoje" no fuso da empresa; três furos de isolamento entre
empresas fechados; Central com card da equipe clicável (painel do dia com
ações); script `scripts/popular-demo.js` de dados de demonstração.

> **Atualização 09/09/2026:** a integração Bitrix mudou de escopo e já foi
> implementada — só o pipeline "Gerenciamento de Equipe" (etapa = equipe, card =
> colaborador). Tudo em `docs/INTEGRACAO_BITRIX_GERENCIAMENTO_EQUIPE.md`,
> inclusive a correção do domínio do portal (`efrat.bitrix24.com.br`) e os passos
> para ligar em produção. A seção abaixo ficou como registro histórico.

## Próximo passo combinado: integração com Bitrix24 (Efrat) — SUBSTITUÍDO

Levantamento feito no n8n (`n8n.samasc.com.br`, projeto pessoal do Bruno):

- Colaborador = **Contato do CRM**, chave por telefone. Campo custom
  `UF_CRM_1784607740` = "Colaborador Ativo", sincronizado a cada 30 min pelo
  workflow `Efrat - Sync Colaborador Ativo (30min)` (id `ifnZrWqRfT90p2pZ`).
- **Admissão** = Negócios categoria 5 (etapa "Ativo em período de experiência" ou
  ganho ⇒ ativo). **Desligamento** = categoria 11 (ganho ⇒ desligado).
- Status de bloqueio no contato: Descartado 305, Desligado 307, Banco de
  Talentos 57, Inativo Permanente 61.
- Token OAuth do portal `b24-4yujaa.bitrix24.com.br` renovado pelo `Bitrix Token
  Keeper` na Data Table `0plzFQOimeF5qncE` (bitrix_auth). Console REST para
  consultas: workflow `Efrat - Bitrix Console (Claude)` (id `JoBbcT5S23cqbL3C`,
  INATIVO; POST `/webhook/efrat-bitrix-console` com `{calls:[{method,params}]}`).
- Ponte Bitrix ⇄ WhatsApp (Elisia) funcionando (`Bitrix Bridge - Outbound`,
  `MessageService Handler`).

**Proposta (aprovação pendente do Bruno):**

1. *Bitrix → Ponto:* admissão em "Ativo em período de experiência" cria o
   colaborador no ponto; desligamento ganho desativa (bloqueia aparelho).
   Requer no ponto uma rota `/api/integracao` com token por empresa
   (reaproveita a lógica de `api/rh/importar.js`).
2. *Bitrix → Colaborador:* no mesmo evento, WhatsApp via Elisia com o link da
   empresa. Se o telefone do aparelho casar com o contato, aprovação automática.
3. *Ponto → Bitrix:* pendências como tarefa/notificação, faltas e fora-da-cerca
   na timeline do contato, resumo diário; opcionalmente painel embutido (placement).

**Duas decisões abertas:** (a) o que é a matrícula no Bitrix — coluna "Código"
da planilha existe como campo do contato? senão usar o ID do contato; (b) de
onde vem a equipe — campo "Local de alocação" no contato/negócio? Descobrir
ativando o Console REST alguns minutos e listando `crm.contact.fields` e
`crm.deal.fields` (+ `crm.dealcategory.stage.list` para cat 5 e 11).

## Como retomar o ambiente local

- `vercel dev` não sobe (script `dev` recursivo). Desde 09/09 o shim está no repo:
  `node --env-file=.env.local scripts/dev-local.js 4300` (estáticos + `/api/*`,
  `/e/*` → index.html, rota reimportada a cada request). Para o preview do agente,
  entrada `control-face-id` em `~/inova/samasc-web/.claude/launch.json` (remover ao fim).
- Sessão do RH só em memória: mintar JWT com o segredo default de
  `api/_lib/auth.js` (`dev-inseguro-troque-em-producao`) a partir de `usuario_rh`
  e injetar via `await import('/js/rh.js')` → `Rh.token=…; Rh.dados=(await
  ApiRh.dados(Rh.token,30)).dados; Rh.abrir(()=>{}); Rh.aba='…'; Rh.pintar()`.
- Trocar de aba por `Rh.aba`/`Rh.pintar()` (cliques na sidebar erram com viewport emulado).
- Testes: `npm run test:unit` (97 passando). E2E do Playwright estão quebrados
  desde antes da v4 (referenciam `#aguardando`, que não existe mais).
- Deploy = push em `main`. Conferir com `vercel ls` e `curl` no domínio.

## Armadilhas que já morderam hoje

- `marcacao` tem trigger de **imutabilidade** (REP-P): nunca UPDATE/DELETE. Toda
  mudança é linha nova + `correcao`. A fila deriva "pendente" de "sem correção".
- O driver Neon devolve `DATE` como `Date`; `String(d).slice(0,10)` vira
  "Tue Sep 08". Sempre `to_char(col,'YYYY-MM-DD')` no SQL.
- Sem `<base href="/">` o app não carrega em `/e/<token>`; o rewrite da Vercel
  precisa ser para `/` (com `cleanUrls`, `/index.html` dá 404).
- O `vercel.json` só aplica env nova após redeploy (`vercel redeploy <url>`).
- ESM em cache no shim local: editar `api/*` exige reiniciar o servidor.

## Dados de teste na Efrat

Link `9xnpql8s`. Colaboradores demo D001…D015 (biometria FAKE), equipes Obra
504, Obra 547 (escala vencendo), Escritório; Equipe Piloto/Obra Norte originais.
"Teste Primeiro Acesso" (TESTE-9) inativo com aparelho bloqueado. Aparelho
pendente demo com matrícula informada D020. Marcações são imutáveis: não há
como apagar os dados demo, só desativar as pessoas.
