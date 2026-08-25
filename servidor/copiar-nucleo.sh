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
  rm -rf nucleo js
  cp -r ../nucleo nucleo
  echo "nucleo/ copiado da raiz: $(find nucleo -name '*.js' | wc -l) arquivos"

  # O nucleo importa FUNCOES PURAS do cliente (../js/coerencia.js e
  # ../js/regras.js): sao as mesmas regras que o navegador roda, e o ponto de
  # elas serem compartilhadas e a API e o cliente nunca discordarem.
  #
  # A lista NAO e escrita a mao. Ela sai dos proprios imports, senao uma
  # dependencia nova entra e o deploy quebra em runtime, na primeira
  # requisicao -- que foi exatamente o que aconteceu quando rotas.js chegou
  # trazendo dominio.js -> ../js/coerencia.js: a copia subiu sem esses dois e
  # /api/saude acusou rotas:0.
  mkdir -p js
  deps=$(grep -rhoE "from '\.\./js/[a-zA-Z0-9_.-]+'" nucleo/ | sed "s#.*/js/##;s#'##" | sort -u)
  test -n "$deps" || { echo "ERRO: nao consegui extrair as dependencias de ../js do nucleo"; exit 1; }
  for f in $deps; do
    test -f "../js/$f" || { echo "ERRO: nucleo importa js/$f e ele nao existe na raiz"; exit 1; }
    cp "../js/$f" js/
  done
  echo "js/ compartilhado copiado: $(echo "$deps" | tr '\n' ' ')"
else
  test -d nucleo || {
    echo "ERRO: nao achei ../nucleo (a fonte) nem ./nucleo (a copia)."
    echo "  A API nao pode subir sem o nucleo do dominio."
    echo "  Rode, da raiz do repo:  npm --prefix servidor run publicar"
    exit 1
  }
  test -f nucleo/repositorio.js || { echo "ERRO: ./nucleo existe mas esta incompleto"; exit 1; }
  # Confere que TODA dependencia de ../js veio junto. Faltar uma quebra so na
  # primeira requisicao, nao no build.
  for f in $(grep -rhoE "from '\.\./js/[a-zA-Z0-9_.-]+'" nucleo/ | sed "s#.*/js/##;s#'##" | sort -u); do
    test -f "js/$f" || { echo "ERRO: a copia do nucleo importa js/$f e ele nao veio junto"; exit 1; }
  done
  echo "nucleo/ presente na copia: $(find nucleo js -name '*.js' | wc -l) arquivos"
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
