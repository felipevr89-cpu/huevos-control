#!/bin/bash
# Deploy a Cloudflare Pages desde la máquina local
# Uso: ./deploy.sh
set -e

WRANGLER="/tmp/node_modules/.bin/wrangler"
PROJECT="huevos-app"

if [ ! -f "$WRANGLER" ]; then
  echo "⚠️  Instalando wrangler..."
  cd /tmp && npm install wrangler@3.90.0 2>&1 | tail -1
fi

echo "📦 Desplegando a Cloudflare Pages..."
cd "$(dirname "$0")"
$WRANGLER pages deploy . --project-name "$PROJECT" --branch main --commit-dirty=true 2>&1

echo ""
echo "✅ Deploy completado"
