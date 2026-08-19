# Efrat · Ponto — API do piloto (n8n + Data Tables)

> **Contrato legado (v2).** Este documento descreve o piloto atual. No v3, o token
> digitado deixa de autenticar o aparelho, `/efrat/carga` passa a ser escopada no
> servidor por `equipes_ids`, e entram os endpoints de dispositivo, identificacao e
> gestor. O contrato normativo da migracao e das rotas v3 esta em
> [`adr-acesso-v3.md`](adr-acesso-v3.md). As rotas de RH continuam no modelo atual
> nesta rodada; substituir a chave PBKDF2 usada como bearer e divida estimada em
> 2,5–3 dias.

Base: `https://n8n.samasc.com.br/webhook/`

Duas autenticações, de propósito separadas:

| Rotas | Quem usa | Como autentica |
|---|---|---|
| `/efrat/carga`, `/efrat/marcacoes`, `/efrat/cadastro` | aparelho do gestor | token do dispositivo no corpo (`token`) |
| `/efrat/rh/*` | painel do RH | `usuario` + `chave` (PBKDF2 derivada no navegador) |

O aparelho **nunca** recebe credencial de RH, e o RH **nunca** precisa do token de um aparelho.

Sem banco externo. Tudo vive em Data Tables do próprio n8n.

---

## Para ligar

1. Ative os 7 workflows.
2. No **Monitor Diário**, preencha o e-mail do RH e ligue a credencial do Gmail.
3. Na tabela `efrat_dispositivo`, troque `TROQUE-ESTE-TOKEN` por um token real.

O seed mínimo já está criado: equipe `eq-piloto`, gestor `ps-gestor`, dispositivo com o token de exemplo.

## Tabelas

| Tabela | O que guarda |
|---|---|
| `efrat_equipe` | equipes, unidade e local esperado |
| `efrat_pessoa` | colaboradores e gestores, com `papel` e `ativo` |
| `efrat_dispositivo` | token do aparelho, gestor dono e `equipes_ids` (lista separada por vírgula) |
| `efrat_template` | biometria versionada — `ativo`, `pendente`, `reprovado`, `substituido` |
| `efrat_marcacao` | livro de marcações; **nunca alterado** |
| `efrat_correcao` | decisões do RH; o estado atual é derivado daqui |
| `efrat_usuario_rh` | usuários do painel: `sal`, `iteracoes` e a `chave` derivada |

Para dar a um gestor acesso a mais de uma equipe (gestor substituto), basta pôr os ids em `equipes_ids`: `eq-piloto,eq-norte`.

---

## POST /efrat/carga

```json
{ "token": "..." }
```

Resposta:

```json
{
  "ok": true,
  "gestor": { "id": "ps-gestor", "nome": "Gestor Piloto" },
  "equipes": [{ "equipe_id": "eq-piloto", "nome": "...", "unidade": "...",
                "lat": 0, "lng": 0, "raio_m": 500, "minha": true }],
  "pessoas": [{ "pessoa_id": "...", "nome": "...", "matricula": "...",
                "equipe_id": "...", "papel": "colaborador",
                "versao": 1, "vetores": [[...]], "miniatura": "data:image/jpeg;..." }],
  "sem_cadastro": [{ "pessoa_id": "...", "nome": "..." }],
  "servidor_hora": "2026-08-14T22:00:00.000Z",
  "expira_em": "2026-08-14T23:59:59.000Z"
}
```

- `pessoas` traz a **unidade inteira**. O PWA usa como galeria só quem tem `minha: true`; a unidade serve para o botão "buscar na unidade" (remanejamento).
- `sem_cadastro` são os que ainda não têm biometria — aparecem como pendentes e só podem ser marcados manualmente.
- `servidor_hora` é o que o PWA usa para calcular `deriva_relogio_ms`.
- `expira_em` é o fim do dia; a carga se renova sozinha no login seguinte.

## POST /efrat/marcacoes

Esvaziamento da fila offline. Lote de até 200.

```json
{
  "token": "...",
  "marcacoes": [{
    "id_cliente": "uuid gerado no aparelho",
    "pessoa_id": "...",
    "equipe_id": "...",
    "tipo": "entrada",
    "origem": "biometria",
    "veredito": "aceito",
    "score": 0.104,
    "motivo": null,
    "marcado_em": "2026-08-14T09:03:11.000Z",
    "deriva_relogio_ms": 1200,
    "lat": -20.44, "lng": -54.64, "precisao_m": 12,
    "foto_auditoria": "data:image/jpeg;base64,..."
  }]
}
```

Resposta:

```json
{
  "ok": true,
  "servidor_hora": "...",
  "resumo": { "aceitas": 18, "duplicadas": 2, "rejeitadas": 1 },
  "resultados": [{ "id_cliente": "...", "status": "aceito", "motivo": null }]
}
```

**O PWA só apaga da fila local o que voltou como `aceito` ou `duplicado`.** `rejeitado` fica retido e vira aviso ao gestor.

| Situação | Resultado |
|---|---|
| `id_cliente` já registrado | `duplicado` |
| Colaborador inativo ou inexistente | `rejeitado` |
| `veredito` diferente de `aceito` | grava e marca para revisão |
| `origem: "manual"` | grava e marca para revisão |
| Marcação do próprio gestor | grava e marca para revisão |
| Relógio do aparelho > 2 min fora | grava e marca para revisão |

**A foto de auditoria só é gravada quando a marcação precisa de revisão.** Nas aceitas ela fica só no aparelho — sem isso, 14 dias de piloto encheriam a Data Table de base64. Mande sempre; o servidor descarta quando não precisa.

## POST /efrat/cadastro

```json
{
  "token": "...",
  "origem": "rh",
  "matricula": "0042",
  "nome": "Fulano de Tal",
  "equipe_id": "eq-piloto",
  "pessoa_id": "",
  "vetores": [[...], [...], [...]],
  "miniatura": "data:image/jpeg;base64,...",
  "coerencia": 0.18
}
```

- `origem: "rh"` → template **ativo**, aposenta o anterior.
- `origem: "gestor"` → template **pendente**; o rosto em uso não muda até o RH aprovar.
- `matricula` cria a pessoa se não existir. Para recadastro, mande `pessoa_id`.

## GET /efrat/pendencias?token=...

Devolve `marcacoes` e `recadastros` aguardando decisão. Cada marcação vem com `motivos_revisao` (por que está ali) e a foto de auditoria; cada recadastro vem com a miniatura e a coerência.

## POST /efrat/decisao

```json
{ "token": "...", "tipo": "marcacao", "id": "...", "acao": "aprovar", "motivo": "" }
```

`tipo`: `marcacao` | `template` · `acao`: `aprovar` | `rejeitar` | `ajustar`

A decisão sempre vira uma linha em `efrat_correcao`. **A marcação original nunca é alterada** — a fila do RH é montada comparando marcações que pedem revisão com as correções já feitas.

---

## Painel do RH — `/efrat/rh/*`

A senha **não trafega**. O navegador pede o sal, deriva PBKDF2-SHA256 (150 000 iterações, 256 bits) e manda só a chave resultante em toda chamada.

### POST /efrat/rh/sal

```json
{ "usuario": "rh" }              →  { "ok": true, "sal": "0d9f…", "iteracoes": 150000 }
```

Usuário inexistente recebe um **sal falso determinístico** em vez de erro. Sem isso, essa rota vira um oráculo de quais usuários existem.

### POST /efrat/rh/dados

```json
{ "usuario": "rh", "chave": "…", "dias": 30 }
```

Uma chamada devolve o painel inteiro: `equipes`, `pessoas`, `marcacoes` do período (com `pendente` e `requer_revisao`), `recadastros` aguardando decisão e `servidor_hora`. Os indicadores e o espelho de ponto são calculados **no cliente**, por `js/regras.js` — as mesmas funções que os testes de unidade cobrem.

### POST /efrat/rh/equipe · POST /efrat/rh/colaborador

Criam ou atualizam. **São rotas separadas de propósito:** o `upsert` da Data Table *insere* quando o filtro não casa, então uma rota única gravaria lixo na tabela errada a cada chamada que não encontrasse a linha.

```json
{ "usuario": "rh", "chave": "…", "nome": "Equipe Norte", "unidade": "…", "lat": 0, "lng": 0, "raio_m": 500 }
{ "usuario": "rh", "chave": "…", "nome": "Ana Souza", "matricula": "001", "equipe_id": "eq-1", "papel": "colaborador" }
```

### POST /efrat/rh/decidir

Mesma semântica de `/efrat/decisao`, autenticada pelo RH: grava em `efrat_correcao` e **nunca altera a marcação original**.

```json
{ "usuario": "rh", "chave": "…", "tipo": "marcacao", "id": "…", "acao": "aprovar", "motivo": "" }
```

---

## Monitor diário

19h. Só manda e-mail quando há algo fora do normal: taxa de registro manual ≥ 20% numa equipe, equipe sem marcação, gente faltando marcar, marcações que chegaram com mais de 24h de atraso e o tamanho da fila do RH.

Ajuste em `LIMITE_MANUAL`, no nó **Avaliar Alarmes**.

---

## Limites conhecidos deste piloto

- **Deduplicação não é garantida pelo banco.** Data Table não tem índice único. O servidor compara `id_cliente` antes de gravar, mas dois lotes simultâneos do mesmo aparelho poderiam furar. **O PWA precisa usar envio único em voo** — não mandar lote novo enquanto um está em trânsito.
- **Imutabilidade é disciplina, não estrutura.** Nenhum workflow altera `efrat_marcacao`, mas nada impede alguém de editar pela interface do n8n. Para o REP-P definitivo isso precisa virar garantia de banco.
- **Não reconfere a biometria no servidor.** A decisão é a que veio do aparelho. Com o gestor como adversário, é uma fragilidade conhecida — resolve quando a extração do embedding migrar para o servidor.
- **Uma empresa só.** Sem isolamento por tenant.
- **Token sem expiração.** Suficiente para aparelho corporativo em piloto; não é modelo de autenticação de produção.
- **A chave derivada do RH é o credencial.** Quem capturar a chave em trânsito entra sem saber a senha — ela vale como um bearer token. PBKDF2 no cliente protege a senha original, não a sessão. Para produção: sessão com expiração emitida pelo servidor.

Nada disso é acidente: o piloto existe para medir FNMR, FTA, latência e taxa de manual em campo. Os nomes de tabela e campo já são os que a API própria vai herdar.
