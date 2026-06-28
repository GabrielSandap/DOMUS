#!/usr/bin/env bash
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

OK=0
WARN=0
FAIL=0
MIN_NODE_MAJOR=20
MIN_NODE_MINOR=9
MIN_PYTHON_MAJOR=3
MIN_PYTHON_MINOR=11

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

node_version_ok() {
  has_cmd node && node -e "
const [major, minor] = process.versions.node.split('.').map(Number);
process.exit(major > $MIN_NODE_MAJOR || (major === $MIN_NODE_MAJOR && minor >= $MIN_NODE_MINOR) ? 0 : 1);
" >/dev/null 2>&1
}

python_version_ok() {
  local python="$1"
  "$python" - <<PY >/dev/null 2>&1
import sys
sys.exit(0 if sys.version_info >= ($MIN_PYTHON_MAJOR, $MIN_PYTHON_MINOR) else 1)
PY
}

python_version() {
  local python="$1"
  "$python" - <<'PY'
import sys
print(f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")
PY
}

find_compatible_python() {
  local candidate

  for candidate in python3.14 python3.13 python3.12 python3.11 python3; do
    if has_cmd "$candidate" && python_version_ok "$candidate"; then
      command -v "$candidate"
      return 0
    fi
  done

  return 1
}

printf 'DOMUS doctor\n'
printf '============\n'

case "$(uname -s)" in
  Darwin) pass "macOS detecte, plateforme de developpement principale" ;;
  Linux) warn "Linux detecte, probablement compatible mais non garanti" ;;
  *) warn "Systeme non teste: $(uname -s)" ;;
esac

if node_version_ok; then
    pass "Node.js $(node -v)"
elif has_cmd node; then
  fail "Node.js >= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR} requis, version detectee: $(node -v)"
else
  fail "Node.js manquant"
fi

if has_cmd npm; then
  pass "npm $(npm -v)"
else
  fail "npm manquant"
fi

PYTHON_BIN="$(find_compatible_python || true)"
if [ -n "$PYTHON_BIN" ]; then
  pass "Python compatible $(python_version "$PYTHON_BIN") ($PYTHON_BIN)"
else
  fail "Python >= ${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR} manquant"
fi

if has_cmd python3 && ! python_version_ok "$(command -v python3)"; then
  warn "python3 pointe vers une version trop ancienne; ./install utilisera une version Python compatible si disponible"
fi

if [ -d "node_modules" ]; then
  pass "node_modules installe"
else
  warn "node_modules absent, lance ./install"
fi

if [ -x ".venv/bin/python" ]; then
  if python_version_ok ".venv/bin/python"; then
    pass "venv Python $(python_version ".venv/bin/python")"
  else
    fail "venv Python trop ancien, relance ./install"
  fi

  if .venv/bin/python -c "import kasa" >/dev/null 2>&1; then
    pass "python-kasa importable"
  else
    fail "python-kasa absent, lance .venv/bin/python -m pip install -r requirements.txt"
  fi
else
  warn ".venv absent, lance ./install"
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

if [ -d ".next" ]; then
  pass "build Next.js present"
else
  warn "build Next.js absent, lance ./install"
fi

if has_cmd domus; then
  if domus help >/dev/null 2>&1; then
    pass "CLI global domus disponible ($(command -v domus))"
  else
    fail "CLI global domus installe mais non fonctionnel"
  fi
else
  fail "CLI global domus absent, lance ./install"
fi

printf '\nResultat: %s OK, %s avertissement(s), %s erreur(s)\n' "$OK" "$WARN" "$FAIL"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
