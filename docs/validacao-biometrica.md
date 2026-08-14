# Efrat — PWA de Ponto: validação do reconhecimento facial como biometria

**Objetivo do documento:** definir se e como o fluxo "cadastrar a face uma vez → depois identificar o colaborador apenas lendo o rosto" é viável, seguro e defensável juridicamente, e qual protocolo usar para *provar* isso antes de escrever o sistema definitivo.

**Data:** 14/08/2026 · Fontes primárias listadas ao final.

---

## 0. Resumo executivo — as 5 conclusões que mudam o desenho

1. **Não construa identificação 1:N pura.** A matemática é implacável: `FPIR ≈ N × FMR`. A taxa de falsa identificação cresce linearmente com o tamanho da galeria. Um matcher calibrado em FMR = 1e-6 (excelente em 1:1) produz ~1% de falsa identificação numa galeria de 10.000 pessoas. No seu caso os dois fluxos já *dão* a identidade de graça — use isso.
2. **Os dois fluxos da Efrat são naturalmente 1:1.** No celular pessoal, o colaborador já está logado no PWA → o sistema sabe quem é → **verificação 1:1** contra o template dele. No "modo posto", o gestor seleciona o colaborador na lista → também **1:1**. O rosto serve para provar *"é você mesmo e você está aqui agora"*, não para descobrir quem é. Isso é o padrão da indústria em ponto/acesso corporativo e elimina o risco combinatório.
3. **O risco real não é o matching — é o liveness em navegador.** O reconhecimento em si é commodity madura (NIST FRTE: FNMR ~0,27% @ FMR=1e-6 em algoritmos de ponta). O que quebra o sistema é foto do colega na tela, vídeo gravado e — a ameaça dominante em 2026 — **injection attack** via câmera virtual, que funciona sem root e é invisível para o navegador. PWA não tem attestation forte (nada equivalente a Play Integrity / App Attest). Isso é uma limitação estrutural, não um bug a resolver.
4. **Extração de template e liveness têm que acontecer no servidor, na mesma mídia.** Se o embedding for gerado no navegador, qualquer pessoa com DevTools envia um vetor pré-computado e bate o ponto de casa. E se liveness e embedding vierem de mídias diferentes, o atacante passa no desafio com o próprio rosto e envia o vetor de outro. Cadeia de custódia única: um vídeo curto sobe → o servidor valida vivacidade → o servidor extrai o template **desse mesmo vídeo** → compara.
5. **Juridicamente, biometria facial é o meio mais invasivo — e a ANPD acabou de mostrar rigor com isso.** Em 06/08/2026 a ANPD suspendeu o reconhecimento facial nas escolas do Paraná (Despacho 2/2026/SFI), classificando-o como "atividade de alto risco" e reprovando exatamente: base legal instável, RIPD desatualizado e **violação do princípio da necessidade** — porque existia alternativa menos invasiva. Esse é o teste que a Efrat vai ter que passar. Alternativa não-biométrica para quem recusar não é gentileza, é blindagem.

> **Ponto importante que checamos e derrubamos:** não existe na Portaria MTP 671/2021 nenhum dispositivo que proíba ou restrinja biometria no ponto. A portaria simplesmente não trata do assunto — quem regula a biometria é a LGPD. (A confusão vem da antecessora, Portaria 1510/2009.) O PDF oficial consolidado no gov.br não abriu durante a pesquisa; vale confirmar contra o DOU antes de citar em documento formal.

---

## 1. Arquitetura recomendada do fluxo

### 1.1 Cadastro (enrollment) — feito uma vez, presencialmente, com supervisão

Enrollment ruim é a causa nº 1 de falso negativo crônico depois. Trate como um ato administrativo, não como uma tela do app.

| Etapa | Regra |
|---|---|
| Local | Presencial, com o gestor/RH presente. Nunca remoto sem supervisão — é aqui que se planta um rosto errado na base. |
| Captura | Vídeo curto (3–5s) ou burst; o sistema seleciona **3 a 5 frames** de melhor qualidade. Leve variação de pose (frontal + leve giro). |
| Limites de pose | yaw < 45°, pitch < 30° para baixo / < 45° para cima. Iluminação uniforme, sem contraluz, olhos abertos, sem máscara/boné/óculos escuros, expressão neutra. |
| Qualidade | Score automático por frame (use **OFIQ 1.0**, implementação de referência open source da ISO/IEC 29794-5, do BSI alemão). Abaixo do limiar → recaptura na hora. |
| Liveness | Sim, também no cadastro. Sem isso, dá para cadastrar a foto de alguém. |
| Persistência | Salvar **o template (embedding 512-d)**. A foto de referência, se guardada, vai para storage separado, cifrado, com retenção curta e finalidade só de auditoria. |
| Re-enrollment | A cada 24–36 meses, ou por evento (mudança física relevante). Opcionalmente: *template adaptativo* — verificações com score muito alto atualizam o template, combatendo aging sem chamar a pessoa de volta. |

**Registrar sempre a taxa de FTE (Failure To Enroll)** — quantas pessoas o sistema simplesmente não consegue cadastrar. É um número que aparece na auditoria e no atrito com o RH.

### 1.2 Marcação (verificação 1:1)

```
[PWA]  colaborador logado (ou gestor selecionou o colaborador)
   ↓   servidor gera desafio one-time (sequência de cores/luz, TTL curto, uso único)
[PWA]  getUserMedia → vídeo 3–7s com o desafio na tela
   ↓   upload da mídia bruta (HTTPS)
[API]  1. valida o desafio (a sequência recebida bate com a emitida?)
       2. liveness / PAD  ──> reprovou? rejeita, loga tentativa, NÃO marca ponto
       3. score de qualidade (OFIQ) ──> ruim? pede recaptura (isso é FTA, não é falta)
       4. extrai embedding DA MESMA MÍDIA
       5. compara 1:1 com o template do colaborador → score de cosseno
       6. decide: aceita / rejeita / zona cinzenta → fallback
[API]  grava a marcação + comprovante ao trabalhador (obrigatório, Portaria 671/2021)
```

**Zona cinzenta obrigatória.** Nunca desenhe um sistema binário. Três faixas:
- **aceita** (score ≥ limiar alto) → marca automaticamente;
- **zona cinzenta** → marca o ponto mas sinaliza para revisão do gestor/RH (o ponto **nunca** pode ser negado ao trabalhador por falha técnica — isso vira passivo trabalhista direto);
- **rejeita liveness** → não marca, oferece fallback imediato.

**Fallback sempre disponível:** senha/PIN + registro assinado pelo gestor. É exigência prática (o colaborador tem direito de registrar a jornada) e é a peça que sustenta o argumento de necessidade perante a ANPD.

### 1.3 Onde 1:N ainda aparece — e como contê-lo

Se algum dia quiserem o modo "chega e bate sem selecionar ninguém", a regra é **1:poucos**, nunca 1:N global:

- galeria restrita a **unidade + turno + janela de horário esperada** (dezenas a poucas centenas de pessoas);
- **isolamento rígido por tenant** — a busca nunca cruza empresas. Isso não é só acurácia, é isolamento de dados entre clientes do SaaS;
- limiar recalibrado para cima conforme N cresce, para manter o FPIR estável;
- monitorar FPIR por unidade, não só global.

---

## 2. Thresholds e métricas

### 2.1 Como escolher o ponto de operação

Não escolha "acurácia" — escolha a **FMR alvo** e aceite a FNMR resultante como custo de usabilidade.

| Cenário | FMR alvo | Comentário |
|---|---|---|
| Verificação 1:1 cooperativa (ponto) | **1e-5** | Recomendação da própria InsightFace para este caso de uso; equilíbrio entre fraude e atrito |
| 1:poucos (galeria de turno) | 1e-6 | Mais restritivo, porque FPIR ≈ N × FMR |
| Alta segurança (não é o seu caso) | ≤ 1e-6 | Fronteira, pagamento, KYC regulado |

Com embeddings ArcFace/AdaFace e similaridade de cosseno, esses pontos costumam cair em **limiar de cosseno ~0,30–0,45** — mas esse número **tem que ser calibrado com dados da própria população da Efrat**, não copiado de blog. Referência de como um fornecedor comercial expõe isso (Azure Face, recognition_03): threshold 0,5 ≈ 1 falso positivo em 100 mil; 0,6 ≈ 1 em 1 milhão.

### 2.2 As métricas que você precisa instrumentar desde o dia 1

| Sigla | O que é | Por que importa aqui |
|---|---|---|
| FMR / FNMR | falso match / falso não-match do matcher | qualidade biométrica pura |
| FPIR / FNIR | equivalentes em modo 1:N | só se usarem 1:poucos |
| **FTE** | falha ao cadastrar | quantos colaboradores o sistema não consegue enrolar |
| **FTA** | falha ao capturar | atrito diário real; é o que gera reclamação no RH |
| APCER / BPCER | erro de PAD (ataque aceito / pessoa real rejeitada) | métricas oficiais da ISO/IEC 30107-3 |

**Logar o score de similaridade de TODAS as tentativas** (aceitas e rejeitadas). Sem isso é impossível reconstruir curvas DET depois e recalibrar. Segmentar as métricas por **unidade, câmera/modelo de aparelho, turno e faixa demográfica**.

### 2.3 O alerta demográfico — leve a sério

O NIST (NISTIR 8429) mediu, num mesmo algoritmo e mesmo limiar, FMR de 1 em 26.000 para homens poloneses de 35–50 anos versus **1 em 35** para mulheres nigerianas de 60+. Diferença de ~720x. Falso *negativo* varia bem menos (~3x) e correlaciona com qualidade de imagem — iluminação inadequada para peles mais escuras é a causa técnica mais comum.

Tradução para a Efrat: com força de trabalho brasileira (alta miscigenação, muita gente em campo, iluminação variada) e **um limiar único para todo mundo**, o erro vai se concentrar em subgrupos. Isso não é só técnico — é risco de discriminação operacional documentável. Por isso a validação (§4) tem que medir por subgrupo, e por isso 1:1 é tão superior a 1:N aqui: o diferencial demográfico explode justamente no falso positivo, que é o que 1:N amplifica.

---

## 3. Liveness — a decisão mais importante do projeto

### 3.1 O que exigir

- **Piso: ISO/IEC 30107-3 PAD Level 2**, atestado por laboratório acreditado (iBeta, FIME, BixeLab), carta com menos de 12–18 meses.
- **O escopo do certificado precisa incluir a plataforma Web.** Muitos certificados cobrem só SDK iOS/Android. Peça a carta e leia o escopo — esse é o erro de compra mais comum.
- **Cobertura de Injection Attack Detection (IAD)** — programa novo do iBeta baseado no rascunho CEN/TS 18099:2025, Nível 2 (câmera virtual/emulador) e Nível 3 (kernel, root/jailbreak). PAD tradicional **não** cobre injeção.
- Métricas APCER/BPCER publicadas, não só "aprovado".

### 3.2 Ativo vs passivo vs desafio de luz

| Modo | Fricção | Resistência |
|---|---|---|
| Ativo (piscar, virar cabeça) | Alta — relatos de até ~50% de drop-off | Vulnerável a vídeo/deepfake que reproduz o gesto pedido. **Não escolha isso** |
| Passivo puro | Baixa (3–10% drop-off) | Bom contra foto/tela; fraco contra vídeo injetado |
| **Passivo + desafio de luz one-time** | Baixa (usuário só olha), 5–12s | Melhor defesa disponível hoje contra replay, porque o desafio é gerado no instante e não pode ser antecipado. **É a escolha certa** |

### 3.3 O que o navegador não dá — assuma e compense

Não existe no PWA: attestation de dispositivo/app, RASP, ou qualquer forma de provar que o `MediaStream` veio de uma câmera física. Câmeras virtuais se registram como dispositivo legítimo no SO, sem root, e o navegador não distingue. A própria Microsoft, na doc do Azure Face Liveness, recomenda **preferir mobile nativo** e trata a solução Web como caso onde não há alternativa.

Compensações realistas para a Efrat:
- desafio one-time server-side (já no desenho acima);
- **imagem de auditoria guardada em toda marcação** (a AWS Face Liveness devolve até 4) — é o que permite auditoria posterior e é o maior desincentivo prático à fraude num contexto de RH, onde o fraudador é um funcionário identificado, não um criminoso anônimo;
- correlação de sinais: geolocalização aproximada, device fingerprint, horário, IP, aparelho vinculado ao colaborador;
- limite de tentativas + alerta ao RH em padrão anômalo;
- detecção heurística de câmera virtual (enumeração de `MediaDeviceInfo`), sabendo que é paliativo.

**Enquadramento honesto do risco:** a ameaça aqui é *buddy punching* (colega batendo ponto pelo outro), não fraude financeira sofisticada. Deepfake em tempo real via câmera virtual, embora tecnicamente possível, é desproporcional ao ganho de marcar 20 minutos a mais. Liveness passivo Level 2 com desafio de luz + imagem de auditoria + trilha de sinais é **suficiente e proporcional** para esse modelo de ameaça. Não superdimensione — mas documente essa decisão de risco no RIPD, porque é exatamente esse raciocínio que a ANPD vai querer ver.

---

## 4. Protocolo de validação — como *provar* antes de construir

Esta é a resposta direta ao que você pediu. Um PoC com critério de aceite numérico, não uma demo bonita.

### Fase 0 — Preparação (1 semana)
- Definir o modelo de ameaça por escrito (buddy punching é o alvo; fraude externa não é).
- Selecionar **2 candidatos** para comparar lado a lado. Sugestão: **AWS Rekognition (IndexFaces + SearchFaces + Face Liveness)** como referência comercial, e **InsightFace/ArcFace self-hosted (via InsightFace-REST ou CompreFace)** como referência de custo. Ver §5.
- Aprovar o piloto com jurídico + termo de participação específico e revogável para os voluntários do teste.

### Fase 1 — Coorte de validação (2 semanas)
- **40 a 60 colaboradores voluntários**, escolhidos para representar a realidade: pele clara e escura, homens e mulheres, faixas etárias diferentes, quem usa óculos, quem usa barba/bigode, quem trabalha em área externa (rosto suado, boné) e interna.
- Cadastrar todos com o protocolo do §1.1, medindo **FTE**.
- Marcações reais por **14 dias corridos**, nos dois modos (celular pessoal e modo posto), com pelo menos ~1.500–2.000 tentativas no total.

### Fase 2 — Medição
| O que medir | Como | Critério de aceite sugerido |
|---|---|---|
| FNMR (falso não-match) no limiar escolhido | tentativas genuínas rejeitadas | **≤ 2%** por colaborador/mês; e nenhum colaborador individual acima de 10% |
| FMR | cross-match offline: comparar cada captura contra os templates de **todos** os outros participantes (isso gera dezenas de milhares de pares impostores sem precisar de fraude real) | zero falsos matches acima do limiar no conjunto de pares |
| FTA (falha de captura) | tentativas que nem chegaram ao matcher | **≤ 5%** das tentativas |
| Latência ponta a ponta | do toque no botão à confirmação | **p95 ≤ 6s** em 4G |
| Paridade demográfica | mesmas métricas segmentadas por subgrupo | nenhum subgrupo com FNMR > 2x a mediana |

### Fase 3 — Teste adversarial (obrigatório, 3 dias)
Com autorização formal e por escrito. Tente furar o próprio sistema:
1. foto impressa do colaborador;
2. foto na tela de outro celular;
3. vídeo do colaborador rodando em tela;
4. colega tentando bater pelo outro com o celular já logado (o caso realista);
5. se possível: app de câmera virtual injetando vídeo gravado — só para **medir**, não para resolver.

**Critério de aceite: 1–4 devem falhar 100% das vezes.** O item 5 provavelmente vai passar em alguma variante — documente o resultado e a mitigação compensatória escolhida, no RIPD. É melhor ter isso escrito e mitigado do que descoberto depois por um funcionário.

### Fase 4 — Congelamento e decisão
- Congelar o limiar **antes** de rodar o conjunto final (senão você está fazendo overfitting no teste).
- Documentar: limiar escolhido, FMR/FNMR medidos, resultado adversarial, taxa de fallback usada.
- Ir/não-ir. Se FTA ou FNMR estourarem, o problema quase sempre é enrollment ou iluminação — não troque de fornecedor antes de refazer o enrollment.

---

## 5. Stack: as opções concretas

| Opção | Prós | Contras | Custo |
|---|---|---|---|
| **AWS Rekognition** (Collections + Face Liveness) | Liveness com **iBeta PAD Level 1 e 2** e SDK **React para Web**; desafio e análise 100% server-side; coleção por empresa = isolamento nativo; região sa-east-1 disponível | Vendor lock-in; custo por check | ~US$ 0,001/imagem (Face APIs) + **US$ 0,015/liveness check**; armazenamento de vetor ~US$ 0,00001/face/mês |
| **InsightFace/ArcFace self-hosted** (InsightFace-REST ou CompreFace) | Acurácia de matching ~equivalente ao comercial; custo marginal ~zero; controle total; dado biométrico não sai da sua infra (bom argumento LGPD) | **Liveness fraco** — é aqui que o open source não compete; sem certificação para apresentar em auditoria | infra apenas; ArcFace R100 ~2,6ms em GPU, modelo leve MBF ~15–40ms em CPU |
| **Azure AI Face** | Bom liveness certificado | **Limited Access**: exige aprovação da Microsoft, account team, revalidação. Inviável como plano A | — |
| **Unico / CAF** (BR) | Modelos treinados em rostos brasileiros; forte em liveness; usado por bancos | Preço só sob contrato; foco em KYC, não em 1:N de ponto; **peça a carta iBeta com escopo Web** — não há divulgação pública equivalente | sob cotação |
| Google Cloud Vision | — | só detecção, não faz recognition/search. **Não é candidato** | — |
| **Serpro Datavalid** | Valida a face contra a base da CNH (~83,7M) — FAR 0,006% / FRR 2,783% na faixa de score ≥93% | Não serve para o dia a dia | por transação, contrato público |

### Recomendação de arquitetura híbrida — provavelmente a melhor relação custo/risco

- **Liveness → serviço comercial certificado** (AWS Face Liveness é o mais direto: React SDK para Web, Level 2, análise server-side). É a peça onde o open source realmente perde, e é a peça que a auditoria vai olhar.
- **Matching → self-hosted (ArcFace)** com os templates no seu próprio banco. Mantém o dado biométrico sob controle da Efrat, elimina custo recorrente por comparação, e dá um argumento LGPD forte (não há transferência do dado sensível a terceiro para a operação diária).
- Cuidado com o acoplamento: o liveness precisa devolver **a mídia/frame validado**, e é dele que você extrai o embedding — senão você quebra a cadeia de custódia do §0.4.
- **Serpro Datavalid uma única vez, no cadastro**, para amarrar o rosto cadastrado ao documento oficial. Isso fecha o buraco de "cadastraram o rosto errado no enrollment" de forma muito elegante — e é barato porque é 1x por colaborador, não por marcação.

### Armazenamento (ISO/IEC 24745)
- **Não guardar a foto crua** além do mínimo de auditoria. Vetor vazado é quase inútil fora do seu sistema; foto vazada serve para deepfake contra a pessoa em qualquer outro lugar.
- **Base biométrica separada** da base operacional (RH, CPF, horários), acessível só por um microsserviço de matching. Minimiza quem consegue fazer o join "vetor ↔ pessoa".
- Cifra em repouso com **KMS + envelope encryption**, chave (ou contexto de criptografia) **por empresa** — vazamento de um tenant não expõe os outros.
- Considerar **cancelable biometrics**: transformar o embedding com um parâmetro por tenant antes de persistir, para que um template comprometido possa ser *revogado* e regerado. Ninguém troca de rosto.
- **Busca vetorial: pgvector** com `company_id`/`unit_id` + Row-Level Security do Postgres. Para a escala da Efrat (centenas a milhares por empresa) é suficiente, mais simples de operar e mais fácil de auditar. FAISS/Milvus só se passar de milhões de vetores agregados.

### WebAuthn/passkeys — o que resolve e o que não
Vale usar como **login forte do PWA** (o dado biométrico nem sai do enclave do aparelho — zero dado sensível para a Efrat guardar). Mas **não substitui** o reconhecimento facial: passkey prova posse do dispositivo desbloqueado, não que a pessoa certa está fisicamente ali — celular emprestado desbloqueado derruba tudo. E não funciona no modo posto (aparelho compartilhado). São complementares, não alternativas.

---

## 6. Checklist de conformidade (LGPD + ponto eletrônico)

### 6.1 O que é regra dura
- Dado biométrico é **dado pessoal sensível** — LGPD art. 5º, II. Sem discussão.
- Tratamento de sensível só nas hipóteses do **art. 11**. Consentimento (inc. I) é **revogável a qualquer tempo** (art. 8º, §5º) — o que o torna estruturalmente frágil como base única para um sistema de ponto que precisa funcionar todo dia, agravado pela assimetria da relação de emprego.
- **REP-P** (software em servidor/nuvem, que é o seu caso) exige **certificado de registro de programa de computador no INPI** — Portaria 671/2021, art. 91. *Providenciar cedo, é burocrático.*
- **Comprovante de marcação disponibilizado ao trabalhador a cada registro** — arts. 79/80.
- **Vedado qualquer dispositivo que permita alterar dados registrados pelo empregado** — art. 74, IV. Desenhe a base como append-only, com trilha de auditoria e correções feitas por lançamento novo, nunca por UPDATE.
- Geração de **AFD** (art. 81, Anexo V) e **AEJ** (art. 83, Anexo VI).
- A ANPD **pode exigir RIPD** de qualquer controlador em fiscalização (art. 38 c/c 55-J, XIII).

### 6.2 Recomendações fortes (não é letra de lei, mas é o que a ANPD cobrou na prática)
- **Base legal: obrigação legal/regulatória (art. 11, II, "a")** para o registro de ponto — CLT art. 74, §2º + Portaria 671/2021 —, **fixada desde o início e mantida estável**. No caso do Paraná, oscilar de base legal durante a fiscalização foi tratado como falha grave por si só.
- **Alternativa não-biométrica obrigatória.** A obrigação legal é registrar a jornada, não registrar por biometria facial. Se existe meio menos invasivo, o princípio da necessidade exige oferecê-lo. Foi exatamente por aí que a ANPD derrubou o caso do Paraná.
- **RIPD específico e vivo** — não reaproveitar RIPD genérico de RH, não deixar parado. Precisa endereçar explicitamente: risco de vigilância permanente, **viés/discriminação algorítmica** (§2.3), risco de vazamento de template, e a análise de necessidade/proporcionalidade (por que face e não PIN/cartão). Revisar periodicamente.
- **ROT** (Registro das Operações de Tratamento) mantido — a ausência foi caracterizada como obstrução à fiscalização.
- Aviso de privacidade específico do app, separado do contrato de trabalho.
- **BYOD:** aditivo específico sobre uso do aparelho pessoal, com **reembolso de dados/energia** (princípio da alteridade — o risco da atividade é do empregador), escopo de permissões mínimo (câmera apenas, nada de galeria/contatos), desinstalação e desativação do template ao fim do vínculo, sem coleta fora da jornada. Há relatos de condenações em TRT-2 e TRT-4 e menção a decisão do TST por app obrigatório com geolocalização 24/7 — não confirmamos os números dos processos.

### 6.3 Retenção
- **Registros de ponto (AFD/AEJ): 5 anos**, prática de mercado ancorada na prescrição quinquenal + bienal trabalhista. Não localizamos prazo literal e explícito na Portaria 671/2021 — confirmar com o jurídico.
- **Template biométrico: enquanto durar o vínculo.** Excluir/desvincular no desligamento — o histórico de ponto continua guardado (prescrição), mas **sem** o template/imagem associados. Não há prazo legal específico para template no Brasil; é boa prática de LGPD.
- **Imagens de auditoria:** retenção curta e justificada (sugestão: 90 dias, ou o prazo de contestação de folha), depois descarte.
- Descarte seguro documentado, com trilha de auditoria da exclusão.

### 6.4 Horizonte regulatório
A ANPD abriu a Tomada de Subsídios TS 01/2025 sobre dados biométricos (1.594 contribuições, 88 participantes; audiência pública em 02/12/2025) e a **regulamentação específica sobre biometria está na agenda para 2026** — ainda não publicada. Um dos temas centrais em disputa é justamente a adequação do consentimento em contextos assimétricos como o emprego. **Desenhe o sistema para não depender de consentimento**, e acompanhe a publicação.

---

## 7. Sequência sugerida

1. Fechar o modelo de ameaça e o desenho 1:1 (elimina a maior parte do risco técnico de graça).
2. Jurídico: fixar base legal, iniciar RIPD, desenhar a alternativa não-biométrica.
3. Iniciar o registro do REP-P no INPI (é lento).
4. PoC comparativo (§4) com 2 stacks e coorte representativa.
5. Congelar limiar, rodar teste adversarial, decidir.
6. Implementar com liveness certificado + matching e templates sob controle da Efrat.

---

## Sources

**Biometria — acurácia, enrollment, thresholds**
- [FRTE 1:1 Verification — NIST](https://pages.nist.gov/frvt/html/frvt11.html)
- [FRTE 1:N Identification — NIST](https://pages.nist.gov/frvt/html/frvt1N.html)
- [Relating 1:1 and 1:N False Positive Rates — NIST (PDF)](https://pages.nist.gov/frvt/reports/demographics/implications_for_1N.pdf)
- [NISTIR 8429 — FRVT Part 8: Demographics (PDF)](https://pages.nist.gov/frvt/reports/demographics/nistir_8429.pdf)
- [FATE Quality — NIST](https://pages.nist.gov/frvt/html/frvt_quality.html)
- [OFIQ 1.0 — Open Source Face Image Quality (BSI)](https://www.bsi.bund.de/EN/Themen/Unternehmen-und-Organisationen/Informationen-und-Empfehlungen/Freie-Software/OFIQ/OFIQ_1_0/OFIQ_1_0.html)
- [Choosing a Face Recognition Model: 1:1, 1:N and Threshold Selection — InsightFace](https://www.insightface.ai/guides/choose-face-recognition-model-and-evaluate)
- [ArcFace — InsightFace](https://www.insightface.ai/research/arcface)
- [Azure Face — Characteristics and limitations (thresholds/FPR)](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/face/characteristics-and-limitations)
- [Amazon Rekognition — Recommendations for facial comparison input images](https://docs.aws.amazon.com/rekognition/latest/dg/recommendations-facial-input-images.html)
- [Enterprise-Grade 1:N Face Recognition — Paravision (PDF)](https://www.paravision.ai/wp-content/uploads/2023/04/paravision_whitepaper_1n_face_recognition.pdf)

**Liveness / PAD / injection**
- [FATE PAD — NIST](https://pages.nist.gov/frvt/html/frvt_pad.html)
- [NISTIR 8491 — Passive software-based PAD (PDF)](https://nvlpubs.nist.gov/nistpubs/ir/2023/NIST.IR.8491.pdf)
- [ISO 30107-3 PAD Test Methodology and Confirmation Letters — iBeta](https://www.ibeta.com/iso-30107-3-presentation-attack-detection-confirmation-letters/)
- [iBeta launches Injection Attack Detection testing against CEN/TS 18099 — Biometric Update](https://www.biometricupdate.com/202606/ibeta-launches-injection-attack-detection-testing-against-cens-ts-18099)
- [Native Virtual Camera Attacks: The Invisible Threat — iProov](https://www.iproov.com/blog/native-virtual-camera-attacks-invisible-threat-biometric-solution)
- [Face liveness detection — Microsoft Learn](https://learn.microsoft.com/en-us/azure/ai-services/face/concept-face-liveness-detection)
- [Understanding shared responsibility for face liveness detection — Microsoft Learn](https://learn.microsoft.com/en-us/azure/ai-services/face/liveness-detection-shared-responsibility)
- [Amazon Rekognition Face Liveness — PAD Level 2 Confirmation Letter (PDF)](https://www.ibeta.com/wp-content/uploads/2023/10/231019-Amazon-Rekognition-PAD-Level-2-Confirmation-Letter.pdf)
- [Detecting face liveness — Amazon Rekognition](https://docs.aws.amazon.com/rekognition/latest/dg/face-liveness.html)

**Stack e armazenamento**
- [Amazon Rekognition pricing](https://aws.amazon.com/rekognition/pricing/)
- [Guidelines and quotas in Amazon Rekognition](https://docs.aws.amazon.com/rekognition/latest/dg/limits.html)
- [Limited Access features of Face — Microsoft Learn](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/computer-vision/limited-access-identity)
- [deepinsight/insightface — GitHub](https://github.com/deepinsight/insightface)
- [SthPhoenix/InsightFace-REST — GitHub](https://github.com/SthPhoenix/InsightFace-REST)
- [exadel-inc/CompreFace — GitHub](https://github.com/exadel-inc/CompreFace)
- [Datavalid — FAQ (Serpro)](https://apidocs.datavalidp.estaleiro.serpro.gov.br/faq/)
- [ISO/IEC 24745:2022 — Biometric information protection](https://www.iso.org/standard/75302.html)
- [Unico DevHub](https://devcenter.unico.io/unico-devhub)

**Jurídico Brasil**
- [LGPD — Lei nº 13.709/2018 (Planalto)](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm)
- [Portaria MTP nº 671/2021 — texto normativo (MTE)](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/legislacao/portarias-1/portarias-vigentes-3/portarias-consolidadas-nova/legislacao/legislacao-por-hierarquia-normativa/portarias-1/portaria-671.html/view)
- [ANPD — RIPD (Relatório de Impacto)](https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/relatorio-de-impacto-a-protecao-de-dados-pessoais-ripd)
- [ANPD — Radar Tecnológico: Biometria (PDF)](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/documentos-tecnicos-orientativos/radar-tecnologico-biometria-anpd-1.pdf/@@display-file/file)
- [ANPD — Tomada de Subsídios sobre Dados Biométricos](https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-abre-tomada-de-subsidios-sobre-tratamento-de-dados-biometricos)
- [ANPD suspende reconhecimento facial em escolas públicas do Paraná — Data Privacy Brasil](https://www.dataprivacybr.org/anpd-suspende-o-uso-de-reconhecimento-facial-em-escolas-publicas-do-parana/)
- [ANPD classifica biometria de estudantes como atividade de alto risco — Capital Digital](https://capitaldigital.com.br/anpd-classifica-biometria-de-estudantes-como-atividade-de-alto-risco-e-suspende-sistema-no-parana/)
