#!/usr/bin/env bash
set -euo pipefail
umask 077

commit=${1:-}
project=${2:-sportboss}
checkout="$HOME/apps/SportBoss"
export GIT_TERMINAL_PROMPT=0
if [[ ! "$commit" =~ ^[0-9a-f]{40}$ || ! "$project" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then
  echo "Expected a Git commit SHA and a valid Compose project name." >&2
  exit 2
fi
if [[ -n "${3:-}" ]]; then
  checkout=$(printf '%s' "$3" | base64 -d)
fi
if [[ "$checkout" != /* || ! -d "$checkout" ]]; then
  echo "Set SPORTBOSS_PI_REPO_PATH to the absolute path of your SportBoss clone on the Pi." >&2
  exit 2
fi
cd -- "$checkout"
if [[ "$(git rev-parse --is-inside-work-tree 2>/dev/null || true)" != true || -n "$(git rev-parse --show-prefix)" ]]; then
  echo "The deployment path must be the root of a Git checkout: $checkout" >&2
  exit 2
fi
if [[ ! -f .env ]]; then
  echo "Create .env in the SportBoss checkout on the Pi: $checkout" >&2
  exit 2
fi

exec 9>"$(git rev-parse --git-path sportboss-deploy.lock)"
flock -w 300 9

if [[ "$(git branch --show-current)" != main || -n "$(git status --porcelain)" ]]; then
  echo "Use a clean main branch in $checkout before deploying. Local changes were preserved." >&2
  exit 1
fi

if ! git fetch --no-tags origin refs/heads/main; then
  echo "The Pi could not fetch origin/main without prompting. Check its GitHub read credentials." >&2
  exit 1
fi
if [[ "$(git rev-parse FETCH_HEAD)" != "$commit" ]]; then
  echo "origin/main has changed since this commit was tested. Skipping deployment."
  exit 0
fi
if git cat-file -e "$commit:.env" 2>/dev/null; then
  echo "The tested commit tracks .env. Keep the Pi's .env local." >&2
  exit 1
fi

previous=$(git rev-parse HEAD)
if ! git merge-base --is-ancestor "$previous" "$commit"; then
  echo "The Pi's main branch cannot fast-forward to the tested commit. Local commits were preserved." >&2
  exit 1
fi
git merge --ff-only --no-overwrite-ignore "$commit"

compose=(docker compose --project-name "$project" --env-file .env -f compose.yaml)
if ! "${compose[@]}" config --quiet || ! "${compose[@]}" build app; then
  echo "The new revision could not be built. Restoring the previous checkout." >&2
  git reset --keep "$previous"
  exit 1
fi
up=(-d --no-build --pull never --remove-orphans --wait --wait-timeout 120)
if ! "${compose[@]}" up "${up[@]}"; then
  echo "Deployment did not pass its health checks." >&2
  if [[ "$previous" == "$commit" ]]; then
    echo "The checkout was already at the tested commit. Inspect Docker Compose on the Pi." >&2
  elif git reset --keep "$previous" && "${compose[@]}" build app && "${compose[@]}" up "${up[@]}"; then
    echo "Previous revision is healthy." >&2
  else
    echo "Rollback failed. Inspect Git and Docker Compose on the Pi." >&2
  fi
  exit 1
fi

echo "SportBoss deployed at $commit in $checkout."
