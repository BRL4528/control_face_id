#!/usr/bin/env bash
# Sobe o que está commitado e mostra onde acompanhar o CI.
# Existe porque a sessão do Cowork não tem rota para o github.com —
# o commit é feito lá, o push precisa sair da sua máquina.
set -euo pipefail
cd "$(dirname "$0")"

if [ -n "$(git status --porcelain)" ]; then
  echo "⚠  Há mudanças não commitadas:"
  git status --short
  echo
  read -rp "Commitar tudo antes de subir? [s/N] " r
  [[ "$r" =~ ^[sS]$ ]] || { echo "Abortado."; exit 1; }
  read -rp "Mensagem: " msg
  git add -A && git commit -m "$msg"
fi

ramo="$(git rev-parse --abbrev-ref HEAD)"
echo "→ push de $ramo para $(git remote get-url origin)"
git push -u origin "$ramo"

echo
echo "✓ no ar. Acompanhe:"
echo "  CI      https://github.com/BRL4528/control_face_id/actions"
echo "  commit  https://github.com/BRL4528/control_face_id/commit/$(git rev-parse --short HEAD)"
