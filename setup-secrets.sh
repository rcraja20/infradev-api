#!/bin/bash
# ==========================================================
# INFRADEV-API — one-time secrets setup
#
# Fill in .env.secrets (copy from .env.secrets.example) with your
# real values, THEN run this script once:
#
#   chmod +x setup-secrets.sh
#   ./setup-secrets.sh
#
# It reads .env.secrets and pushes every value to Cloudflare with
# `wrangler secret put` — one command per line, but you only run
# ONE script instead of typing each one into the dashboard.
#
# .env.secrets is listed in .gitignore — it must NEVER be committed.
# ==========================================================

set -e

if [ ! -f .env.secrets ]; then
  echo "Missing .env.secrets — copy .env.secrets.example to .env.secrets and fill in real values first."
  exit 1
fi

echo "Pushing secrets to Cloudflare Worker infradev-api..."

while IFS='=' read -r key value; do
  # skip blank lines and comments
  [[ -z "$key" || "$key" == \#* ]] && continue
  echo "Setting $key..."
  echo "$value" | npx wrangler secret put "$key"
done < .env.secrets

echo "Done. Now go delete or blank out .env.secrets locally so the real values don't sit on disk."
