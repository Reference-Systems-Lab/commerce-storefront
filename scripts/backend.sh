#!/bin/sh
# Runs Postgres and the backend v0.1.0 for development, seeded, with the API on 127.0.0.1:18080.
#   sh scripts/backend.sh up | down
set -eu
cd "$(dirname "$0")/.."

# A throwaway password, kept with the stack's data and readable by the non-root containers.
CI_SECRETS_DIR=$PWD/.data/stub
export CI_SECRETS_DIR
compose() { docker compose -f ci/compose.stub.yaml -f ci/compose.dev.yaml "$@"; }

case "${1:-}" in
up)
  mkdir -p "$CI_SECRETS_DIR"
  if [ ! -f "$CI_SECRETS_DIR/postgres_password" ]; then
    od -An -N16 -tx1 /dev/urandom | tr -d ' \n' >"$CI_SECRETS_DIR/postgres_password"
    chmod 0644 "$CI_SECRETS_DIR/postgres_password"
  fi
  compose up --wait --quiet-pull postgres backend-migrate backend-api
  compose run --rm --no-deps backend-api seed >/dev/null
  echo "backend: http://127.0.0.1:18080 (seeded). Run: NUXT_API_BASE_URL=http://127.0.0.1:18080 npm run dev"
  ;;
down)
  compose down -v --remove-orphans
  ;;
*)
  echo "usage: sh scripts/backend.sh up | down" >&2
  exit 2
  ;;
esac
