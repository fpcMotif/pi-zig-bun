#!/usr/bin/env bash
set -euo pipefail

if [[ "${SKIP_PREK:-}" == "1" ]]; then
  echo "[pre-commit] SKIP_PREK=1 is set; skipping prek checks"
  exit 0
fi

if command -v prek >/dev/null 2>&1; then
  echo "[pre-commit] running prek..."
  prek run
  exit 0
fi

echo "[pre-commit] ERROR: 'prek' was not found."
echo "Install it now: cargo install prek"
echo "Then re-run: git commit"
exit 1
