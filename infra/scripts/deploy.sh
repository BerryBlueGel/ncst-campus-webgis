#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
env_file="${CAMPUS_ENV_FILE:-$root/infra/docker/.env}"
compose_file="$root/infra/docker/docker-compose.prod.yml"
[[ -f "$env_file" ]] || { echo "Missing private env: $env_file" >&2; exit 2; }
compose=(docker compose --env-file "$env_file" -f "$compose_file")
if [[ "${CAMPUS_HTTPS:-false}" == true ]]; then
  compose+=(-f "$root/infra/docker/docker-compose.https.yml")
fi
"${compose[@]}" config --quiet

if "${compose[@]}" ps --status running --services | grep -qx postgres; then
  "$root/infra/scripts/backup-db.sh"
fi

"${compose[@]}" pull postgres
"${compose[@]}" build backend nginx
"${compose[@]}" up -d postgres
"${compose[@]}" up -d --no-build backend
"${compose[@]}" up -d --no-build nginx
"$root/infra/scripts/health-check.sh"
printf 'Deployment healthy. Keep the previous release images for rollback.\n'
