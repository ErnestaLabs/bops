#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT/deploy/customer-stack/versions.env"
TARGET="${WORKFORCE_VENDOR_DIR:-$ROOT/.runtime-src}"
mkdir -p "$TARGET"
need(){ command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1" >&2; exit 2; }; }
need git
need docker
docker compose version >/dev/null
clone_pin(){
  local name="$1" url="$2" ref="$3" sha="$4" dest="$TARGET/$1"
  if [[ ! -d "$dest/.git" ]]; then
    git clone --filter=blob:none "$url" "$dest"
  fi
  git -C "$dest" fetch --tags --prune origin
  git -C "$dest" checkout --detach "$ref"
  local actual
  actual="$(git -C "$dest" rev-parse HEAD)"
  [[ "$actual" == "$sha" ]] || { echo "$name revision mismatch: expected $sha got $actual" >&2; exit 3; }
  echo "$name -> $actual"
}
clone_pin trigger https://github.com/triggerdotdev/trigger.dev.git "$TRIGGER_REF" "$TRIGGER_SHA"
clone_pin skyvern https://github.com/Skyvern-AI/skyvern.git "$SKYVERN_REF" "$SKYVERN_SHA"
clone_pin harness2 https://github.com/google-research/harness2.git "$HARNESS2_REF" "$HARNESS2_SHA"
echo "Building customer-owned Bops worker..."
docker build -f "$ROOT/private-runtime/worker/Dockerfile" -t ernesta-bops-worker:private "$ROOT"
echo "Building Harness² improvement image..."
docker build --build-arg HARNESS2_REF="$HARNESS2_REF" -f "$ROOT/integrations/harness2/Dockerfile" -t ernesta-harness2:0.1.0 "$ROOT/integrations/harness2"
mkdir -p "$ROOT/.data/private-runtime" "$ROOT/.data/workforce"
chmod 700 "$ROOT/.data/private-runtime" "$ROOT/.data/workforce"
if [[ ! -f "$ROOT/.env.private" ]]; then
  cp "$ROOT/private-runtime/private.env.example" "$ROOT/.env.private"
  chmod 600 "$ROOT/.env.private"
  echo "Created .env.private from template. Fill hosted model settings on this server."
fi
cat <<EOF

Prepared source/runtime layer:
  Bops:      $ROOT
  Trigger:   $TARGET/trigger
  Skyvern:   $TARGET/skyvern
  Harness²:  $TARGET/harness2

Nothing external was launched and no provider credentials were generated.
Next:
  1. Fill $ROOT/.env.private.
  2. Configure the pinned self-hosted Trigger and Skyvern instances in their own env files.
  3. Run: npm run private:check -- --live
  4. Start Bops only after the chosen hosted model passes.
  5. Enable Trigger schedules only after disabling the equivalent Bops routine.
  6. Keep Harness² offline; adopt candidate harnesses only after CI/review.

Read deploy/customer-stack/README.md.
EOF
