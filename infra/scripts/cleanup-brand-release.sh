#!/usr/bin/env bash
# Only expanded release staging and uploaded release archives, never checkpoints.
set -euo pipefail
root=/var/snap/docker/common/campus-webgis
test "$(realpath "$root")" = "$root"
test "$(docker inspect --format '{{.Config.Image}}' campus-webgis-nginx-1)" = campus-webgis-web:20261017-brand-icons
docker image inspect campus-webgis-web:20261014-clean-ui-final >/dev/null
curl --fail --silent --resolve ncstgeo.cn:443:127.0.0.1 https://ncstgeo.cn/api/v1/layers >/dev/null
systemctl is-active --quiet qq-assistant
bytes=0
for release in 20261012-academic-v005 20261013-academic-v005 20261013-academic-v006 20261013-analysis-layers 20261014-clean-ui 20261014-clean-ui-final 20261017-brand-icons; do
  for candidate in "$root/infra/staging/$release" "$root/infra/releases/$release.tar.gz"; do
    if [ ! -e "$candidate" ]; then continue; fi
    resolved=$(realpath -e "$candidate")
    test "$resolved" = "$candidate"
    case "$resolved" in
      "$root/infra/staging/$release"|"$root/infra/releases/$release.tar.gz") ;;
      *) exit 1 ;;
    esac
    size=$(du -sb "$resolved" | cut -f1)
    bytes=$((bytes+size))
    printf 'Removing reproducible release artifact: %s (%s bytes)\n' "$resolved" "$size"
    rm -rf -- "$resolved"
  done
done
test "$(docker inspect --format '{{.Config.Image}}' campus-webgis-nginx-1)" = campus-webgis-web:20261017-brand-icons
test -f "$root/infra/releases/20261017-brand-icons/docker-compose.prod.yml.before"
test -f "$root/infra/releases/20261017-brand-icons/previous-web-source.tar.gz"
curl --fail --silent --resolve ncstgeo.cn:443:127.0.0.1 https://ncstgeo.cn/api/v1/layers >/dev/null
systemctl is-active qq-assistant
printf 'Removed cloud release artifact bytes: %s\n' "$bytes"
df -h /
