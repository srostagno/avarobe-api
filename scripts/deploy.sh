#!/usr/bin/env bash
# Deploys a commit of main on the EC2 box and rolls back when the API doesn't
# come back healthy on it.
#
# GitHub Actions runs it over SSH with a key that may only run this script
# (`command="…/scripts/deploy.sh"` in ~/.ssh/authorized_keys) and asks for
# "deploy <sha>". By hand, on the server: ~/avarobe-api/scripts/deploy.sh [sha]
# (no sha: the tip of origin/main).
#
# Everything runs inside main(), so a `git merge` that rewrites this file
# mid-run can't change what bash executes.

main() {
  set -uo pipefail

  local dir="$HOME/avarobe-api"
  local health='http://127.0.0.1:4100/api/v1/health'

  # Non-interactive SSH doesn't load the login shell's PATH (nvm, corepack).
  export NVM_DIR="$HOME/.nvm"
  # shellcheck disable=SC1091
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  export PATH="$HOME/.local/bin:/usr/local/bin:$PATH"

  local want=''
  if [ -n "${SSH_ORIGINAL_COMMAND:-}" ]; then
    # shellcheck disable=SC2086
    set -- $SSH_ORIGINAL_COMMAND
    [ "${1:-}" = 'deploy' ] || { echo 'only "deploy <sha>" is allowed'; return 2; }
    want="${2:-}"
  else
    want="${1:-}"
  fi

  if [ -n "$want" ] && ! [[ "$want" =~ ^[0-9a-f]{7,40}$ ]]; then
    echo "not a commit: $want"
    return 2
  fi

  for bin in git node corepack pm2 curl flock; do
    command -v "$bin" >/dev/null || { echo "missing $bin on PATH"; return 1; }
  done

  cd "$dir" || return 1

  exec 9>/tmp/avarobe-api-deploy.lock
  flock -n 9 || { echo 'another deploy is running'; return 1; }

  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo 'the server has uncommitted changes to tracked files; deploy by hand'
    return 1
  fi

  git fetch --quiet origin main || { echo 'git fetch failed'; return 1; }

  local prev target short
  prev="$(git rev-parse HEAD)"
  target="$(git rev-parse --verify --quiet "${want:-origin/main}^{commit}")" || { echo "unknown commit: $want"; return 1; }
  short="$(git rev-parse --short=7 "$target")"

  if ! git merge-base --is-ancestor "$target" origin/main; then
    echo "$short is not on main"
    return 1
  fi

  if [ "$target" != "$prev" ] && git merge-base --is-ancestor "$target" "$prev"; then
    echo "already running $(git rev-parse --short=7 "$prev"), which is newer than $short"
    return 0
  fi

  echo "deploying $short (was $(git rev-parse --short=7 "$prev"))"

  build_and_restart() {
    corepack pnpm install --silent && corepack pnpm build && pm2 restart avarobe-api --update-env >/dev/null
  }

  healthy_on() {
    local i
    for i in $(seq 1 30); do
      sleep 2
      if curl -fsS --max-time 5 "$health" 2>/dev/null | grep -q "\"commit\":\"$1\""; then
        return 0
      fi
    done
    return 1
  }

  if git checkout --quiet main && git merge --ff-only --quiet "$target" && build_and_restart && healthy_on "$short"; then
    echo "live: $short"
    return 0
  fi

  echo "deploy of $short failed; rolling back to $(git rev-parse --short=7 "$prev")"
  git reset --hard --quiet "$prev"
  if build_and_restart && healthy_on "$(git rev-parse --short=7 "$prev")"; then
    echo 'rolled back'
  else
    echo 'ROLLBACK FAILED: check pm2 logs avarobe-api'
  fi
  return 1
}

main "$@"
exit $?
