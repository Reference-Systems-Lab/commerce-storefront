#!/bin/sh
# The storefront image, built the way the release builds it (REQ-013, REQ-002, REQ-015).
#   sh scripts/image.sh build      build linux/amd64 and load it as commerce-storefront:ci
#   sh scripts/image.sh scan       Grype at high on the image and on the deps stage (every installed
#                                  package, development ones included); no allowlist, no only-fixed
#   sh scripts/image.sh rehearse   the release's build: both platforms, SBOM and provenance, to an OCI
#                                  layout; then no layer, SBOM, provenance, history or saved image may
#                                  hold the token, and the arm64 copy must serve /
#   sh scripts/image.sh run        run the loaded image hardened: healthy, then a clean stop
set -eu
cd "$(dirname "$0")/.."

IMAGE=commerce-storefront:ci
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"; docker rm -f commerce-storefront-check >/dev/null 2>&1 || true' EXIT

# The build's npm_token secret: NODE_AUTH_TOKEN, or the GitHub Packages token in ~/.npmrc.
token() {
  if [ -z "${NODE_AUTH_TOKEN:-}" ] && [ -f "$HOME/.npmrc" ]; then
    NODE_AUTH_TOKEN=$(sed -n 's#^//npm\.pkg\.github\.com/:_authToken=##p' "$HOME/.npmrc" | head -n 1)
    case $NODE_AUTH_TOKEN in '${'*) NODE_AUTH_TOKEN= ;; esac
  fi
  if [ -z "${NODE_AUTH_TOKEN:-}" ]; then
    echo "error: set NODE_AUTH_TOKEN, or put a read:packages token in ~/.npmrc (README)" >&2
    exit 1
  fi
  export NODE_AUTH_TOKEN
}

build() { docker buildx build --secret id=npm_token,env=NODE_AUTH_TOKEN "$@" .; }
tools() { HOST_UID=$(id -u) HOST_GID=$(id -g) docker compose -f compose.tools.yaml run --rm --quiet-pull "$@"; }

# no_token <dir>: fail if the token's value is in any file under <dir>, compressed or not.
no_token() {
  find "$1" -type f >"$tmp/files"
  while read -r file; do
    if gzip -t "$file" 2>/dev/null; then gzip -dc "$file"; else cat "$file"; fi >"$tmp/blob"
    if grep -F -q -- "$NODE_AUTH_TOKEN" "$tmp/blob"; then
      echo "error: the npm token is in ${file#"$1"/}" >&2
      exit 1
    fi
  done <"$tmp/files"
}

case "${1:-}" in
build)
  token
  build --platform linux/amd64 --load -t "$IMAGE"
  ;;
scan)
  token
  build --platform linux/amd64 --target deps --output "type=docker,dest=$tmp/deps.tar,name=commerce-storefront-deps:ci"
  docker save "$IMAGE" -o "$tmp/image.tar"
  mkdir -p .data/grype-db
  export SCAN_DIR="$tmp" GRYPE_CACHE="$PWD/.data/grype-db"
  failed=0
  echo "scan: every installed package (deps stage)"
  tools grype docker-archive:/scan/deps.tar --fail-on high || failed=1
  echo "scan: the image"
  tools grype docker-archive:/scan/image.tar --fail-on high || failed=1
  exit "$failed"
  ;;
rehearse)
  token
  build --platform linux/amd64,linux/arm64 --sbom=true --provenance=mode=max --output "type=oci,dest=$tmp/oci.tar"
  mkdir "$tmp/oci" && tar -xf "$tmp/oci.tar" -C "$tmp/oci"
  no_token "$tmp/oci"
  echo "rehearse: no token in the OCI layout, SBOM or provenance"
  if docker history --no-trunc "$IMAGE" | grep -F -q -- "$NODE_AUTH_TOKEN"; then
    echo "error: the npm token is in the image history" >&2
    exit 1
  fi
  mkdir "$tmp/saved" && docker save "$IMAGE" | tar -x -C "$tmp/saved"
  no_token "$tmp/saved"
  echo "rehearse: no token in the history or the saved image"
  build --platform linux/arm64 --load -t "$IMAGE-arm64"
  docker run -d --name commerce-storefront-check --platform linux/arm64 "$IMAGE-arm64" >/dev/null
  code=$(docker run --rm --network "container:commerce-storefront-check" --platform linux/arm64 \
    --entrypoint /usr/bin/node "$IMAGE-arm64" --input-type=module -e '
      for (let i = 0; i < 60; i++) {
        try { const r = await fetch("http://127.0.0.1:3000/"); console.log(r.status); process.exit(0); }
        catch { await new Promise((ok) => setTimeout(ok, 500)); }
      }
      process.exit(1);')
  [ "$code" = 200 ] || { echo "error: the arm64 image answered / with $code" >&2; exit 1; }
  echo "rehearse: the arm64 image serves /"
  ;;
run)
  docker run -d --name commerce-storefront-check --read-only --cap-drop ALL \
    --security-opt no-new-privileges:true --init --user 65532:65532 --tmpfs /tmp:size=16m \
    -e NUXT_API_BASE_URL=http://backend-api.invalid:8080 "$IMAGE" >/dev/null
  for _ in $(seq 1 60); do
    status=$(docker inspect -f '{{.State.Health.Status}}' commerce-storefront-check)
    [ "$status" = healthy ] && break
    sleep 1
  done
  [ "$status" = healthy ] || { docker logs commerce-storefront-check >&2; echo "error: not healthy" >&2; exit 1; }
  echo "run: healthy without a backend"
  start=$(date +%s)
  docker stop commerce-storefront-check >/dev/null
  code=$(docker inspect -f '{{.State.ExitCode}}' commerce-storefront-check)
  took=$(($(date +%s) - start))
  [ "$code" = 0 ] || { echo "error: stopped with exit code $code" >&2; exit 1; }
  [ "$took" -lt 10 ] || { echo "error: stopping took ${took}s" >&2; exit 1; }
  echo "run: stopped cleanly (exit 0, ${took}s)"
  ;;
*)
  echo "usage: sh scripts/image.sh build | scan | rehearse | run" >&2
  exit 2
  ;;
esac
