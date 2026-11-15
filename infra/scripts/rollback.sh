#!/usr/bin/env bash
set -euo pipefail

release="${1:-}"
[[ "$release" =~ ^[A-Za-z0-9._-]+$ ]] || { echo 'Usage: rollback.sh PREVIOUS_RELEASE_ID' >&2; exit 2; }
docker image inspect "campus-webgis-backend:$release" "campus-webgis-web:$release" >/dev/null
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
env_file="${CAMPUS_ENV_FILE:-$root/infra/docker/.env}"
compose_file="$root/infra/docker/docker-compose.prod.yml"
"$root/infra/scripts/backup-db.sh"
export RELEASE_ID="$release"
compose=(docker compose --env-file "$env_file" -f "$compose_file")
if [[ "${CAMPUS_HTTPS:-false}" == true ]]; then
  compose+=(-f "$root/infra/docker/docker-compose.https.yml")
fi
"${compose[@]}" up -d --no-build backend nginx
"$root/infra/scripts/health-check.sh"
printf 'Rolled application images back to %s; database schema was not downgraded.\n' "$release"
