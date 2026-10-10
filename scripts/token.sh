# Sourced by scripts/*.sh: exports NODE_AUTH_TOKEN, the read:packages token for GitHub Packages, from
# the environment (CI sets it from GITHUB_TOKEN) or from ~/.npmrc (README).
if [ -z "${NODE_AUTH_TOKEN:-}" ] && [ -f "$HOME/.npmrc" ]; then
  NODE_AUTH_TOKEN=$(sed -n 's#^//npm\.pkg\.github\.com/:_authToken=##p' "$HOME/.npmrc" | head -n 1)
  case $NODE_AUTH_TOKEN in '${'*) NODE_AUTH_TOKEN= ;; esac
fi
if [ -z "${NODE_AUTH_TOKEN:-}" ]; then
  echo "error: set NODE_AUTH_TOKEN, or put a read:packages token in ~/.npmrc (README)" >&2
  exit 1
fi
export NODE_AUTH_TOKEN
