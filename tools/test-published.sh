#!/usr/bin/env bash
# Runs the browser tests against the toolbox as it is published (the hub's origin/main), not the
# copy on this computer, which can hold newer pieces that aren't live yet. Run before publishing:
#   npm run test:published
set -eu
here="$(cd "$(dirname "$0")/.." && pwd)"
hub="$here/../hub"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
git -C "$hub" fetch -q origin main
git -C "$hub" archive origin/main shared tools/phone.html icons | tar -x -C "$tmp"
cd "$here"
HUB_DIR="$tmp" PORT=4241 npx playwright test
