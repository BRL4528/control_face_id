# Deploy — Control Face ID v4 (Vercel + Neon)

Passo a passo para pôr o produto no ar. São ~15 minutos. Você faz os cliques;
eu já deixei o código pronto para cada etapa.

## Visão geral

```
Navegador (PWA estática)  ──►  Vercel Serverless Functions (api/)  ──►  Neon Postgres
   colaborador + RH               autenticação, cerca, dedup            dados
```

Tudo num projeto Vercel só. Sem servidor para manter, sem n8n.

---

## 1. Banco Neon

1. Entre em **vercel.com** → seu projeto → aba **Storage** → **Create Database** → **Neon (Postgres)**.
   (Ou neon.tech direto, se preferir gerenciar fora da Vercel.)
2. A Vercel injeta automaticamente a variável **`DATABASE_URL`** no projeto. Confirme em
   **Settings → Environment Variables** que ela existe.
3. Aplique o esquema. No painel do Neon, abra o **SQL Editor**, cole o conteúdo de
   [`db/schema.sql`](../db/schema.sql) e rode. (Ou localmente: `psql "$DATABASE_URL" -f db/schema.sql`.)

## 2. Variáveis de ambiente

Em **Settings → Environment Variables** do projeto Vercel, adicione:

| Nome | Valor | Como gerar |
|---|---|---|
| `DATABASE_URL` | (já veio do Neon) | — |
| `JWT_SECRET` | segredo longo | `openssl rand -base64 48` |
| `CORS_ORIGINS` | o domínio do app, ex. `https://ponto.suaempresa.com` | use `*` só em teste |
| `BLOB_READ_WRITE_TOKEN` | (opcional) | Storage → Blob → Create; guarda as fotos de auditoria |

Sem `BLOB_READ_WRITE_TOKEN` o app funciona — as miniaturas ficam inline no banco.

## 3. Deploy

O projeto é site estático + funções em `api/`. A Vercel detecta sozinha:
- **Framework Preset:** Other
- **Build Command:** vazio
- **Output Directory:** `.` (raiz)

Faça o deploy pela integração com o GitHub (push na branch) ou `vercel --prod` na sua
máquina. As funções em `api/*.js` viram rotas `/api/*` automaticamente.

## 4. Semear a primeira empresa e o RH

Uma vez, para criar a empresa, o usuário do RH e um colaborador de exemplo:

```bash
DATABASE_URL="...сopie do Neon..." node scripts/seed.js "Nome da Empresa" rh "senha-forte-aqui"
```

Anote o **`empresa_id`** que ele imprime — é o "código da empresa" que o colaborador
digita **uma vez** ao ativar o ponto no celular.

## 5. Testar de ponta a ponta

1. **RH:** abra o app → **Acessar RH** → usuário `rh` + a senha do seed.
2. **Cadastrar biometria:** aba **Colaboradores** → no colaborador de exemplo → **Biometria**
   → 3 capturas → Salvar.
3. **Alocar no mapa:** aba **Alocação** → escolha o dia e a equipe → toque no mapa para
   pôr a cerca (ou salve um local) → ajuste o raio → marque o colaborador → **Alocar**.
4. **Colaborador:** abra o app noutro dispositivo/aba → **ATIVAR MEU PONTO** → digite o
   `empresa_id` e a matrícula (`0001`) → capture a face → **Registrar ponto**: olhe, pisque,
   pronto. Dentro da cerca vira ✓; fora, vai para revisão do RH.

## Notas de produção

- **HTTPS obrigatório** — a câmera não liga em HTTP. A Vercel já serve HTTPS.
- **Fuso/relógio** — o servidor carimba a hora de recepção e mede a deriva do celular;
  desvio > 2 min manda a marcação para revisão.
- **Multi-empresa** — o schema já isola por `empresa_id`. Para uma nova empresa, rode o
  seed de novo com outro nome; cada uma tem seu `empresa_id`, seus RHs e seus dados.
- **Backups** — o Neon faz point-in-time recovery. A tabela `marcacao` é imutável por
  trigger (o livro de ponto não se reescreve); correção é sempre lançamento novo.
