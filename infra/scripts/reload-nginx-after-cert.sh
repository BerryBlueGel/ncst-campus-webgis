#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
compose=(
  docker compose
  --env-file "$root/infra/docker/.env"
  -f "$root/infra/docker/docker-compose.prod.yml"
  -f "$root/infra/docker/docker-compose.https.yml"
)
"${compose[@]}" exec -T nginx nginx -t
"${compose[@]}" exec -T nginx nginx -s reload
