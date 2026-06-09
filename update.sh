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

say "Dependances Node"
npm install

say "Dependances Python"
if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt

say "Build"
npm run build

printf '\nDOMUS est a jour. Lance ./doctor.sh si quelque chose semble bizarre.\n'
