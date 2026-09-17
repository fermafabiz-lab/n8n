#!/usr/bin/env bash
# Builds and serves the site the way the container does.
#
# `next start` does NOT work with this project's `output: standalone`, and
# `next build` rewrites .next/standalone without `static/` or `public/` in it —
# so a plain build-and-run serves the page but 404s every asset, which looks
# exactly like a broken component. This does the two copies that are actually
# required, in the right order.
#
#   scripts/serve-standalone.sh 3100
set -euo pipefail
PORT="${1:-3100}"
cd "$(dirname "$0")/.."

npx next build
rm -rf .next/standalone/public .next/standalone/.next/static
mkdir -p .next/standalone/public
cp -r public/. .next/standalone/public/
cp -r .next/static .next/standalone/.next/static

echo "serving on :$PORT"
PORT="$PORT" exec node .next/standalone/server.js
