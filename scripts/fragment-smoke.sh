#!/bin/sh
# Runs compose.platform.yaml the way the platform does (ci/compose.stub.yaml) and checks it (REQ-014):
# the fragment keeps to its contract; the stack comes up and seeds; the headers, the pages and three
# browsers pass from a container sharing the storefront's network; the storefront is hardened and on
# `edge` only; its public files hold nothing of the API; with the backend slow or stopped the catalog
# answers a clean 503 while / and the health check stay up; a product name holding markup stays text;
# and a stop drains cleanly (REQ-015). Its own Compose project, always removed afterwards.
#   SKIP_BUILD=1  test the commerce-storefront:ci image already built (make fragment builds it first)
set -eu
cd "$(dirname "$0")/.."

project=commerce-storefront-smoke
dir=$(mktemp -d)
CI_SECRETS_DIR=$dir
export CI_SECRETS_DIR
compose() { docker compose -p "$project" -f ci/compose.stub.yaml -f ci/compose.browser.yaml "$@"; }
check() { compose run --rm --no-deps --quiet-pull browser "$@"; }
cleanup() {
  status=$?
  [ "$status" -eq 0 ] || compose logs --no-color >&2 || true
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  docker rm -f "$project-files" >/dev/null 2>&1 || true
  rm -rf "$dir"
  exit "$status"
}
trap cleanup EXIT INT TERM
fail() {
  echo "error: $*" >&2
  exit 1
}

# A throwaway password, readable by the non-root containers like the platform's secret file.
od -An -N16 -tx1 /dev/urandom | tr -d ' \n' >"$dir/postgres_password"
chmod 0644 "$dir/postgres_password"

if [ "${SKIP_BUILD:-}" != 1 ]; then
  sh ./scripts/image.sh build
fi

echo "fragment: the contract (no image, ports, networks, depends_on, build or host name)"
if grep -nE '^[[:space:]]*(image|ports|networks|depends_on|build|network_mode):' compose.platform.yaml; then
  fail "compose.platform.yaml must leave those to the platform's wiring"
fi
if grep -nE '(backend-api|postgres|valkey|rabbitmq|meilisearch|mailpit)([:/@]|$)' compose.platform.yaml; then
  fail "compose.platform.yaml names a host"
fi

echo "fragment: the backend's address is required"
# With the wiring's image and network, a missing variable is the only thing that can fail the config.
printf 'networks:\n  edge: {}\n' >"$dir/networks.yaml"
alone() { docker compose -f compose.platform.yaml -f ci/compose.wiring.yaml -f "$dir/networks.yaml" config "$@"; }
if (unset STOREFRONT_API_BASE_URL && alone --quiet) 2>"$dir/config.err"; then
  fail "compose.platform.yaml works without STOREFRONT_API_BASE_URL"
fi
grep -q STOREFRONT_API_BASE_URL "$dir/config.err" || { cat "$dir/config.err" >&2; exit 1; }

echo "fragment: the platform's rules for an application (one hardened storefront-web service)"
STOREFRONT_API_BASE_URL=http://example.invalid alone --format json >"$dir/fragment.json"
node scripts/check-repo.mjs fragment "$dir/fragment.json"

echo "fragment: up --wait and seed"
compose up --wait --quiet-pull
compose run --rm --no-deps backend-api seed >/dev/null

echo "fragment: headers, CSP and SRI"
check node scripts/check-headers.mjs http://localhost:3000

echo "fragment: the pages show the seeded catalog, and nothing of the API"
check node scripts/check-pages.mjs http://localhost:3000

echo "fragment: three browsers"
check node node_modules/@playwright/test/cli.js test

echo "fragment: hardening, and edge only"
id=$(compose ps -q storefront-web)
got=$(docker inspect -f '{{.Config.User}} ro={{.HostConfig.ReadonlyRootfs}} caps={{.HostConfig.CapDrop}} add={{.HostConfig.CapAdd}} init={{.HostConfig.Init}} priv={{.HostConfig.Privileged}} sec={{.HostConfig.SecurityOpt}}' "$id")
want='65532:65532 ro=true caps=[ALL] add=[] init=true priv=false sec=[no-new-privileges:true]'
[ "$got" = "$want" ] || fail "storefront-web: $got"
networks=$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}' "$id")
[ "$networks" = "${project}_edge " ] || fail "storefront-web is on: $networks"
[ "$(docker network inspect -f '{{.Internal}}' "${project}_edge")" = true ] || fail "edge isn't internal"
ports=$(docker inspect -f '{{json .NetworkSettings.Ports}}' "$id")
case $ports in *HostPort*) fail "storefront-web publishes a port: $ports" ;; esac

echo "fragment: the image's public files hold nothing of the API (REQ-010, REQ-022)"
image=$(docker inspect -f '{{.Config.Image}}' "$id")
docker create --name "$project-files" "$image" >/dev/null
docker cp "$project-files:/app/.output/public" "$dir/public"
if grep -rlE 'backend-api|:8080|/v1/products|openapi-fetch|createClient|apiBaseUrl' "$dir/public"; then
  fail "the browser's files hold the API's address or the SDK"
fi

echo "fragment: with the backend paused, the catalog gives up after 3 s with a 503"
compose pause backend-api >/dev/null
timing=$(check node --input-type=module -e '
  const start = performance.now();
  const r = await fetch("http://localhost:3000/products", { headers: { accept: "text/html" } });
  console.log(r.status, Math.round(performance.now() - start));')
compose unpause backend-api >/dev/null
set -- $timing
[ "$1" = 503 ] && [ "$2" -ge 2900 ] && [ "$2" -lt 5000 ] || fail "with the backend paused: status $1 after $2 ms"

echo "fragment: with the backend stopped, a clean 503 in under 5 s; / and the health check stay up"
since=$(date -u +%Y-%m-%dT%H:%M:%SZ)
compose stop backend-api >/dev/null 2>&1
check node scripts/check-headers.mjs http://localhost:3000 --unavailable
home=$(check node --input-type=module -e 'const r = await fetch("http://localhost:3000/"); console.log(r.status)')
[ "$home" = 200 ] || fail "/ answered $home with the backend stopped"
sleep 12 # more than one health-check interval, so at least one probe ran without the backend
health=$(docker inspect -f '{{.State.Health.Status}} {{.State.Health.FailingStreak}}' "$id")
[ "$health" = "healthy 0" ] || fail "storefront-web's health with the backend stopped: $health"
probes=$(docker inspect -f '{{range .State.Health.Log}}{{.Start.UTC.Format "2006-01-02T15:04:05Z"}} {{.ExitCode}}{{"\n"}}{{end}}' "$id" | awk -v since="$since" '$1 >= since')
[ -n "$probes" ] || fail "no health probe ran while the backend was stopped"
if printf '%s\n' "$probes" | awk '$2 != 0' | grep -q .; then fail "a health probe failed while the backend was stopped"; fi
compose up --wait --quiet-pull backend-api

echo "fragment: a product name holding markup stays text"
compose exec -T postgres psql -U commerce -d commerce -qc \
  "update products set name = '</script><script>alert(1)</script>' where slug = 'canvas-tote'"
check node scripts/check-pages.mjs http://localhost:3000 --hostile canvas-tote
compose run --rm --no-deps --quiet-pull -e HOSTILE_SLUG=canvas-tote browser \
  node node_modules/@playwright/test/cli.js test -g "holding markup"

echo "fragment: a stop drains and exits 0 in under 10 s"
start=$(date +%s)
compose stop storefront-web >/dev/null 2>&1
took=$(($(date +%s) - start))
code=$(docker inspect -f '{{.State.ExitCode}}' "$id")
[ "$code" = 0 ] || fail "storefront-web exited $code"
[ "$took" -lt 10 ] || fail "stopping took ${took}s"

echo "fragment: ok"
