#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

say() {
  printf '\n==> %s\n' "$1"
}

say "Mise a jour du code"
if [ -d ".git" ]; then
  git pull --ff-only
else
  printf 'Pas de depot Git detecte, on met seulement les dependances a jour.\n'
fi

say "Installation et verification"
exec "$ROOT_DIR/install"
