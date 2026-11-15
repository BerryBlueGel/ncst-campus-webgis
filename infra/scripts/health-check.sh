#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
env_file="${CAMPUS_ENV_FILE:-$root/infra/docker/.env}"
compose_file="$root/infra/docker/docker-compose.prod.yml"
base="${HEALTH_BASE_URL:-http://127.0.0.1}"
expected_glb='7BD41728D1F2B1F5C631D853ABCB824841FC4F8E539B91CD08A0218C24FD3B65'

for path in / /map /dashboard /analysis /about /api/v1/features/library /api/v1/stats/overview; do
  curl --fail --silent --show-error --max-time 30 --output /dev/null "$base$path"
  printf 'PASS %s\n' "$path"
done

docker compose --env-file "$env_file" -f "$compose_file" exec -T backend \
  curl --fail --silent --show-error http://127.0.0.1:8080/actuator/health \
  | grep -q '"status":"UP"'
printf 'PASS internal backend health\n'

tmp="$(mktemp)"
trap 'rm -f -- "$tmp"' EXIT
curl --fail --silent --show-error --max-time 90 "$base/models/campus_refined_v005.glb" --output "$tmp"
actual="$(sha256sum "$tmp" | cut -d' ' -f1 | tr '[:lower:]' '[:upper:]')"
if [[ "$actual" != "$expected_glb" ]]; then
  printf 'FAIL GLB hash: %s\n' "$actual" >&2
  exit 1
fi
printf 'PASS model SHA-256 %s\n' "$actual"
