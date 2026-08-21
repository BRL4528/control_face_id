#!/usr/bin/env bash
# Monta dist/ para a origem publica. Roda no build da Vercel.
#
# Fonte de verdade unica: o motor e os modelos vivem em vendor/ e models/ na
# raiz do repo, e sao COPIADOS aqui no build. Nao ha segunda copia commitada
# para alguem esquecer de atualizar — foi a decisao (i) da T-600DD4.
#
# Exige, no projeto da Vercel desta pasta, a opcao de incluir arquivos de fora
# do Root Directory. Sem ela este script nao encontra ../vendor e o build
# falha alto, que e o que se quer: melhor build vermelho do que pagina no ar
# sem o motor.
set -euo pipefail
cd "$(dirname "$0")"

raiz=".."
test -d "$raiz/vendor" || { echo "ERRO: nao achei ../vendor — ligue 'incluir arquivos fora do Root Directory' no projeto da Vercel"; exit 1; }
test -d "$raiz/models" || { echo "ERRO: nao achei ../models — mesma causa"; exit 1; }

rm -rf dist
mkdir -p dist/vendor dist/models dist/js

# Só o que a pagina publica usa. chart.umd.min.js e do painel do RH e NAO vem:
# codigo de terceiro que ninguem executa nao tem porque existir numa origem
# publica.
cp "$raiz/vendor/face-api.js" dist/vendor/
cp -r "$raiz/vendor/fontes" dist/vendor/fontes
cp "$raiz"/models/* dist/models/

# Fecho de import da pagina publica (docs/fase3-contrato.md §4.6): so estes
# quatro arquivos do app entram, e so eles -- fonte de verdade unica, sem
# segunda copia commitada. modelo.js entra alem do que o diagrama original de
# §4.6 previa: js/face.js importa calcularModeloId de la (T-8ADD9C §4.7),
# dependencia transitiva que nasceu depois do contrato ser escrito.
for f in face.js regras.js ui.js modelo.js; do
  cp "$raiz/js/$f" dist/js/
done

# A pagina em si, e o js dela (o que o Full-Stack escreve nesta pasta).
for f in index.html *.css; do
  [ -e "$f" ] && cp "$f" dist/ || true
done
cp js/*.js dist/js/

echo "dist/ montado:"
find dist -type f | sed 's/^/  /' | head -40
echo "  ($(find dist -type f | wc -l) arquivos)"
