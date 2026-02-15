#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "${ROOT_DIR}"
if [[ -d "${ROOT_DIR}/travelplan/prisma/migrations" ]]; then
  MIGRATIONS_DIR="travelplan/prisma/migrations"
elif [[ -d "${ROOT_DIR}/prisma/migrations" ]]; then
  MIGRATIONS_DIR="prisma/migrations"
else
  MIGRATIONS_DIR="travelplan/prisma/migrations"
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Not in a git repository."
  exit 1
fi

if [[ ! -d "${MIGRATIONS_DIR}" ]]; then
  echo "No ${MIGRATIONS_DIR} directory found; skipping."
  exit 0
fi

resolve_base_ref() {
  local candidate="${BASE_REF:-}"
  if [[ -n "${candidate}" ]] && git rev-parse --verify "${candidate}" >/dev/null 2>&1; then
    echo "${candidate}"
    return
  fi

  for ref in origin/main origin/master main master; do
    if git rev-parse --verify "${ref}" >/dev/null 2>&1; then
      echo "${ref}"
      return
    fi
  done

  if git rev-parse --verify HEAD^ >/dev/null 2>&1; then
    echo "HEAD^"
    return
  fi

  echo ""
}

BASE_CANDIDATE="$(resolve_base_ref)"
if [[ -z "${BASE_CANDIDATE}" ]]; then
  echo "Unable to resolve a git base reference; skipping migration immutability check."
  exit 0
fi

BASE_COMMIT="$(git merge-base HEAD "${BASE_CANDIDATE}")"

existing_changes="$(git diff --name-status --diff-filter=MDRT "${BASE_COMMIT}...HEAD" -- "${MIGRATIONS_DIR}" || true)"
if [[ -n "${existing_changes}" ]]; then
  echo "ERROR: Existing migration files were modified, deleted, renamed, or type-changed."
  echo "Migrations are immutable once created/applied. Add a new migration instead."
  echo
  echo "${existing_changes}"
  exit 1
fi

added_files="$(git diff --name-status --diff-filter=A "${BASE_COMMIT}...HEAD" -- "${MIGRATIONS_DIR}" || true)"
if [[ -z "${added_files}" ]]; then
  echo "Migration immutability check passed (no migration changes)."
  exit 0
fi

invalid_additions=0
while IFS=$'\t' read -r status path _; do
  [[ -z "${status:-}" ]] && continue
  if [[ "${path}" =~ ^${MIGRATIONS_DIR}/[0-9]{14}_[a-z0-9_]+/migration\.sql$ ]]; then
    continue
  fi
  if [[ "${path}" == "${MIGRATIONS_DIR}/migration_lock.toml" ]]; then
    continue
  fi

  if [[ ${invalid_additions} -eq 0 ]]; then
    echo "ERROR: Invalid migration additions detected."
    echo "Only new timestamped migration folders with migration.sql are allowed."
    echo
  fi
  echo "${status}	${path}"
  invalid_additions=1
done <<< "${added_files}"

if [[ ${invalid_additions} -ne 0 ]]; then
  exit 1
fi

echo "Migration immutability check passed."
