#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
certbot renew \
  --non-interactive \
  --webroot \
  --webroot-path "$root/infra/acme" \
  --config-dir "$root/infra/certs" \
  --work-dir "$root/infra/certbot-work" \
  --logs-dir "$root/infra/certbot-logs" \
  --deploy-hook "$root/infra/scripts/reload-nginx-after-cert.sh" \
  "$@"
