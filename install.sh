#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

say() {
  printf '\n==> %s\n' "$1"
}

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Commande manquante: %s\n' "$1" >&2
    exit 1
  fi
}

node_major() {
  node -p "Number(process.versions.node.split('.')[0])"
}

say "Verification des prerequis"
need_cmd node
need_cmd npm
need_cmd python3

if [ "$(node_major)" -lt 20 ]; then
  printf 'Node.js 20+ est requis. Version detectee: %s\n' "$(node -v)" >&2
  exit 1
fi

say "Installation des dependances Node"
npm install

say "Preparation de Python"
if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt

if [ ! -f ".env" ]; then
  say "Creation de .env"
  cp .env.example .env
  printf 'Remplis TAPO_EMAIL et TAPO_PASSWORD dans .env, ou lance l app puis suis l onboarding.\n'
else
  say ".env existe deja"
fi

say "Verification du build"
npm run build

cat <<'EOF'

DOMUS est installe.

Demarrage rapide:
  npm run dev

Puis ouvre l adresse affichee par Next.js et suis l onboarding Tapo.

Systeme supporte:
  DOMUS est developpe et teste sur le systeme de Gabriel.
  Les adaptations Windows/PC/Linux exotiques sont bienvenues via contributions.
EOF
