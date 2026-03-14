#!/usr/bin/env bash
# Fetch or update the iTerm2-Color-Schemes upstream repo.
# Clones to .upstream/ (gitignored).
set -euo pipefail

REPO_URL="https://github.com/mbadolato/iTerm2-Color-Schemes.git"
DEST=".upstream/iTerm2-Color-Schemes"

if [ -d "$DEST/.git" ]; then
  echo "Updating $DEST ..."
  git -C "$DEST" pull --ff-only
else
  echo "Cloning $REPO_URL -> $DEST ..."
  mkdir -p "$(dirname "$DEST")"
  git clone --depth 1 "$REPO_URL" "$DEST"
fi

echo "Schemes directory: $DEST/schemes/"
ls "$DEST/schemes/" | wc -l | xargs printf "%s itermcolors files\n"
