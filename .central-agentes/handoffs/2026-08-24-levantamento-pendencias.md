# Levantamento de pendências · 24/08/2026

Cruzamento de três fontes: quadro da Central (41 cartões), checkpoint do
Orquestrador (`2026-08-21-orquestrador-fase3.md`) e o código no worktree.
**Onde as fontes discordaram, o código venceu.** Cada afirmação abaixo declara
se foi verificada por leitura ou herdada de relato — a distinção existe porque
foi exatamente ela que faltou da última vez que o quadro derivou.

## Estado do repo

`HEAD`, `integra/v3-r3` e `origin/main` são o mesmo commit (`cadb6bc`).
Working tree limpo, nada solto em ramo nenhum. O `main` local está 196 commits
atrás — ponteiro desatualizado, não trabalho perdido.

Última medição **registrada** (commit `e9bb653`): 102 unitários + 145 e2e, zero
falhas. **Não remedida neste levantamento** — remedir pede janela de pista
anunciada, e número herdado declarado como herdado vale mais que número novo
sem procedência.

---

## 1. Código realmente aberto (verificado por leitura)

| Cartão | O que falta | Prova |
|---|---|---|
| **T-13FDDF** | `Unidade` é `<input type="text">` livre; sem `datalist`, sem normalização na escrita. "Canteiro A" e "canteiro a" viram duas unidades | `js/rh.js:1236`, `js/rh.js:1266` |
| **T-A17B32** | `avaliarPoseLote` existe, é exportada e tem 8 testes unitários — **nenhum arquivo em `js/` a chama**. O eixo relativo foi construído e não entrou no fluxo | `js/regras.js:496`; zero consumidores |
| **T-D13271** | Conserto candidato identificado e **não aplicado**: 8 specs fazem `servidor.close()` sem `await`, contra 16 que aguardam. `fluxo.spec.js:130` está no grupo que não aguarda e é o maior arquivo da suíte | `aparelhos`, `equipes-pessoas`, `rh-link-face`, `fluxo`, `acesso`, `modelo`, `gestor`, `rh-biometria` |
| **T-E5195A** | Critérios 5a/5b de fail-closed existem; o endurecimento das três asserções de ausência temporal não aparece | `tests/e2e/acesso.spec.js:101,120` |
| **T-55A616** | **Resíduo achado neste levantamento:** a decisão do gate de pose está em `docs/fase3-contrato.md`, mas **não** na seção "Limites conhecidos" do README — que é onde os limites do produto vivem para o cliente. Limite decidido que o cliente não lê é limite não entregue | `README.md:354` |
| — (sem cartão) | Lacuna 2.1e: tentativa errada de código de aprovação não deixa rastro auditável. Registrada de propósito como lacuna, porque fechar exige decisão de contrato | `docs/fase3-seguranca.md:372` |

## 2. O buraco maior, e ele não tem cartão

**O backend da FASE 3 não existe.** O cliente chama **25 rotas**
(`js/api.js` + `publico/js/`); `n8n/` tem **6 workflows**. Faltam 19 — todo o
bloco `/efrat/rh/*`, `/efrat/rh/face/convite*`, `/efrat/cadastro`,
`/efrat/marcacoes`.

Tudo isso está implementado **só em `tests/e2e/servidor-falso.js`**. As três
coberturas verdes provam o cliente contra um servidor que ninguém vai operar.
O contrato (`docs/fase3-contrato.md`, 1893+ linhas) especifica as rotas;
ninguém as construiu.

**O Especialista n8n (`21e3bab28e`) não tem um único cartão atribuído.** Os dois
fatos são o mesmo fato.

*A conferir, não afirmado:* o cliente chama `/efrat/carga` (`js/api.js:136`) e o
único workflow de carga é `efrat/carga-v3`. Pode ser workflow antigo vivo em
produção fora do repo — daqui não dá para decidir.

## 3. Espera o cliente (nenhum é trabalho nosso)

1. **String do hostname** da origem pública. Ele **publica, não desenvolve** — o
   link do celular já está construído e testado com placeholder. Os dois
   placeholders estão nomeados em `publico/LEIA-ME.md`, e confundi-los desfaz o
   isolamento sem quebrar nada visivelmente.
2. **Quatro fotos com e sem capacete**, duas poses cada — hipótese da sombra da
   aba (`docs/fase3-contrato.md:1297`).
3. **Sim/não à Parte 1** (rotas do convite pela Vercel). Recomendada: grátis,
   reversível, tira a camada de volume de dentro da aplicação.
4. **Confirmação do hostname do app** do operador, para o projeto Vercel
   separado (T-600DD4).

## 4. Deriva do quadro, corrigida hoje

Seis cartões movidos para `done`, cada um conferido no código antes:

- **T-122B55** (URGENTE, "já marcou" repetindo) → `e9bb653`, 5 unitários + 2 e2e,
  revalidado com `--repeat-each=3`.
- **T-9C35B7** (poll de 15,7 s) → `aparelhos.spec.js:28` já passa `consultarAposS: 1`.
- **T-D00CE0** (aparelho revogado retido) → `js/rh.js:396,419` + spec dedicado.
- **T-C20AD3** (§1: `pendente_id` opaco, idempotência, rate limit) → os três em
  `servidor-falso.js:196,341,360` e `js/api.js`.
- **T-81C721** (rastro auditável) → `auditoria-aprovacao-contrato.spec.js`.
- **T-B1D7F6** (`serve` apontando para produção) → fechado com T-AABCC9, guarda
  de CI em pé (T-F1E72A).

**T-92D567** conferido e pronto para fechar (três estados de slot em
`js/rh.js:1109-1114`, aparência em `css/tema.css:174-176`, retry por posição via
`data-slot`) — o move foi bloqueado pelo classificador e ficou para a mão.

**T-55A616 NÃO foi movido**, apesar de o checkpoint dá-lo como decidido: ver o
resíduo do README na seção 1. Decisão fechada não é decisão entregue.

## 5. Restos da FASE 2 que precisam de veredito, não de trabalho cego

T-8FB792 (painel do gestor), T-D9CDF8 (painel RH admin), T-E1B1CB (endpoints
n8n — o mesmo buraco da seção 2), T-38A7C1 (testes do modelo novo). Parados
desde a FASE 3 começar. Alguém precisa dizer se ainda descrevem trabalho real
antes de qualquer um pegá-los.

## 6. Dívidas assumidas, que não são pendência

Registro para ninguém reabrir achando que é buraco:

- **Gate absoluto de pose não vai existir** nesta versão. Em 2D exige constante
  antropométrica, e ela recusaria umas anatomias mais que outras. Cegueira
  uniforme é o defeito justo.
- **Chave PBKDF2 do RH é credencial permanente** (`js/rh.js:22-28`). Fora de
  escopo, ~2,5-3 dias.
- **Entidade `locais` recusada** — fica `unidade` como texto. É o que faz a
  T-13FDDF ser a dívida dessa escolha, e não um defeito solto.
- **Servidor não reconfere a biometria**; uma empresa só, sem tenant.

---

## Resumo

O cliente está funcionalmente completo e medido. Falta o backend real das 19
rotas da FASE 3, cinco itens pequenos de código, e o veredito sobre quatro
restos da FASE 2.
