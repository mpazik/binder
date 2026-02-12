#!/usr/bin/env bash
#
# Binder worktree manager
#
# Usage:
#   scripts/worktree.sh                                     # list worktrees
#   scripts/worktree.sh <name>                              # create worktree or no-op if exists
#   scripts/worktree.sh remove <name> [--force] [--branch]  # remove worktree (and branch with -b)
#   scripts/worktree.sh integrate [-s|-i] <name>            # merge into main + cleanup (-s squash, -i interactive rebase)
#

MAIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BINDER_DIR="$(dirname "$MAIN_DIR")"

# Sets: has_worktree, has_branch
check_worktree() {
  local name="$1"
  has_worktree=false
  has_branch=false
  [ -d "$BINDER_DIR/$name" ] && has_worktree=true
  git -C "$MAIN_DIR" show-ref --verify --quiet "refs/heads/$name" && has_branch=true
}

ws_create() {
  local name="$1"
  local worktree_dir="$BINDER_DIR/$name"

  check_worktree "$name"

  if $has_worktree; then
    echo "Worktree '$name' already exists at $worktree_dir"
    return 0
  fi

  if $has_branch; then
    echo "Branch '$name' exists, creating worktree..."
    git -C "$MAIN_DIR" worktree add "$worktree_dir" "$name"
  else
    echo "Creating branch '$name' from main and worktree..."
    git -C "$MAIN_DIR" worktree add -b "$name" "$worktree_dir" main
  fi

  echo "Running bun install..."
  (cd "$worktree_dir" && bun install --frozen-lockfile)
}

ws_remove() {
  local name=""
  local force=""
  local delete_branch=false

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --force|-f) force="--force"; shift ;;
      --branch|-b) delete_branch=true; shift ;;
      *) name="$1"; shift ;;
    esac
  done

  local worktree_dir="$BINDER_DIR/$name"

  check_worktree "$name"

  if ! $has_worktree; then
    echo "Error: worktree '$name' does not exist."
    return 1
  fi

  echo "Removing worktree '$name'..."
  git -C "$MAIN_DIR" worktree remove $force "$worktree_dir" || return 1

  if $delete_branch && $has_branch; then
    git -C "$MAIN_DIR" branch -D "$name"
    echo "Branch '$name' deleted."
  fi
}

ws_integrate() {
  local mode="ff"
  local name=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      -s) mode="squash"; shift ;;
      -i) mode="interactive"; shift ;;
      *)  name="$1"; shift ;;
    esac
  done

  if [ -z "$name" ]; then
    echo "Error: branch name required."
    return 1
  fi

  local worktree_dir="$BINDER_DIR/$name"

  check_worktree "$name"

  if ! $has_worktree; then
    echo "Error: worktree '$name' does not exist."
    return 1
  fi

  if ! $has_branch; then
    echo "Error: branch '$name' does not exist."
    return 1
  fi

  local commit_count
  commit_count=$(git -C "$MAIN_DIR" rev-list --count "main..$name")
  echo "Branch '$name' has $commit_count commit(s) ahead of main."

  if [ "$mode" = "interactive" ]; then
    echo "Opening interactive rebase..."
    git -C "$worktree_dir" rebase -i main
    if [ $? -ne 0 ]; then
      echo "Rebase in progress. Complete it, then run integrate again."
      return 1
    fi
  fi

  if [ "$mode" = "squash" ]; then
    if ! git -C "$MAIN_DIR" diff --quiet || ! git -C "$MAIN_DIR" diff --cached --quiet; then
      echo "Error: main worktree has uncommitted changes. Squash merge would include them."
      echo "Commit or stash them first."
      return 1
    fi
    echo "Squash-merging '$name' into main..."
    git -C "$MAIN_DIR" merge --squash "$name" || return 1
    git -C "$MAIN_DIR" commit
  else
    echo "Rebasing '$name' onto main..."
    git -C "$worktree_dir" rebase main
    if [ $? -ne 0 ]; then
      echo "Rebase failed. Resolve conflicts, then run integrate again."
      return 1
    fi

    echo "Merging '$name' into main..."
    git -C "$MAIN_DIR" merge --ff-only "$name"
  fi

  read -p "Remove worktree and branch '$name'? [y/N] " confirm
  if [[ "$confirm" =~ ^[Yy]$ ]]; then
    git -C "$MAIN_DIR" worktree remove "$worktree_dir"
    git -C "$MAIN_DIR" branch -D "$name"
    echo "Cleaned up '$name'."
  fi
}

# --- Main dispatch ---
case "$1" in
  "")        git -C "$MAIN_DIR" worktree list ;;
  remove)    shift; ws_remove "$@" ;;
  integrate) shift; ws_integrate "$@" ;;
  *)         ws_create "$1" ;;
esac
