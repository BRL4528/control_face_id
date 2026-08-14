# Control Face ID — Ponto por reconhecimento facial (Efrat)

PWA de marcação de ponto por reconhecimento facial, operado no **celular do gestor da equipe** (aparelho da empresa). O colaborador não instala nada, não tem login: só mostra o rosto.

Backend do piloto roda em n8n + Data Tables. Contrato em [`docs/api-piloto.md`](docs/api-piloto.md).

---

## Estado atual

Esta versão é o **PoC de validação biométrica**, já testado em campo:

- cadastro com 3 capturas e gate de qualidade (tamanho, nitidez, luz, pose)
- verificação 1:1 e identificação 1:N lado a lado
- limiares ajustáveis, histograma das distâncias, exportação CSV
- tudo local no aparelho (IndexedDB), sem servidor

**Ainda não implementado** (fluxo v2, em andamento): captura automática, modo fila, nome proposto com confirmação, painel da equipe ao vivo, registro manual após 3 falhas, fila de envio local e integração com a API.

## Rodando

Precisa de HTTPS — a câmera não funciona em `file://`.

```bash
npx serve -l 8080
# abra http://localhost:8080 (localhost conta como contexto seguro)
```

Para abrir no celular, publique em qualquer host estático. Se ativar o **GitHub Pages** deste repositório (Settings → Pages → branch `main`, pasta raiz), a URL sai pronta em HTTPS e o PWA fica instalável na tela de início.

Primeira abertura baixa ~7 MB de modelos; depois funciona offline.

## Estrutura

```
index.html          aplicação inteira (UI + lógica)
vendor/             face-api.js 1.7.15 (@vladmandic) com TFJS embutido
models/             tiny_face_detector, face_landmark_68, face_recognition
manifest.json sw.js PWA e cache offline
docs/               fluxo operacional, contrato da API e as análises técnicas
```

## Decisões que valem saber antes de mexer

**Verificação é 1:1, não 1:N.** O gestor seleciona (ou confirma) quem é, e o rosto prova que é a pessoa. `FPIR ≈ N × FMR` — 1:N puro em galeria grande é onde o erro explode. A galeria fica restrita à equipe (12 a 20 pessoas); a unidade inteira é baixada só para resolver remanejamento.

**O detector completo roda só quando não há rosto rastreado.** Mesmo padrão do MediaPipe Face Mesh: enquanto há rosto, a inferência acontece num recorte pequeno. Medido: 1188 ms → 488 ms por ciclo em ambiente lento.

**O gate de qualidade avalia o frame que o usuário viu aprovado**, não um novo. O último frame bom fica em buffer; sem isso, o rosto se move entre o "qualidade OK" e o toque, e a captura é reprovada injustamente.

**A nitidez é medida sobre o rosto reamostrado para 160×160.** Sem essa normalização, o mesmo limiar se comportaria diferente em cada câmera. Referência medida: nítido ≈ 48, desfoque forte ≈ 6.

**Não há prova de vida (liveness).** É intencional e está documentado na aba Ajustes: foto na tela passa. Serve para justificar a contratação de liveness certificado ISO/IEC 30107-3 Level 2 no sistema real.

## Referências medidas

Mesma pessoa, pose diferente: **0,094** · pessoas diferentes: **0,61** e **0,80** · limiar de aceite: **0,45**.

Adornos, contra o template limpo da mesma foto:

| Adorno | Detectou | Distância |
|---|---|---|
| Boné | 5/6 | 0,169 |
| Capacete de obra | 4/6 | 0,257 |
| Capuz | 4/6 | 0,253 |
| Óculos escuros | 1/6 | 0,422 |
| Máscara | 1/6 | 0,440 |
| Balaclava | 0/6 | não detecta |

Adorno na parte de cima da cabeça não atrapalha. Oclusão de olhos e boca derruba a **detecção** — o sistema falha para o lado seguro, pedindo nova tentativa, em vez de aceitar a pessoa errada.

Detalhes em [`docs/oclusao-e-roteiro.md`](docs/oclusao-e-roteiro.md) e [`docs/validacao-biometrica.md`](docs/validacao-biometrica.md).

## Licença dos modelos

face-api.js é MIT ([@vladmandic/face-api](https://github.com/vladmandic/face-api)). Os pesos vêm do pacote npm oficial.
