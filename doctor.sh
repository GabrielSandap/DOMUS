#!/usr/bin/env bash
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

OK=0
WARN=0
FAIL=0

pass() {
  OK=$((OK + 1))
  printf 'OK   %s\n' "$1"
}

warn() {
  WARN=$((WARN + 1))
  printf 'WARN %s\n' "$1"
}

fail() {
  FAIL=$((FAIL + 1))
  printf 'FAIL %s\n' "$1"
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

printf 'DOMUS doctor\n'
printf '============\n'

case "$(uname -s)" in
  Darwin) pass "macOS detecte, plateforme de developpement principale" ;;
  Linux) warn "Linux detecte, probablement compatible mais non garanti" ;;
  *) warn "Systeme non teste: $(uname -s)" ;;
esac

if has_cmd node; then
  NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || printf 0)"
  if [ "$NODE_MAJOR" -ge 20 ]; then
    pass "Node.js $(node -v)"
  else
    fail "Node.js 20+ requis, version detectee: $(node -v)"
  fi
else
  fail "Node.js manquant"
fi

if has_cmd npm; then
  pass "npm $(npm -v)"
else
  fail "npm manquant"
fi

if has_cmd python3; then
  pass "$(python3 --version)"
else
  fail "python3 manquant"
fi

if [ -d "node_modules" ]; then
  pass "node_modules installe"
else
  warn "node_modules absent, lance ./installer.sh"
fi

if [ -x ".venv/bin/python" ]; then
  pass "venv Python present"
  if .venv/bin/python -c "import kasa" >/dev/null 2>&1; then
    pass "python-kasa importable"
  else
    fail "python-kasa absent, lance .venv/bin/python -m pip install -r requirements.txt"
  fi
else
  warn ".venv absent, lance ./installer.sh"
fi

if [ -f ".env" ]; then
  pass ".env present"
  if grep -q '^TAPO_EMAIL=.\+' .env && grep -q '^TAPO_PASSWORD=.\+' .env; then
    pass "identifiants Tapo renseignes"
  else
    warn "TAPO_EMAIL/TAPO_PASSWORD a completer dans .env ou via l onboarding"
  fi
else
  warn ".env absent, copie .env.example ou lance l onboarding"
fi

if [ -f "domus-scenes.json" ]; then
  pass "store des ambiances present"
else
  warn "domus-scenes.json absent, il sera cree automatiquement"
fi

printf '\nResultat: %s OK, %s avertissement(s), %s erreur(s)\n' "$OK" "$WARN" "$FAIL"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
