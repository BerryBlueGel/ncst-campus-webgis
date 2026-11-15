#!/usr/bin/env bash
# Rebuildable payloads only; preserve current image and immediate rollback.
set -euo pipefail
root=/var/snap/docker/common/campus-webgis
test "$(realpath "$root")" = "$root"
test "$(docker inspect --format '{{.Config.Image}}' campus-webgis-nginx-1)" = campus-webgis-web:20261012-shapes-v004
test "$(docker inspect --format '{{.State.Health.Status}}' campus-webgis-nginx-1)" = healthy
docker image inspect campus-webgis-web:20261009-detail-batches >/dev/null
test -f "$root/infra/releases/20261012-shapes-v004/previous-web-source.tar.gz"
test "$(sha256sum "$root/web/public/models/campus_shape_review_v004.glb" | cut -d' ' -f1)" = 4e914bf6a05784a2607940a996e25a8ab2b403e157d426e385dd161b73df897c
before=$(df -B1 --output=avail / | tail -1 | tr -d ' ')
targets=("$root/infra/staging/20261012-shapes-v004" "$root/infra/releases/20261012-shapes-v004.tar.gz"
 "$root/infra/staging/20261002-display1" "$root/infra/releases/20261005-buildings124/dist.tar.gz")
total=0
for path in "${targets[@]}"; do
 test -e "$path" || continue
 test ! -L "$path"
 resolved=$(realpath "$path")
 case "$resolved" in "$root"/infra/staging/*|"$root"/infra/releases/*) ;; *) exit 2;; esac
 # Never follow embedded links during a recursive cleanup.
 test -z "$(find "$resolved" -type l -print -quit)"
 bytes=$(du -sb "$resolved" | cut -f1);total=$((total+bytes))
 printf 'REMOVE_REBUILDABLE %s %s bytes\n' "$resolved" "$bytes"
done
for path in "${targets[@]}"; do
 test -e "$path" || continue
 resolved=$(realpath "$path")
 case "$resolved" in "$root"/infra/staging/*|"$root"/infra/releases/*) ;; *) exit 2;; esac
 rm -rf -- "$resolved"
done
# Do not prune all Docker caches, images, containers, or database volumes.
# This exact local-context record was observed after the 2026-10-12 build;
# its 42.27 MB context is rebuildable from the preserved frontend/model source.
docker buildx prune --force --filter 'id=h2jd2alx81ttu9mrp93x1x9xq'
if docker image inspect campus-webgis-web:20261005-buildings124 >/dev/null 2>&1; then
 test -z "$(docker ps -aq --filter ancestor=campus-webgis-web:20261005-buildings124)" && docker image rm campus-webgis-web:20261005-buildings124 || printf 'Shared older image retained.\n'
fi
after=$(df -B1 --output=avail / | tail -1 | tr -d ' ')
printf 'DELETED_FILES_BYTES %s\nFREE_BEFORE_BYTES %s\nFREE_AFTER_BYTES %s\n' "$total" "$before" "$after"
docker ps --format '{{.Names}} {{.Status}}'
systemctl is-active qq-assistant
