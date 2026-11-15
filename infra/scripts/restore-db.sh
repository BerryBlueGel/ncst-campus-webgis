#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" != '--verify' || $# -ne 2 ]]; then
  echo 'Usage: restore-db.sh --verify /absolute/path/to/campus_YYYYMMDD_HHMMSS.dump' >&2
  echo 'This script restores only to a temporary verification database; it never overwrites production.' >&2
  exit 2
fi
dump="$2"
[[ -f "$dump" && -s "$dump" ]] || { echo 'Dump not found or empty' >&2; exit 2; }

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
env_file="${CAMPUS_ENV_FILE:-$root/infra/docker/.env}"
compose_file="$root/infra/docker/docker-compose.prod.yml"
test_db="campus_verify_$(date -u +%Y%m%d%H%M%S)"
compose=(docker compose --env-file "$env_file" -f "$compose_file")
created=0
cleanup() {
  if ((created)); then
    "${compose[@]}" exec -T -e TEST_DB="$test_db" postgres \
      sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" dropdb -U "$POSTGRES_USER" --if-exists "$TEST_DB"' || true
  fi
}
trap cleanup EXIT

"${compose[@]}" exec -T -e TEST_DB="$test_db" postgres \
  sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" createdb -U "$POSTGRES_USER" "$TEST_DB"'
created=1
"${compose[@]}" exec -T -e TEST_DB="$test_db" postgres \
  sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore -U "$POSTGRES_USER" -d "$TEST_DB" --no-owner --no-privileges' \
  < "$dump"

result="$("${compose[@]}" exec -T -e TEST_DB="$test_db" postgres sh -ec \
  'PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USER" -d "$TEST_DB" -Atc "SELECT (SELECT count(*) FROM campus_feature),(SELECT count(*) FROM model_binding),(SELECT count(*) FROM campus_feature WHERE ST_SRID(geometry)<>32650 OR NOT ST_IsValid(geometry))"')"
printf 'Restored rows (features, bindings, invalid): %s\n' "$result"
[[ "$result" == '449|8|0' ]] || { echo 'Restore validation failed' >&2; exit 1; }
printf 'PASS temporary restore validation\n'
