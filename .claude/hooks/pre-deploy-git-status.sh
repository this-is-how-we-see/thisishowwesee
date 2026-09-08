#!/usr/bin/env bash
# PreToolUse guard for production deploys.
#
# `npx vercel --prod` deploys the WORKING TREE, not a commit. A deploy therefore
# ships whatever happens to be sitting in the directory, including edits this
# session did not make. That has already bitten twice on 2026-09-08:
#
#   - Google Drive mirrors this folder and reverted private/budget.src.html
#     between the edit and the publish, so a stale document went out.
#   - A concurrent session's uncommitted change to PrivateDoc.astro rode along
#     with an unrelated deploy.
#
# Clean tree: allow, silently. Dirty tree: ask, and show exactly what is about
# to ship. This never blocks outright - it makes the contents of the deploy
# impossible to miss.
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-$PWD}" 2>/dev/null || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

status=$(git status --porcelain 2>/dev/null)
[ -z "$status" ] && exit 0

reason="This deploy ships the WORKING TREE, not a commit. Uncommitted changes:

${status}"

ahead=$(git log --oneline '@{u}..HEAD' 2>/dev/null)
if [ -n "$ahead" ]; then
  reason="${reason}

Commits not yet pushed:
${ahead}"
fi

reason="${reason}

Check that every change above is meant to go to production. Anything you did
not make yourself came from somewhere else - another session, or Drive sync."

jq -n --arg r "$reason" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "ask",
    permissionDecisionReason: $r
  }
}'
