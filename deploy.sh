#!/bin/bash
# Deploy a Cloudflare Pages DESDE GIT (nunca desde el disco local).
# Protege contra sobrescritura accidental de archivos: solo despliega
# lo que está commiteado en HEAD. Uso: ./deploy.sh
set -euo pipefail

cd "$(dirname "$0")"
REPO="$(pwd)"
WRANGLER="/tmp/node_modules/.bin/wrangler"
PROJECT="huevos-app"
TMPDIR=""

cleanup () {
  if [ -n "$TMPDIR" ] && [ -d "$TMPDIR" ]; then rm -rf "$TMPDIR"; fi
}
trap cleanup EXIT

# 1. El repo debe estar limpio: si hay archivos modificados/sobrescritos, abortar
DIRTY="$(git status --porcelain)"
if [ -n "$DIRTY" ]; then
  echo "❌ El repo tiene cambios sin commitear (posible sobrescritura):"
  echo "$DIRTY"
  echo ""
  echo "Revísalo con 'git diff' o restáuralo con 'git checkout -- .'"
  echo "NO se despliega nada hasta que el repo esté limpio."
  exit 1
fi

# 2. Verificar versiones esperadas antes de desplegar
if ! git grep -q "SYNC_API" HEAD -- app.js; then
  echo "❌ app.js en HEAD no contiene SYNC_API. Abortando."
  exit 1
fi

if [ ! -f "$WRANGLER" ]; then
  echo "⚠️  Instalando wrangler..."
  cd /tmp && npm install wrangler@3.90.0 2>&1 | tail -1
fi

# 3. Exportar SOLO el contenido del commit HEAD a un directorio temporal
TMPDIR="$(mktemp -d)"
git archive HEAD | tar -x -C "$TMPDIR"

echo "📦 Desplegando desde git HEAD ($(git rev-parse --short HEAD))..."
cd "$TMPDIR"
$WRANGLER pages deploy . --project-name "$PROJECT" --branch main --commit-dirty=false 2>&1

echo ""
echo "✅ Deploy completado desde git commit $(git -C "$REPO" rev-parse --short HEAD)"