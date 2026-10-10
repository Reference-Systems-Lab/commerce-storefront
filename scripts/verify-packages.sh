#!/bin/sh
# Verifies each of our packages in the lockfile (REQ-016; commerce#3 DE-10). The tarball npm installs
# must match the lockfile and the registry, and GitHub must attest that the publishing repository's own
# release workflow built it. Needs a read:packages token (scripts/token.sh) and gh signed in.
set -eu
cd "$(dirname "$0")/.."
# shellcheck source=scripts/token.sh
. ./scripts/token.sh

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

node -e '
  const { packages } = JSON.parse(require("fs").readFileSync("package-lock.json", "utf8"));
  for (const [path, p] of Object.entries(packages)) {
    const name = path.slice(path.lastIndexOf("node_modules/") + 13);
    if (path.startsWith("node_modules/") && name.startsWith("@reference-systems-lab/")) {
      console.log([name, p.version, p.resolved, p.integrity].join(" "));
    }
  }' >"$tmp/packages"
[ -s "$tmp/packages" ] || { echo "error: no @reference-systems-lab packages in package-lock.json" >&2; exit 1; }

while read -r name version resolved integrity; do
  case $name in
    @reference-systems-lab/commerce-api) repo=commerce-backend ;;
    *) repo=design-system ;;
  esac
  curl -fsSL -H "Authorization: Bearer $NODE_AUTH_TOKEN" -o "$tmp/package.tgz" "$resolved"
  got="sha512-$(openssl dgst -sha512 -binary "$tmp/package.tgz" | base64 | tr -d '\n')"
  [ "$got" = "$integrity" ] || { echo "error: $name@$version doesn't match the lockfile's integrity" >&2; exit 1; }
  registry=$(npm view "$name@$version" dist.integrity)
  [ "$registry" = "$integrity" ] || { echo "error: $name@$version doesn't match the registry's integrity" >&2; exit 1; }
  gh attestation verify "$tmp/package.tgz" --repo "Reference-Systems-Lab/$repo" \
    --signer-workflow "Reference-Systems-Lab/$repo/.github/workflows/release.yml" >/dev/null
  echo "packages: $name@$version matches the lockfile and the registry, attested by $repo's release"
done <"$tmp/packages"
