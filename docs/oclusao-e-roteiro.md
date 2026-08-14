# Efrat — Adornos, confiabilidade e roteiro até o painel do RH

**Data:** 14/08/2026 · Continuação do documento de validação biométrica.
Duas perguntas: *estamos preparados para boné, capuz, capacete?* e *como chegamos ao painel do RH?*

---

## Parte 1 — Adornos: o que foi medido

Não fui atrás de opinião. Ocluí sinteticamente **6 rostos** usando os pontos faciais reais de cada um, e medi a distância entre o descritor limpo e o descritor ocluído **no mesmo modelo que está rodando no seu celular** (face-api.js / ResNet-34, descritor de 128 dimensões). Comparação da imagem limpa contra a versão ocluída *da mesma foto* — mesma pose, mesma luz, mesma câmera. O único fator que muda é o adorno, então o número é o efeito puro da oclusão.

| Adorno | Detectou o rosto | Distância média | Máx | Veredito no limiar 0.45 |
|---|---|---|---|---|
| Boné | 5/6 | 0.169 | 0.201 | **Reconhece normalmente** |
| Capacete de obra | 4/6 | 0.257 | 0.297 | **Reconhece normalmente** |
| Capuz | 4/6 | 0.253 | 0.300 | **Reconhece normalmente** |
| Óculos escuros | 1/6 | 0.422 | 0.422 | Passa raspando quando detecta |
| Máscara | 1/6 | 0.440 | 0.440 | Passa raspando quando detecta |
| Boné + óculos escuros | 1/6 | 0.450 | 0.450 | Rejeita |
| Capacete + máscara | 1/6 | 0.509 | 0.509 | Rejeita |
| Balaclava / touca ninja | **0/6** | — | — | **Nunca detecta → FTA** |

Referência para calibrar a leitura: mesma pessoa em pose diferente deu **0.101**; duas pessoas diferentes deram **0.61** e **0.80**.

### O que esses números querem dizer

**1. Adorno na parte de cima da cabeça é praticamente irrelevante.** Boné, capacete e capuz ficaram entre 0.15 e 0.30 — bem abaixo do limiar de 0.45, e muito longe da faixa de impostor. Faz sentido: o descritor se apoia na geometria entre olhos, nariz e boca, e nada disso é coberto por um capacete de obra. Você **não precisa** pedir para o pessoal tirar o capacete. Essa era a preocupação mais provável e ela se resolve sozinha.

**2. O modo de falha é bonito.** Repare na coluna "detectou". Óculos escuros, máscara e balaclava quase nunca chegam a ser reconhecidos errado — o detector simplesmente **não acha o rosto**. Isso é ouro do ponto de vista de segurança: o sistema falha para o lado seguro (não registra o ponto e pede outra tentativa), em vez de falhar aceitando a pessoa errada. Não existe nenhuma combinação testada em que um adorno tenha feito o sistema aceitar quem não devia.

**3. Onde mora o risco real: acumular oclusão com outra coisa ruim.** Óculos escuros sozinho deu 0.422, a um fio do limiar de 0.45. O estudo de referência mais recente sobre óculos escuros (Notre Dame, dez/2024, ArcFace/AdaFace em 15 mil pares) mostra exatamente isso: óculos escuros **sozinhos** custam pouco (FPIR de 0% a 0,5%), mas combinados com desfoque ou baixa resolução o erro salta para **4,5%** — quase 10x. Traduzindo para a Efrat: colaborador de óculos escuros, contraluz do sol, celular de entrada com câmera fraca — os três juntos derrubam. Cada um sozinho, não.

**4. Máscara tem número oficial e ele não é pequeno.** O NIST mediu (NISTIR 8331, 319 algoritmos): FNMR sobe de 0,3–0,5% sem máscara para **2,4–5% com máscara**, no ponto de operação FMR = 1e-5, e isso já nos algoritmos treinados depois da pandemia. Nos anteriores, o erro chegava a 20–50%. Ou seja: mesmo com um modelo moderno, máscara custa cerca de **10x mais falso negativo**. Não é caso de "o modelo bom resolve".

### Duas ressalvas honestas sobre esta medição

As minhas oclusões são **retângulos e polígonos sólidos**, mais agressivas que um boné real — um boné de verdade não apaga a testa inteira em preto chapado. Então a taxa de "não detectou" está pessimista, principalmente para capacete. A direção do resultado está certa; a magnitude exata, não.

E a comparação isola a oclusão porque usa a mesma foto. Na vida real soma-se variação de pose, luz e câmera **em cima** disso. As distâncias reais vão ser maiores que as da tabela. Por isso o piloto com gente de verdade (§Fase 5) continua sendo obrigatório — esta medição diz onde procurar, não substitui o campo.

### A decisão de projeto que decorre disso

O caminho certo **não é** tentar reconhecer através da oclusão. É **detectar a oclusão na captura e pedir para remover**. É o que a norma ISO/IEC 29794-5 padroniza — ela tem medidas específicas para isso: *Eyes Visible*, *Face Occlusion Prevention*, *Mouth Occlusion Prevention*, *No Head Coverings*. E é o que os fornecedores sérios fazem: no benchmark OODFace (2024), as APIs comerciais testadas sob oclusão forte preferiram **rejeitar** entre 20% e 35% das tentativas a arriscar um reconhecimento errado.

Só que tem um detalhe operacional que muda tudo no seu caso: **tirar boné ou óculos escuros leva dois segundos**. Isso não é um problema de tecnologia, é um problema de instrução ao usuário. O que o app precisa fazer é *dizer o que está errado*, em vez de só falhar em silêncio.

Já mudei isso no PWA: quando o rosto não é detectado por alguns ciclos seguidos, a mensagem passa a ser **"Nenhum rosto detectado — tire óculos escuros, máscara ou touca"** em vez da dica genérica de luz. Como boné e capacete passam sem problema, eles nem são mencionados — não faz sentido pedir para tirar o que não atrapalha.

### Sobre EPI — um alerta que vale registrar

Capacete não atrapalha, então não há conflito. Mas se algum dia alguém propuser exigir remoção de EPI para identificar, vale saber: não encontrei nenhuma diretriz regulatória tratando de remoção momentânea de EPI para biometria, e exigir que alguém tire capacete em área de queda de objeto, ou respirador em ambiente com contaminante, entra em conflito direto com o princípio de proteção contínua. **A solução correta é posicionar o ponto de captura fora da zona de EPI obrigatório** — na portaria, antes da área de risco. Não é um ajuste de threshold, é um ajuste de layout.

### O que fazer no sistema real

| Prioridade | Ação |
|---|---|
| Alta | Mensagem específica de adorno quando não detecta (**já implementado no PWA**) |
| Alta | No enrollment, **sem nenhum adorno** — capacete, boné, óculos, tudo fora. Template de referência tem que ser limpo, senão você planta o erro na base |
| Alta | Ponto de captura fora da zona de EPI obrigatório |
| Média | Occlusion check formal no servidor. **AWS Rekognition** tem o atributo `FaceOccluded` (booleano, cobre máscara/óculos escuros/mão/objeto, ~US$ 1 por mil imagens); **Azure Face** é mais granular (`occlusion` por região, `accessories` com headwear/glasses/mask, `mask` com `noseAndMouthCovered`) mas exige aprovação de Limited Access. **OFIQ** (BSI alemão, ISO 29794-5, 1º lugar no NIST FATE Quality, licença permissiva) é a opção aberta e mais completa — mas é biblioteca C++, você teria que empacotar como serviço |
| Média | Guardar o resultado do occlusion check junto da marcação — vira evidência na auditoria |
| Baixa | Re-enrollment se a pessoa mudar de forma relevante (barba é a variável mais subestimada: um estudo do WACV 2024 mediu bigode causando aumento de até 659% no Δd', apesar de cobrir a menor área) |

**Não faça:** occlusion check no navegador. Investiguei a fundo — não existe hoje classificador leve e mantido de "óculos escuros / máscara / boné" para ONNX Web ou TF.js, e não existe port WebAssembly do OFIQ. O MediaPipe FaceLandmarker dá 478 pontos e pose 3D, mas **não detecta oclusão**, e pior: quando o rosto está coberto ele tende a "alucinar" os pontos ocultos ajustando o modelo canônico, sem sinalizar baixa confiança. Usar isso como gate de qualidade daria uma falsa sensação de segurança. Essa validação é no servidor.

---

## Parte 2 — Roteiro até o painel do RH

O PWA de hoje é um teste: sem servidor, sem multiempresa, sem auditoria, dados só no aparelho. O painel do RH não é uma tela a mais — ele exige o backend inteiro embaixo. A sequência abaixo é a ordem em que as coisas destravam umas às outras.

### Fase A — Fundação: backend e modelo de dados (2–3 semanas)

Sem isso nada mais existe. O que precisa ficar em pé:

**Multi-tenant de verdade, desde a primeira linha.** `empresa_id` em toda tabela, Row-Level Security do Postgres, e a busca vetorial **nunca** cruzando empresas. Isso é muito mais barato de fazer agora do que retrofitar depois.

**Separação da base biométrica.** Templates numa base própria, acessível só por um microsserviço de matching. A base operacional (RH, CPF, jornada) não guarda vetor. Isso minimiza quem consegue fazer o join "vetor ↔ pessoa" — que é o que transforma um vazamento em incidente grave.

**Ledger append-only para as marcações.** O art. 74, IV da Portaria 671/2021 veda dispositivo que permita alterar dados registrados pelo empregado. Então: nada de `UPDATE` em marcação. Correção é lançamento novo apontando para o original, com autor, motivo e timestamp. Desenhe assim desde o começo — converter depois é doloroso.

**Cifra com chave por empresa** (KMS + envelope encryption), e considerar transformação cancelável do embedding por tenant, para que um template comprometido possa ser revogado. Ninguém troca de rosto.

Entregável: API de enrollment e de marcação funcionando via Postman, sem interface.

### Fase B — Migrar o matching para o servidor (1–2 semanas)

Hoje o embedding é gerado no navegador. Isso é ótimo para testar e inaceitável em produção: qualquer pessoa com o DevTools aberto envia um vetor pré-computado e bate ponto de casa.

- Extração do embedding **no servidor**, a partir da mesma mídia que passou no liveness — cadeia de custódia única.
- Trocar o modelo. O face-api.js é de 2017 (ResNet-34, ~99,4% em LFW) e serviu muito bem para o teste, mas para produção o padrão é **ArcFace ou AdaFace com ResNet100 treinado em Glint360K**. Ganho relevante: no MFR Challenge do InsightFace, incluir 10% de augmentação com máscara no treino subiu a acurácia sob máscara de 69,1% para 77,3% — mais de 8 pontos — ao custo de meio ponto no caso sem máscara. É o tipo de trade que vale.
- **pgvector** com filtro por `empresa_id` + RLS. Para a escala da Efrat é suficiente, mais simples de operar e mais fácil de auditar que FAISS ou Milvus.
- Recalibrar o limiar. Os 0.45 / 0.58 de hoje são da distância euclidiana do modelo antigo. ArcFace usa similaridade de cosseno e ponto de operação diferente — **o número não se transfere**, tem que ser medido de novo.

### Fase C — Painel do RH (3–4 semanas)

Aqui entra o que você pediu. Cinco telas:

**1. Visão geral das equipes** — a tela que abre. Por unidade e por turno: quem já marcou, quem está atrasado, quem não marcou, quem está na zona cinzenta esperando revisão. Semáforo, atualização ao vivo. É a tela que o RH deixa aberta o dia inteiro, então ela precisa responder "está tudo normal?" em dois segundos, sem clique.

**2. Cadastro de pessoal** — o enrollment supervisionado. Gestor ou RH presente, as 3 capturas com o gate de qualidade, o score de coerência interna (já existe no PoC), o registro de **quem** cadastrou e quando. Aqui entra o **Datavalid do Serpro**, uma única vez por colaborador, validando o rosto contra a base da CNH — fecha o buraco de "cadastraram o rosto errado" de forma barata, porque é 1x por pessoa e não por marcação.

**3. Fila de revisão** — as marcações da zona cinzenta. O RH vê a imagem de auditoria lado a lado com a foto de referência, o score, o horário, e aprova ou rejeita. Toda decisão vira registro no ledger. Esta tela é o que faz a zona cinzenta funcionar em vez de ser só um alerta ignorado.

**4. Espelho de ponto** — por colaborador, por período. Marcações, correções com histórico, exportação **AFD** (art. 81, Anexo V) e **AEJ** (art. 83, Anexo VI). É o que o fiscal vai pedir.

**5. Saúde do sistema** — as métricas biométricas que o documento anterior definiu: FTA, taxa de zona cinzenta, distribuição de distâncias, tudo segmentado por unidade, por modelo de aparelho e por faixa demográfica. Esta última segmentação não é firula: o NIST mediu, no mesmo algoritmo e mesmo limiar, FMR variando ~720x entre subgrupos demográficos. Se você não segmentar, o erro se concentra num grupo e ninguém percebe.

E o **comprovante de marcação ao trabalhador** (arts. 79/80) — obrigatório a cada registro, não é opcional.

### Fase D — Conformidade, em paralelo desde já

Não deixe para o fim. Duas coisas têm prazo próprio e travam o lançamento:

- **Registro do REP-P no INPI** (art. 91). É burocrático e lento. Comece agora.
- **RIPD específico**, vivo, endereçando vigilância permanente, viés algorítmico e a análise de necessidade. No caso do Paraná a ANPD tratou RIPD desatualizado como falha grave por si só. Junto: base legal fixada e estável (art. 11, II, "a"), ROT mantido, e a **alternativa não-biométrica** implementada de verdade — não como parágrafo de política.

### Fase E — Liveness e piloto medido (2 semanas + 14 dias de campo)

Só depois do painel existir, porque o piloto precisa de alguém olhando os números.

- Liveness certificado ISO/IEC 30107-3 Level 2 com escopo Web, com o desafio gerado no servidor.
- Piloto com 40–60 pessoas por 14 dias, com os critérios de aceite já definidos: FNMR ≤ 2%, FTA ≤ 5%, p95 de latência ≤ 6s, nenhum subgrupo com FNMR acima de 2x a mediana.
- Teste adversarial formal, incluindo o cenário de adorno: colaborador de boné, de óculos escuros, em contraluz.

---

## Próximo passo concreto

O que destrava mais coisa por menos esforço agora é a **Fase A**. Enquanto ela não existir, cada tela do painel é uma tela de mentira.

Se quiser, eu monto o esquema do banco (multi-tenant, RLS, ledger append-only, base biométrica separada) e a API de enrollment e marcação — dá para deixar rodando e testável via Postman antes de qualquer pixel de interface.

---

## Sources

**Oclusão — medições**
- [FRVT Part 6B: Face recognition accuracy with face masks (NISTIR 8331, PDF)](https://nvlpubs.nist.gov/nistpubs/ir/2020/NIST.IR.8331.pdf)
- [FRVT Part 6A (NISTIR 8311, PDF)](https://nvlpubs.nist.gov/nistpubs/ir/2020/NIST.IR.8311.pdf)
- [FRTE Face Mask Effects — NIST](https://pages.nist.gov/frvt/html/frvt_facemask.html)
- [Impact of Sunglasses on One-to-Many Facial Identification Accuracy (arXiv:2412.05721)](https://arxiv.org/abs/2412.05721)
- [Facial Hair Area in Face Recognition Across Demographics — WACV 2024 Workshop](https://openaccess.thecvf.com/content/WACV2024W/DVPBA/papers/Wu_Facial_Hair_Area_in_Face_Recognition_Across_Demographics_Small_Size_WACVW_2024_paper.pdf)
- [OODFace: Benchmarking Robustness of Face Recognition (arXiv:2412.02479)](https://arxiv.org/html/2412.02479v1)
- [Masked Face Recognition Challenge: InsightFace Track Report — ICCV 2021](https://openaccess.thecvf.com/content/ICCV2021W/MFR/papers/Deng_Masked_Face_Recognition_Challenge_The_InsightFace_Track_Report_ICCVW_2021_paper.pdf)
- [NISTIR 8429 — FRVT Part 8: Demographic Effects (PDF)](https://pages.nist.gov/frvt/reports/demographics/nistir_8429.pdf)

**Qualidade e detecção de oclusão**
- [OFIQ-Project — BSI (GitHub)](https://github.com/BSI-OFIQ/OFIQ-Project)
- [Open Source Face Image Quality (OFIQ) — BSI](https://www.bsi.bund.de/EN/Themen/Unternehmen-und-Organisationen/Informationen-und-Empfehlungen/Freie-Software/OFIQ/OFIQ_node.html)
- [OFIQ — apresentação NIST IFPC 2025 (PDF)](https://pages.nist.gov/ifpc/2025/presentations/05.pdf)
- [ISO/IEC 29794-5 — página do comitê](https://committee.iso.org/standard/81005.html)
- [FaceOccluded — Amazon Rekognition](https://docs.aws.amazon.com/rekognition/latest/APIReference/API_FaceOccluded.html)
- [Anúncio do FaceOccluded (mai/2023) — AWS](https://aws.amazon.com/about-aws/whats-new/2023/05/amazon-rekognition-face-occlusion-identity-verification-accuracy)
- [Azure Face — Detect (REST API)](https://learn.microsoft.com/en-us/rest/api/face/face-detection-operations/detect?view=rest-face-v1.2)
- [Face landmark detection guide — MediaPipe](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker)
- [AdaFace (GitHub)](https://github.com/mk-minchul/adaface)
- [deepinsight/insightface (GitHub)](https://github.com/deepinsight/insightface)

**Jurídico**
- [LGPD — Lei nº 13.709/2018 (Planalto)](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm)
- [Portaria MTP nº 671/2021 — MTE](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/legislacao/portarias-1/portarias-vigentes-3/portarias-consolidadas-nova/legislacao/legislacao-por-hierarquia-normativa/portarias-1/portaria-671.html/view)
- [ANPD suspende reconhecimento facial em escolas do Paraná — Data Privacy Brasil](https://www.dataprivacybr.org/anpd-suspende-o-uso-de-reconhecimento-facial-em-escolas-publicas-do-parana/)
- [OSHA 1910.132 — PPE General requirements](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.132)
