#!/usr/bin/env bash
# Frontend-only release. Existing credentials, database and QQ services are untouched.
set -euo pipefail
root=/var/snap/docker/common/campus-webgis
release=20261009-detail-batches
previous=campus-webgis-web:20261005-buildings124
image=campus-webgis-web:$release
stage=$root/infra/staging/$release
checkpoint=$root/infra/releases/$release
archive=$root/infra/releases/$release.tar.gz
expected=${1:?Archive SHA256 required}
test "$(realpath "$root")" = "$root"
test "$(sha256sum "$archive" | cut -d' ' -f1)" = "$expected"
test ! -e "$stage"
test ! -e "$checkpoint"
mkdir -p "$stage" "$checkpoint"
tar -xzf "$archive" -C "$stage"
compose=$root/infra/docker/docker-compose.prod.yml
https=$root/infra/nginx/conf.d/campus-https.conf
cp "$compose" "$checkpoint/docker-compose.prod.yml.before"
cp "$https" "$checkpoint/campus-https.conf.before"
docker inspect --format '{{.Id}}' campus-webgis-backend-1 > "$checkpoint/backend.id"
docker inspect --format '{{.Id}}' campus-webgis-postgres-1 > "$checkpoint/postgres.id"
docker inspect --format '{{.Id}}' snowluma > "$checkpoint/snowluma.id"
docker build --build-arg BASE_WEB_IMAGE="$previous" -t "$image" -f "$stage/infra/nginx/Dockerfile.dist-release" "$stage/web"
docker run --rm --entrypoint sha256sum "$image" /usr/share/nginx/html/models/campus_detail_release_v004.glb /usr/share/nginx/html/models/campus_refined_v005.glb
test "$(docker run --rm --entrypoint sha256sum "$image" /usr/share/nginx/html/models/campus_detail_release_v004.glb | cut -d' ' -f1)" = d3a1af6c4c50da144cdf287ad39d603fd024c27d56a7318320a76faf932eab48
test "$(docker run --rm --entrypoint sha256sum "$image" /usr/share/nginx/html/models/campus_refined_v005.glb | cut -d' ' -f1)" = 7bd41728d1f2b1f5c631d853abcb824841fc4f8e539b91cd08a0218c24fd3b65
cd "$root/infra/docker"
dc=(docker compose --env-file .env -f docker-compose.prod.yml -f docker-compose.https.yml)
rollback() {
  cp "$checkpoint/docker-compose.prod.yml.before" "$compose"
  cp "$checkpoint/campus-https.conf.before" "$https"
  "${dc[@]}" up -d --no-deps --no-build nginx
}
trap 'rollback' ERR
python3 - "$compose" "$https" "$image" <<'PY'
import pathlib,sys
p=pathlib.Path(sys.argv[1]); text=p.read_text(); old='image: campus-webgis-web:${RELEASE_ID:-local}'
if text.count(old)!=1: raise SystemExit('Unexpected nginx image entry; refusing replacement')
p.write_text(text.replace(old,'image: '+sys.argv[3]))
p=pathlib.Path(sys.argv[2]); text=p.read_text(); old='location /models/ {\n        try_files'
if text.count(old)!=1: raise SystemExit('Unexpected models block; refusing replacement')
p.write_text(text.replace(old,'location /models/ {\n        gzip_static on;\n        try_files'))
PY
"${dc[@]}" config --quiet
"${dc[@]}" up -d --no-deps --no-build nginx
for i in $(seq 1 20); do
  if curl --fail --silent --resolve ncstgeo.cn:443:127.0.0.1 https://ncstgeo.cn/api/v1/layers > /dev/null; then break; fi
  sleep 2
done
docker exec campus-webgis-nginx-1 nginx -t
curl --fail --silent --resolve ncstgeo.cn:443:127.0.0.1 https://ncstgeo.cn/api/v1/layers > /dev/null
test "$(curl --fail --silent --compressed --resolve ncstgeo.cn:443:127.0.0.1 https://ncstgeo.cn/models/campus_detail_release_v004.glb | sha256sum | cut -d' ' -f1)" = d3a1af6c4c50da144cdf287ad39d603fd024c27d56a7318320a76faf932eab48
curl --fail --silent -I -H 'Accept-Encoding: gzip' --resolve ncstgeo.cn:443:127.0.0.1 https://ncstgeo.cn/models/campus_detail_release_v004.glb
for name in backend postgres snowluma; do
  container=campus-webgis-$name-1
  if [ "$name" = snowluma ]; then container=snowluma; fi
  test "$(docker inspect --format '{{.Id}}' "$container")" = "$(cat "$checkpoint/$name.id")"
done
systemctl is-active qq-assistant
trap - ERR
# Keep the matching non-secret source alongside the online build for future maintenance.
cp -a "$stage/web/src/." "$root/web/src/"
cp -a "$stage/web/tests/." "$root/web/tests/"
printf '%s\n' "$image" > "$checkpoint/release-image.txt"
printf '%s\n' 'Frontend-only release healthy; previous image and configurations retained.'
