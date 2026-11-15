#!/usr/bin/env bash
# Delete only verified Campus WebGIS staging/build outputs after public acceptance.
set -euo pipefail
root=/var/snap/docker/common/campus-webgis
test "$(realpath "$root")" = "$root"
test "$(docker inspect --format '{{.Config.Image}}' campus-webgis-nginx-1)" = campus-webgis-web:20261009-detail-batches
test "$(docker inspect --format '{{.State.Health.Status}}' campus-webgis-nginx-1)" = healthy
test -d "$root/infra/releases/20261009-detail-batches"
targets=(
  "$root/infra/staging/20261009-detail-batches"
  "$root/infra/releases/20261009-detail-batches.tar.gz"
  "$root/infra/releases/20261004-buildings76/payload/dist"
  "$root/infra/releases/20261004-buildings76/frontend.tar.gz"
)
total=0
for path in "${targets[@]}"; do
  test -e "$path" || continue
  resolved=$(realpath "$path")
  case "$resolved" in "$root"/infra/staging/*|"$root"/infra/releases/*) ;; *) exit 2;; esac
  test ! -L "$path"
  bytes=$(du -sb "$resolved" | cut -f1)
  total=$((total+bytes))
  printf 'REMOVE_REBUILDABLE %s %s bytes\n' "$resolved" "$bytes"
done
for path in "${targets[@]}"; do
  test -e "$path" || continue
  rm -rf -- "$(realpath "$path")"
done
# These old web tags are superseded. Never prune all images or database volumes.
for image in campus-webgis-web:20261002-display1 campus-webgis-web:20261004-teaching3 campus-webgis-web:20261004-buildings76; do
  if docker image inspect "$image" > /dev/null 2>&1; then docker image rm "$image"; fi
done
# Exact build context cache from this release, identified before deletion.
# All QQ, PostgreSQL, backend and unclassified cache records are untouched.
docker buildx prune --force --filter 'id=bb09l6ksjw0bdvihyb74jqle4'
printf 'Removed reproducible files: %s bytes\n' "$total"
docker ps --format '{{.Names}} {{.Status}}'
systemctl is-active qq-assistant
df -B1 /
