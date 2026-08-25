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

  # O nucleo importa de FORA dele -- funcoes puras que o cliente tambem roda
  # (js/coerencia.js, js/regras.js). Sao compartilhadas de proposito: e o que
  # faz a API e o navegador nunca discordarem de regra.
  #
  # POR CONSTRUCAO, e nao por lista de dois nomes. A resolucao abaixo le os
  # IMPORTS de verdade, copia o que eles pedem, e QUEBRA se aparecer um import
  # que escape de nucleo/ por um caminho que este script nao sabe copiar.
  # Hoje sao dois arquivos em js/; amanha dominio.js importa um terceiro, ou
  # algo de outra pasta, e o script tem de falhar em vez de copiar de menos.
  # Lista escrita a mao e como o .vercelignore e a guarda de sintaxe ficaram
  # desatualizados neste mesmo repo.
  rm -rf js
  externos=$(grep -rhoE "from '\\.\\./[^']+'" nucleo/ \
             | sed "s/from '//;s/'$//" | sort -u)
  copiados=0
  for imp in $externos; do
    case "$imp" in
      ../js/*)
        arq="${imp#../js/}"
        test -f "../js/$arq" || { echo "ERRO: nucleo importa $imp e o arquivo nao existe na raiz"; exit 1; }
        mkdir -p js && cp "../js/$arq" "js/$arq"
        copiados=$((copiados+1))
        ;;
      ../contexto.js|../dominio.js|../repositorio.js|../http.js|../memoria.js)
        : # interno ao proprio nucleo (de nucleo/casos/), ja veio na copia
        ;;
      *)
        echo "ERRO: nucleo importa '$imp', que escapa de nucleo/ por um caminho"
        echo "  que este script nao sabe copiar. Acrescente o caso aqui -- ou a"
        echo "  API sobe sem esse arquivo e quebra na primeira requisicao."
        exit 1
        ;;
    esac
  done
  test "$copiados" -gt 0 || { echo "ERRO: nenhum arquivo externo copiado -- a resolucao de imports quebrou"; exit 1; }
  echo "js/ compartilhado: $copiados arquivo(s), resolvidos dos imports"

  # CARIMBO DE VERSAO (T-B19BBE). A Vercel NAO injeta VERCEL_GIT_COMMIT_SHA em
  # deploy por CLI -- conferido, a variavel nao existe -- entao o sha e gravado
  # aqui, no unico momento que sabe qual arvore esta subindo.
  #
  # SHA COMPLETO, 40 caracteres, nunca recortado. O cartao existe porque dois
  # instrumentos mostrando recortes DIFERENTES do mesmo commit produzem a duvida
  # que o campo deveria matar. Com o sha inteiro nao ha recorte para divergir: se
  # o outro lado mostra 7, 8 ou 12, o inteiro CONTEM o que ele mostra, e a
  # comparacao vira "um comeca com o outro" em vez de "os dois sao iguais".
  #
  # E `arvore_suja` importa tanto quanto o sha: publicar com mudanca nao
  # commitada e um sha que MENTE sobre o que esta no ar -- atestado falso, que e
  # pior que nao ter atestado. O campo denuncia em vez de esconder.
  if command -v git >/dev/null && git rev-parse --git-dir >/dev/null 2>&1; then
    sha=$(git rev-parse HEAD)
    suja=$([ -n "$(git status --porcelain)" ] && echo true || echo false)
    printf '{"commit":"%s","arvore_suja":%s}\n' "$sha" "$suja" > versao.json
    echo "versao carimbada: ${sha} (arvore suja: ${suja})"
  else
    echo "ERRO: sem git aqui, nao da para carimbar a versao."
    echo "  Publique da arvore do repo, com \`npm --prefix servidor run publicar\`."
    exit 1
  fi
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
  test -f versao.json || { echo "ERRO: versao.json nao veio junto -- /api/saude nao saberia dizer o que esta no ar"; exit 1; }
  echo "nucleo/ presente na copia: $(find nucleo js -name '*.js' | wc -l) arquivos, versao carimbada"
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
