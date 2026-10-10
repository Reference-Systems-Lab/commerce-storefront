#!/bin/sh
# Runs compose.platform.yaml the way the platform does (ci/compose.stub.yaml) and checks it (REQ-014):
# the stack comes up and seeds; the headers and the browser check pass from a container sharing the
# storefront's network; the storefront is hardened and on `edge` only; the fragment keeps to its
# contract; with the backend stopped the catalog answers 503 while / and the health check stay up; and
# a stop drains cleanly (REQ-015). Always removes the stack.
#   SKIP_BUILD=1  test the commerce-storefront:ci image already built (make fragment builds it first)
set -eu
cd "$(dirname "$0")/.."

dir=$(mktemp -d)
CI_SECRETS_DIR=$dir
export CI_SECRETS_DIR
compose() { docker compose -f ci/compose.stub.yaml -f ci/compose.browser.yaml "$@"; }
check() { compose run --rm --no-deps --quiet-pull browser "$@"; }
cleanup() {
  status=$?
  [ "$status" -eq 0 ] || compose logs --no-color >&2 || true
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$dir"
  exit "$status"
}
trap cleanup EXIT INT TERM

# A throwaway password, readable by the non-root containers like the platform's secret file.
od -An -N16 -tx1 /dev/urandom | tr -d ' \n' >"$dir/postgres_password"
chmod 0644 "$dir/postgres_password"

if [ "${SKIP_BUILD:-}" != 1 ]; then
  sh ./scripts/image.sh build
fi

echo "fragment: the contract (no image, ports, networks, depends_on, build or host name)"
if grep -nE '^[[:space:]]*(image|ports|networks|depends_on|build|network_mode):' compose.platform.yaml; then
  echo "error: compose.platform.yaml must leave those to the platform's wiring" >&2
  exit 1
fi
if grep -nE '(backend-api|postgres|valkey|rabbitmq|meilisearch|mailpit)([:/@]|$)' compose.platform.yaml; then
  echo "error: compose.platform.yaml names a host" >&2
  exit 1
fi

echo "fragment: the backend's address is required"
# With the wiring's image and network, a missing variable is the only thing that can fail the config.
printf 'networks:\n  edge: {}\n' >"$dir/networks.yaml"
alone() { docker compose -f compose.platform.yaml -f ci/compose.wiring.yaml -f "$dir/networks.yaml" config --quiet; }
if (unset STOREFRONT_API_BASE_URL && alone) 2>"$dir/config.err"; then
  echo "error: compose.platform.yaml works without STOREFRONT_API_BASE_URL" >&2
  exit 1
fi
grep -q STOREFRONT_API_BASE_URL "$dir/config.err" || { cat "$dir/config.err" >&2; exit 1; }
STOREFRONT_API_BASE_URL=http://example.invalid alone

echo "fragment: up --wait and seed"
compose up --wait --quiet-pull
compose run --rm --no-deps backend-api seed >/dev/null

echo "fragment: headers, CSP and SRI"
check node scripts/check-headers.mjs http://localhost:3000

echo "fragment: three browsers"
check node node_modules/@playwright/test/cli.js test

echo "fragment: hardening, and edge only"
id=$(compose ps -q storefront-web)
got=$(docker inspect -f '{{.Config.User}} ro={{.HostConfig.ReadonlyRootfs}} caps={{.HostConfig.CapDrop}} add={{.HostConfig.CapAdd}} init={{.HostConfig.Init}} priv={{.HostConfig.Privileged}} sec={{.HostConfig.SecurityOpt}}' "$id")
want='65532:65532 ro=true caps=[ALL] add=[] init=true priv=false sec=[no-new-privileges:true]'
[ "$got" = "$want" ] || { echo "error: storefront-web: $got" >&2; exit 1; }
networks=$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}' "$id")
[ "$networks" = "commerce-storefront-ci_edge " ] || { echo "error: storefront-web is on: $networks" >&2; exit 1; }
[ "$(docker network inspect -f '{{.Internal}}' commerce-storefront-ci_edge)" = true ] || { echo "error: edge isn't internal" >&2; exit 1; }
ports=$(docker inspect -f '{{json .NetworkSettings.Ports}}' "$id")
case $ports in *HostPort*) echo "error: storefront-web publishes a port: $ports" >&2; exit 1 ;; esac

echo "fragment: with the backend stopped, 503 on the catalog; / and the health check stay up"
compose stop backend-api >/dev/null 2>&1
check node scripts/check-headers.mjs http://localhost:3000 --unavailable
home=$(check node --input-type=module -e 'const r = await fetch("http://localhost:3000/"); console.log(r.status)')
[ "$home" = 200 ] || { echo "error: / answered $home with the backend stopped" >&2; exit 1; }
sleep 12 # longer than one health-check interval
[ "$(docker inspect -f '{{.State.Health.Status}}' "$id")" = healthy ] || { echo "error: storefront-web turned unhealthy" >&2; exit 1; }
compose up --wait --quiet-pull backend-api

echo "fragment: a stop drains and exits 0 in under 10 s"
start=$(date +%s)
compose stop storefront-web >/dev/null 2>&1
took=$(($(date +%s) - start))
code=$(docker inspect -f '{{.State.ExitCode}}' "$id")
[ "$code" = 0 ] || { echo "error: storefront-web exited $code" >&2; exit 1; }
[ "$took" -lt 10 ] || { echo "error: stopping took ${took}s" >&2; exit 1; }

echo "fragment: ok"
