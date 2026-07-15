#!/usr/bin/env bash
#
# iOpenWRT control menu — build, test, run, release.
#
# Everything the release path needs, in one place, with the sharp edges guarded:
#   - Running locally defaults to a throwaway DB and NO router SSH. The unguarded option exists,
#     but it is a live-fire action against real hardware and says so.
#   - "Deploy" pushes BEFORE dispatching CI, because CI builds origin/main, not your worktree.
#   - "Verify" reads the published image's git SHA label, because a green CI run does not mean
#     anything was published (a skipped build job still reports success).
#
# Usage: ./menu.sh
set -uo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR" || exit 1

OPS_REPO="amstel85/iOpenWRT-Ops"          # private repo holding the build workflow
WORKFLOW="docker-publish.yml"
IMAGE_REPO="amstel/iopenwrt"              # Docker Hub
TEMPLATE_REPO="amstel85/unraid-templates" # where the Unraid template is published from
DEV_PORT=8791

B=$'\e[1m'; DIM=$'\e[2m'; R=$'\e[31m'; G=$'\e[32m'; Y=$'\e[33m'; C=$'\e[36m'; N=$'\e[0m'

say()  { printf '%s\n' "$*"; }
ok()   { printf '%s✓%s %s\n' "$G" "$N" "$*"; }
warn() { printf '%s!%s %s\n' "$Y" "$N" "$*"; }
err()  { printf '%s✗%s %s\n' "$R" "$N" "$*"; }
hr()   { printf '%s────────────────────────────────────────────────────────%s\n' "$DIM" "$N"; }
pause(){ printf '\n%sPress Enter to continue…%s' "$DIM" "$N"; read -r _; }

confirm() { # confirm "question" -> 0 if user typed yes
    local reply
    printf '%s%s%s [y/N] ' "$Y" "$1" "$N"
    read -r reply
    [[ "$reply" =~ ^([yY]|yes|YES)$ ]]
}

need() { command -v "$1" >/dev/null 2>&1 || { err "'$1' is not installed."; return 1; }; }

# --- Read the git SHA baked into the published image -------------------------------------------
# The workflow labels each image with org.opencontainers.image.revision. `docker buildx imagetools`
# would read it, but buildx isn't installed here, so go at the registry directly.
published_sha() {
    local token manifest config
    token=$(curl -fsS "https://auth.docker.io/token?service=registry.docker.io&scope=repository:${IMAGE_REPO}:pull" \
        | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])' 2>/dev/null) || return 1
    manifest=$(curl -fsS -H "Authorization: Bearer $token" \
        -H "Accept: application/vnd.oci.image.index.v1+json" \
        -H "Accept: application/vnd.docker.distribution.manifest.list.v2+json" \
        "https://registry-1.docker.io/v2/${IMAGE_REPO}/manifests/latest" \
        | python3 -c '
import sys, json
d = json.load(sys.stdin)
ms = d.get("manifests")
if not ms:
    print(""); raise SystemExit
amd = [m for m in ms if m.get("platform", {}).get("architecture") == "amd64"]
print((amd or ms)[0]["digest"])' 2>/dev/null) || return 1
    [ -n "$manifest" ] || return 1
    config=$(curl -fsS -H "Authorization: Bearer $token" \
        -H "Accept: application/vnd.oci.image.manifest.v1+json" \
        -H "Accept: application/vnd.docker.distribution.manifest.v2+json" \
        "https://registry-1.docker.io/v2/${IMAGE_REPO}/manifests/${manifest}" \
        | python3 -c 'import sys,json;print(json.load(sys.stdin)["config"]["digest"])' 2>/dev/null) || return 1
    # -L is required: the blob 307-redirects to a CDN.
    curl -fsSL -H "Authorization: Bearer $token" \
        "https://registry-1.docker.io/v2/${IMAGE_REPO}/blobs/${config}" \
        | python3 -c '
import sys, json
d = json.load(sys.stdin)
print(d.get("config", {}).get("Labels", {}).get("org.opencontainers.image.revision", ""))' 2>/dev/null
}

# --- Menu actions ------------------------------------------------------------------------------

run_tests() {
    hr; say "${B}Running checks${N}"; hr
    local failed=0

    say "\n${C}Backend syntax${N}"
    local f
    for f in server.js $(find src -name '*.js' 2>/dev/null); do
        node --check "$f" 2>&1 | head -3 || { err "syntax: $f"; failed=1; }
    done
    [ $failed -eq 0 ] && ok "all backend files parse"

    say "\n${C}Frontend build${N} ${DIM}(the real gate — catches missing imports)${N}"
    if (cd frontend && npm run build 2>&1 | tail -4); then ok "frontend builds"; else err "frontend build FAILED"; failed=1; fi

    say "\n${C}Lint${N} ${DIM}(informational — has pre-existing errors)${N}"
    (cd frontend && npm run lint 2>&1 | tail -3) || true

    say ""
    [ $failed -eq 0 ] && ok "Checks passed" || err "Something failed above — do not release."
    pause
}

build_frontend() {
    hr; say "${B}Building frontend${N}"; hr
    (cd frontend && npm run build) && ok "Built to frontend/dist" || err "Build failed"
    pause
}

run_local_safe() {
    hr; say "${B}Run locally — safe mode${N}"; hr
    say "Throwaway database, generated secrets, ${B}no SSH to your routers${N}, no subnet sweep."
    say ""
    [ -d frontend/dist ] || { warn "frontend/dist missing — building first…"; (cd frontend && npm run build) || { err "build failed"; pause; return; }; }

    local tmp; tmp="$(mktemp -d)"
    say "  DB      : $tmp/dev.db"
    say "  Secrets : $tmp/secrets.json"
    say "  URL     : ${C}http://localhost:${DEV_PORT}${N}"
    say "  Login   : dev / dev"
    say "\n${DIM}Ctrl-C to stop.${N}\n"

    DB_PATH="$tmp/dev.db" SECRET_PATH="$tmp/secrets.json" DISABLE_MONITOR=1 \
        PORT="$DEV_PORT" frontend_user=dev frontend_password=dev \
        node server.js

    rm -rf "$tmp"
    pause
}

run_local_real() {
    hr; say "${B}${R}Run locally against REAL routers${N}"; hr
    say "${R}This is a live-fire action.${N} Within a second of starting, it will:"
    say "  • SSH into every router in data/iopenwrt.db, and again every 30s"
    say "  • fork 254 concurrent pings across 10.0.0.0/24 — your actual LAN"
    say "  • run the credential-encryption migration against your real database"
    say ""
    confirm "Start it against real hardware?" || { say "Cancelled."; pause; return; }

    [ -d frontend/dist ] || (cd frontend && npm run build)
    if [ -f .env ]; then
        say "\n${C}http://localhost:$(grep -E '^PORT=' .env | cut -d= -f2 || echo 8780)${N}  ${DIM}(Ctrl-C to stop)${N}\n"
        node server.js
    else
        err "No .env file — copy .env.example and set frontend_user / frontend_password first."
    fi
    pause
}

show_changes() {
    hr; say "${B}Working tree${N}"; hr
    git status --short
    say ""
    git diff --stat HEAD 2>/dev/null | tail -20
    pause
}

commit_and_push() {
    hr; say "${B}Commit & push${N}"; hr
    if [ -z "$(git status --porcelain)" ]; then
        ok "Nothing to commit — working tree is clean."
        local ahead; ahead=$(git rev-list --count @{u}..HEAD 2>/dev/null || echo 0)
        [ "$ahead" -gt 0 ] && { warn "$ahead commit(s) not yet pushed."; confirm "Push them now?" && git push origin main; }
        pause; return
    fi

    git status --short
    say ""
    local msg
    printf 'Commit message: '
    read -r msg
    [ -z "$msg" ] && { warn "Empty message — cancelled."; pause; return; }

    git add -A && git commit -m "$msg" || { err "Commit failed"; pause; return; }
    ok "Committed."
    confirm "Push to origin/main?" && { git push origin main && ok "Pushed."; }
    pause
}

deploy() {
    hr; say "${B}Deploy${N}"; hr
    need gh || { pause; return; }

    if [ -n "$(git status --porcelain)" ]; then
        warn "You have uncommitted changes. CI builds origin/main — they would NOT be included."
        confirm "Continue anyway?" || { pause; return; }
    fi

    # CI reads origin/main via the GitHub API. Dispatching before the push lands builds the
    # PREVIOUS commit and still reports success.
    say "\n${C}1/3 Pushing to origin/main${N}"
    git push origin main || { err "Push failed — aborting."; pause; return; }
    ok "Pushed $(git rev-parse --short HEAD)"

    say "\n${C}2/3 Dispatching the build workflow${N} ${DIM}($OPS_REPO)${N}"
    local force=""
    confirm "Force a rebuild even if the SHA is unchanged?" && force="-f force_rebuild=true"
    # shellcheck disable=SC2086
    gh workflow run "$WORKFLOW" -R "$OPS_REPO" $force || { err "Dispatch failed"; pause; return; }
    ok "Dispatched."

    say "\n${C}3/3 Watching the run${N} ${DIM}(takes ~1-5 min)${N}"
    sleep 6
    local run_id
    run_id=$(gh run list -R "$OPS_REPO" -L 1 --json databaseId --jq '.[0].databaseId' 2>/dev/null)
    [ -n "$run_id" ] && gh run watch "$run_id" -R "$OPS_REPO" --exit-status
    say ""

    # A skipped build job still reports success, so the run's conclusion proves nothing.
    if [ -n "$run_id" ]; then
        say "${B}Jobs in this run:${N}"
        gh run view "$run_id" -R "$OPS_REPO" --json jobs \
            --jq '.jobs[] | "  \(.name): \(.conclusion)"' 2>/dev/null
        if gh run view "$run_id" -R "$OPS_REPO" --json jobs \
            --jq '.jobs[] | select(.name|test("build")) | .conclusion' 2>/dev/null | grep -q skipped; then
            warn "The build job was SKIPPED — nothing new was published."
            say "  ${DIM}The SHA already matched the published image. Re-run with force_rebuild.${N}"
        fi
    fi

    say ""
    verify_published inline
    say ""
    say "${B}Last step is manual:${N} Unraid → Docker → ${C}Check for Updates${N} → ${C}Update${N}"
    say "${DIM}Not automatic unless the Community Applications 'Auto Update Applications' plugin is enabled.${N}"
    pause
}

verify_published() {
    [ "${1:-}" != "inline" ] && { hr; say "${B}Verify published image${N}"; hr; }
    say "Reading the git SHA baked into ${IMAGE_REPO}:latest…"
    local pub head
    pub=$(published_sha) || { err "Could not read the image label from the registry."; [ "${1:-}" != "inline" ] && pause; return; }
    head=$(git rev-parse HEAD)

    say "  published : ${pub:0:12}"
    say "  local HEAD: ${head:0:12}"
    if [ "$pub" = "$head" ]; then
        ok "Image matches HEAD — the release is published."
    else
        warn "Image does NOT match HEAD — your latest commit is not published yet."
    fi
    [ "${1:-}" != "inline" ] && pause
}

show_ci() {
    hr; say "${B}Recent CI runs${N} ${DIM}($OPS_REPO)${N}"; hr
    need gh || { pause; return; }
    gh run list -R "$OPS_REPO" -L 8 \
        --json databaseId,conclusion,event,createdAt,displayTitle \
        --jq '.[] | "  \(.createdAt[0:16])  \(.conclusion // "running")  \(.event)  #\(.databaseId)"' 2>/dev/null
    say ""
    say "${DIM}Remember: a green run with a skipped build job published nothing.${N}"
    pause
}

sync_template() {
    hr; say "${B}Unraid template${N}"; hr
    need gh || { pause; return; }
    say "Users install from ${C}${TEMPLATE_REPO}${N}, not from this repo."
    say "The local copy at unraid/iopenwrt.xml changes nothing on its own."
    say ""
    local tmp; tmp="$(mktemp)"
    if gh api "repos/${TEMPLATE_REPO}/contents/iopenwrt.xml" --jq '.content' 2>/dev/null | base64 -d > "$tmp"; then
        if diff -q unraid/iopenwrt.xml "$tmp" >/dev/null 2>&1; then
            ok "Local template is identical to the published one."
        else
            warn "Local template DIFFERS from the published one:"
            diff "$tmp" unraid/iopenwrt.xml | head -20
            say ""
            say "${DIM}To publish, commit unraid/iopenwrt.xml to ${TEMPLATE_REPO}.${N}"
        fi
    else
        err "Could not fetch the published template."
    fi
    rm -f "$tmp"
    pause
}

unraid_help() {
    hr; say "${B}How updating actually works${N}"; hr
    cat <<EOF

  Nothing in this chain is automatic.

    your worktree
         │  git push            (menu: 6 or 7)
         ▼
    github.com/amstel85/iOpenWrt (main)
         │  manual workflow dispatch   ← the nightly cron was removed 2026-04-29
         ▼
    ${IMAGE_REPO}:latest on Docker Hub
         │  manual: Unraid → Docker → Check for Updates → Update
         ▼
    running container

  Traps:
    • git push alone changes nothing on Unraid.
    • A green CI run can mean "skipped, published nothing". Check the JOBS.
    • Dispatching before your push lands builds the previous commit — and reports success.
    • Only ':latest' exists; Unraid compares image digests, so that is the only signal.
    • Unraid updates itself only with the CA 'Auto Update Applications' plugin enabled.

  Your data (device list, credentials, secrets) lives in the mapped volume
  /mnt/user/appdata/iOpenWRT/data and survives updates.

  ${Y}Back up data/.secrets.json together with iopenwrt.db.${N}
  It holds the key that decrypts your routers' SSH credentials. A database restored
  without it leaves them unreadable and you must re-enter them.

EOF
    pause
}

status_line() {
    local branch dirty ahead
    branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
    dirty=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
    ahead=$(git rev-list --count '@{u}..HEAD' 2>/dev/null || echo 0)

    printf '  %sbranch%s %s' "$DIM" "$N" "$branch"
    [ "$dirty" -gt 0 ] && printf '  %s·%s %s%s uncommitted%s' "$DIM" "$N" "$Y" "$dirty" "$N" \
                       || printf '  %s·%s %sclean%s' "$DIM" "$N" "$G" "$N"
    [ "$ahead" -gt 0 ] && printf '  %s·%s %s%s unpushed%s' "$DIM" "$N" "$Y" "$ahead" "$N"
    printf '\n'
}

menu() {
    while true; do
        clear
        printf '%s╔══════════════════════════════════════════════════════╗%s\n' "$C" "$N"
        printf '%s║%s            %siOpenWRT — control menu%s                   %s║%s\n' "$C" "$N" "$B" "$N" "$C" "$N"
        printf '%s╚══════════════════════════════════════════════════════╝%s\n' "$C" "$N"
        status_line
        say ""
        say "  ${B}LOCAL${N}"
        say "   1) Run checks (syntax · build · lint)"
        say "   2) Build frontend"
        say "   3) Run locally          ${DIM}safe: temp DB, no router SSH${N}"
        say "   4) Run against routers  ${R}live fire${N}"
        say ""
        say "  ${B}GIT${N}"
        say "   5) Show changes"
        say "   6) Commit & push"
        say ""
        say "  ${B}RELEASE${N}"
        say "   7) Deploy               ${DIM}push → build image → watch → verify${N}"
        say "   8) Verify published image matches HEAD"
        say "   9) Show recent CI runs"
        say ""
        say "  ${B}UNRAID${N}"
        say "  10) How updating works"
        say "  11) Check the Unraid template"
        say ""
        say "   q) Quit"
        say ""
        printf '  Choose: '
        read -r choice
        case "$choice" in
            1) run_tests ;;
            2) build_frontend ;;
            3) run_local_safe ;;
            4) run_local_real ;;
            5) show_changes ;;
            6) commit_and_push ;;
            7) deploy ;;
            8) verify_published ;;
            9) show_ci ;;
            10) unraid_help ;;
            11) sync_template ;;
            q|Q) say "Bye."; exit 0 ;;
            *) ;;
        esac
    done
}

menu
