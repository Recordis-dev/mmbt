#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env.n8n.local"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}. Create it from .env.example or .env.n8n.local." >&2
  exit 1
fi

set -a
source "${ENV_FILE}"
set +a

cd "${ROOT_DIR}"
exec npx n8n
