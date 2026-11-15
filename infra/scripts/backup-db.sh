#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
env_file="${CAMPUS_ENV_FILE:-$root/infra/docker/.env}"
compose_file="$root/infra/docker/docker-compose.prod.yml"
backup_dir="$root/infra/backup"
mkdir -p -- "$backup_dir"
chmod 700 "$backup_dir"
umask 077
output="$backup_dir/campus_$(date -u +%Y%m%d_%H%M%S).dump"
partial="$(mktemp "$backup_dir/.campus_partial_XXXXXX")"
trap 'rm -f -- "$partial"' EXIT

docker compose --env-file "$env_file" -f "$compose_file" exec -T postgres \
  sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > "$partial"
test -s "$partial"
mv -- "$partial" "$output"
printf 'Backup created: %s\n' "$output"

# Keep the 14 newest dumps. Only this script's exact backup filename pattern is eligible.
mapfile -t dumps < <(find "$backup_dir" -maxdepth 1 -type f -name 'campus_*.dump' -printf '%T@ %p\n' | sort -nr | cut -d' ' -f2-)
for ((i=14; i<${#dumps[@]}; i++)); do
  candidate="${dumps[i]}"
  [[ "$candidate" == "$backup_dir"/campus_*.dump ]] || { echo 'Unexpected backup path' >&2; exit 1; }
  rm -- "$candidate"
done
