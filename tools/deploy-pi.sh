#!/usr/bin/env bash
set -euo pipefail
umask 077

commit=${1:-}
project=${2:-sportboss}
root="$HOME/sportboss-deploy"
if [[ ! "$commit" =~ ^[0-9a-f]{40}$ || ! "$project" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then
  echo "Expected a Git commit SHA and a valid Compose project name." >&2
  exit 2
fi
if [[ ! -f "$root/.env" ]]; then
  echo "Set up $root/.env on the Pi before deploying SportBoss." >&2
  exit 2
fi

mkdir -p -- "$root/releases"
exec 9>"$root/deploy.lock"
flock -w 300 9

# Always use the same Compose project and environment, regardless of release path.
compose() {
  local directory=$1
  shift
  docker compose --project-name "$project" --env-file "$root/.env" -f "$directory/compose.yaml" "$@"
}

release=$(mktemp -d "$root/releases/$commit.XXXXXXXX")
trap 'rm -rf -- "$release"' EXIT
tar --extract --gzip --file=- --directory "$release" --no-same-owner --no-same-permissions

previous=$(readlink "$root/current" || true)
compose "$release" config --quiet
compose "$release" build app

if ! compose "$release" up -d --no-build --pull never --remove-orphans --wait --wait-timeout 120; then
  echo "Deployment did not pass its health checks." >&2
  if [[ -n "$previous" && -f "$previous/compose.yaml" ]]; then
    echo "Restoring the previous release." >&2
    if compose "$previous" build app &&
       compose "$previous" up -d --no-build --pull never --wait --wait-timeout 120; then
      echo "Previous release is healthy." >&2
    else
      echo "Rollback failed. Inspect Docker Compose on the Pi." >&2
    fi
  else
    echo "No previous automated release is available to restore." >&2
  fi
  exit 1
fi

trap - EXIT
ln -s -- "$release" "$release/current-link"
mv -Tf -- "$release/current-link" "$root/current"
echo "SportBoss deployed at $commit."
