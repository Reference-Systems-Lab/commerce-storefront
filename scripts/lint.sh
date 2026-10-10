#!/bin/sh
# Static checks, the same locally (make lint) and in CI: the npm settings and package scripts, the
# Nuxt settings the ADR fixes, then ESLint and Prettier, vue-tsc, Knip and hadolint. Each check's
# output shows only when it fails.
set -eu
cd "$(dirname "$0")/.."

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
failures=0

# step <description> <command...>
step() {
  d=$1
  shift
  if "$@" >"$tmp/out" 2>&1; then
    printf 'ok    %s\n' "$d"
  else
    printf 'FAIL  %s\n' "$d"
    sed 's/^/        /' "$tmp/out"
    failures=$((failures + 1))
  fi
}

step ".npmrc holds the hardened settings and no token (DE-2)" node scripts/check-repo.mjs npmrc
step "no lifecycle or pre/post hook scripts" node scripts/check-repo.mjs scripts
step "allowScripts names every install script, each false" node scripts/check-repo.mjs allow-scripts
step "Nuxt settings: preset, compatibility, tokens first, route rules, no islands" node scripts/check-repo.mjs nuxt-config
step "ESLint and Prettier" npm run lint
step "vue-tsc" npm run typecheck
step "Knip" npm run knip
step "hadolint" env HOST_UID="$(id -u)" HOST_GID="$(id -g)" docker compose -f compose.tools.yaml run --rm --quiet-pull hadolint Dockerfile

if [ "$failures" -gt 0 ]; then
  printf '%s check(s) failed.\n' "$failures"
  exit 1
fi
