#!/usr/bin/env bash
# Push Hazel Core to your GitHub repo.
# Runs the commit (if any changes), sets the remote, and pushes.
#   Usage:  bash push.sh            (uses HTTPS, will prompt for your token/password)
#           bash push.sh <TOKEN>    (optional: embeds a personal access token)
#
# This script is meant to run on YOUR machine where you have GitHub credentials.

set -e
cd "$(dirname "$0")"

REPO="https://github.com/dhivyadharshan-eng/Hazel--core.git"
BRANCH="main"

# 1) Ensure we're on the main branch and have a commit
git branch -M "$BRANCH" 2>/dev/null || true

# 2) Commit anything not yet saved (with a timestamped message)
if [ -n "$(git status --porcelain)" ]; then
  echo "-> Staging and committing local changes..."
  git add -A
  git commit -m "update: $(date '+%Y-%m-%d %H:%M')" || echo "   (nothing new to commit)"
fi

# 3) Make sure the remote points at your repo
git remote remove origin 2>/dev/null || true
if [ -n "$1" ]; then
  git remote add origin "https://${1}@github.com/dhivyadharshan-eng/Hazel--core.git"
  echo "-> Using provided token (kept only in the remote URL, not committed)."
else
  git remote add origin "$REPO"
  echo "-> Using HTTPS; you'll be prompted for your GitHub username + Personal Access Token."
fi

# 4) Push
echo "-> Pushing to $BRANCH ..."
git push -u origin "$BRANCH" || {
  echo ""
  echo "PUSH FAILED. Common causes:"
  echo "  - GitHub asked for a password -> enter a Personal Access Token, not your account password."
  echo "  - If the repo was created with a README/.gitignore, run:  git pull --rebase origin $BRANCH  then retry."
  exit 1
}

echo ""
echo "✅ Pushed. View it at: https://github.com/dhivyadharshan-eng/Hazel--core"
