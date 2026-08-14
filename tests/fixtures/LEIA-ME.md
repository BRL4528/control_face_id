# Fixtures

Vazio de propósito.

O fluxo é testado no CI com o motor de reconhecimento fingido — determinístico
e sem depender de rosto de ninguém. O motor real tem um teste separado
(`tests/e2e/biometria-manual.cjs`) que precisa de um vídeo `.y4m` com um rosto
de verdade. Esse arquivo não entra no repositório: é dado biométrico.

Para rodar localmente:

```bash
ffmpeg -loop 1 -i rosto.png -t 2 -r 10 -pix_fmt yuv420p tests/fixtures/rosto.y4m
node tests/e2e/biometria-manual.cjs
```
