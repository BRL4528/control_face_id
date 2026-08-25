#!/usr/bin/env bash
# Traz nucleo/ para dentro de servidor/, e confere que ele esta la.
#
# DOIS CONTEXTOS, e o script sabe em qual esta:
#
#   LOCAL, antes do deploy (../nucleo existe)  -> COPIA.
#   BUILD da Vercel        (../nucleo NAO existe, porque o Root Directory e
#                           servidor/ e o CLI sobe so esta pasta) -> CONFERE.
#
# Isto NAO e "tolerar ausencia". A ausencia tolerada e a da FONTE, e so quando a
# COPIA esta presente e conferida. Se faltarem as duas, falha alto — melhor
# build vermelho do que API no ar sem o dominio.
#
# POR QUE A FONTE VIVE NA RAIZ: tests/e2e/servidor-falso.js tambem usa nucleo/.
# O servidor falso e a API tem de executar o MESMO codigo, nao dois parecidos —
# e assim que duas implementacoes divergem sem ninguem ver.
#
# NAO RODE ISTO SEPARADO DO DEPLOY. Use `npm run publicar` (ou `publicar:prod`),
# que copia e publica no mesmo comando. Copiar hoje e publicar amanha e como se
# fabrica uma copia velha, que e o defeito que este arquivo existe para impedir.
set -euo pipefail
cd "$(dirname "$0")"

if [ -d ../nucleo ]; then
  rm -rf nucleo
  cp -r ../nucleo nucleo
  echo "nucleo/ copiado da raiz: $(find nucleo -name '*.js' | wc -l) arquivos"
else
  test -d nucleo || {
    echo "ERRO: nao achei ../nucleo (a fonte) nem ./nucleo (a copia)."
    echo "  A API nao pode subir sem o nucleo do dominio."
    echo "  Rode, da raiz do repo:  npm --prefix servidor run publicar"
    exit 1
  }
  test -f nucleo/repositorio.js || { echo "ERRO: ./nucleo existe mas esta incompleto"; exit 1; }
  echo "nucleo/ presente na copia: $(find nucleo -name '*.js' | wc -l) arquivos"
fi

# A Vercel exige um diretorio de saida estatico quando ha buildCommand. Este
# projeto e so funcoes, entao a saida e uma pagina unica que diz o que isto e —
# em vez de apontar outputDirectory para a propria pasta, que publicaria o
# codigo-fonte da API como arquivo estatico.
rm -rf public && mkdir -p public
cat > public/index.html <<'HTML'
<!doctype html><meta charset="utf-8"><title>API</title>
<p>Origem de API. Nao ha pagina aqui.
HTML
