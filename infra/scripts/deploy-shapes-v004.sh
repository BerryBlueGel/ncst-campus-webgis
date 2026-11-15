#!/usr/bin/env bash
# Frontend/model display only. Never touches private env/certificates or DB/QQ.
set -euo pipefail
root=/var/snap/docker/common/campus-webgis
release=20261012-shapes-v004
previous=campus-webgis-web:20261009-detail-batches
image=campus-webgis-web:$release
stage=$root/infra/staging/$release
checkpoint=$root/infra/releases/$release
archive=$root/infra/releases/$release.tar.gz
expected=${1:?Archive SHA256 required}
test "$(realpath "$root")" = "$root"
test "$(docker inspect --format '{{.Config.Image}}' campus-webgis-nginx-1)" = "$previous"
test "$(sha256sum "$archive" | cut -d' ' -f1)" = "$expected"
test ! -e "$stage"; test ! -e "$checkpoint"
mkdir -p "$stage" "$checkpoint"; chmod 700 "$checkpoint"
tar -xzf "$archive" -C "$stage"
compose=$root/infra/docker/docker-compose.prod.yml
cp "$compose" "$checkpoint/docker-compose.prod.yml.before"
tar -czf "$checkpoint/previous-web-source.tar.gz" -C "$root" web/src web/tests web/package.json web/vite.config.ts
for name in backend postgres snowluma; do
  container=campus-webgis-$name-1
  if [ "$name" = snowluma ]; then container=snowluma; fi
  docker inspect --format '{{.Id}}' "$container" > "$checkpoint/$name.id"
done
systemctl show qq-assistant -p MainPID --value > "$checkpoint/qq.pid"
docker build --build-arg BASE_WEB_IMAGE="$previous" -t "$image" -f "$stage/infra/nginx/Dockerfile.shape-release" "$stage/web"
test "$(docker run --rm --entrypoint sha256sum "$image" /usr/share/nginx/html/models/campus_shape_review_v004.glb | cut -d' ' -f1)" = 4e914bf6a05784a2607940a996e25a8ab2b403e157d426e385dd161b73df897c
test "$(docker run --rm --entrypoint sha256sum "$image" /usr/share/nginx/html/models/campus_refined_v005.glb | cut -d' ' -f1)" = 7bd41728d1f2b1f5c631d853abcb824841fc4f8e539b91cd08a0218c24fd3b65
docker run --rm --user 101 --entrypoint sh "$image" -c 'test -r /usr/share/nginx/html/index.html && test -r /usr/share/nginx/html/models/campus_shape_review_v004.glb'
cd "$root/infra/docker"
dc=(docker compose --env-file .env -f docker-compose.prod.yml -f docker-compose.https.yml)
rollback(){ cp "$checkpoint/docker-compose.prod.yml.before" "$compose"; "${dc[@]}" up -d --no-deps --no-build nginx; }
trap rollback ERR
python3 - "$compose" "$previous" "$image" <<'PY'
import pathlib,sys
p=pathlib.Path(sys.argv[1]);s=p.read_text();old='image: '+sys.argv[2]
if s.count(old)!=1:raise SystemExit('Unexpected previous image; refusing change')
p.write_text(s.replace(old,'image: '+sys.argv[3]))
PY
"${dc[@]}" config --quiet
"${dc[@]}" up -d --no-deps --no-build nginx
for i in $(seq 1 20); do
  if curl --fail --silent --resolve ncstgeo.cn:443:127.0.0.1 https://ncstgeo.cn/api/v1/layers >/dev/null; then break; fi
  sleep 2
done
docker exec campus-webgis-nginx-1 nginx -t
curl --fail --silent --resolve ncstgeo.cn:443:127.0.0.1 https://ncstgeo.cn/map >/dev/null
test "$(curl --fail --silent --compressed --resolve ncstgeo.cn:443:127.0.0.1 https://ncstgeo.cn/models/campus_shape_review_v004.glb | sha256sum | cut -d' ' -f1)" = 4e914bf6a05784a2607940a996e25a8ab2b403e157d426e385dd161b73df897c
curl --fail --silent --resolve ncstgeo.cn:443:127.0.0.1 https://ncstgeo.cn/api/v1/layers >/dev/null
for name in backend postgres snowluma; do
  container=campus-webgis-$name-1
  if [ "$name" = snowluma ]; then container=snowluma; fi
  test "$(docker inspect --format '{{.Id}}' "$container")" = "$(cat "$checkpoint/$name.id")"
done
test "$(systemctl show qq-assistant -p MainPID --value)" = "$(cat "$checkpoint/qq.pid")"
systemctl is-active qq-assistant
trap - ERR
cp -a "$stage/web/src/." "$root/web/src/"
cp -a "$stage/web/tests/." "$root/web/tests/"
cp "$stage/web/vite.config.ts" "$root/web/vite.config.ts"
mkdir -p "$root/web/public/models"
cp "$stage/web/dist/models/campus_shape_review_v004.glb" "$root/web/public/models/"
cp "$stage/web/dist/models/campus_shape_review_v004.glb.gz" "$root/web/public/models/"
printf '%s\n' "$image" > "$checkpoint/release-image.txt"
printf '%s\n' "$previous" > "$checkpoint/rollback-image.txt"
printf '%s\n' 'Frontend-only release complete; source assets, DB and QQ unchanged.'
