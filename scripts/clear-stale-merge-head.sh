#!/bin/sh
# Remove a MERGE_HEAD that no longer describes a real merge.
#
# `git status` reports "All conflicts fixed but you are still merging" purely because
# .git/MERGE_HEAD exists -- it never validates the contents. That one file is what pins VS Code's
# Commit button to "Continue", and clicking it errors because there is nothing left to conclude.
#
# Two ways it goes stale, both seen in this repo:
#   - 0 bytes / unparseable -- an interrupted writer (lint-staged restores a backup buffer of the
#     merge files around its stash; see gitWorkflow.js backupMergeStatus/restoreMergeStatus)
#   - a valid sha HEAD has ALREADY merged -- 2026-08-24: MERGE_HEAD reappeared 33s after the merge
#     commit was written, so git's own unlink had succeeded and something re-created it afterwards
#
# A genuine in-progress merge points at a commit that is NOT yet reachable from HEAD, so it is
# never touched here: git refuses to start a merge with an already-merged branch ("Already up to
# date"), which is what makes ancestry a sound staleness test.
set -e

git_dir=$(git rev-parse --git-dir 2>/dev/null) || exit 0
[ -f "$git_dir/MERGE_HEAD" ] || exit 0

if ! mh=$(git rev-parse --verify --quiet MERGE_HEAD) ||
  git merge-base --is-ancestor "$mh" HEAD 2>/dev/null; then
  rm -f "$git_dir/MERGE_HEAD" "$git_dir/MERGE_MODE" "$git_dir/MERGE_MSG"
  echo "git: removed a stale MERGE_HEAD (the merge was already committed)"
fi

exit 0
