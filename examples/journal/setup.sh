#!/usr/bin/env bash

# ─── Helpers ─────────────────────────────────────────────────────────

bold='\033[1m'
dim='\033[2m'
green='\033[0;32m'
yellow='\033[0;33m'
red='\033[0;31m'
reset='\033[0m'

ok()   { printf "${green}✔${reset} %s\n" "$*"; }
warn() { printf "${yellow}!${reset} %s\n" "$*"; }
err()  { printf "${red}✖${reset} %s\n" "$*" >&2; }

ask() {
  local prompt="$1" default="${2:-}"
  if [[ -n "$default" ]]; then
    printf "${bold}%s${reset} ${dim}[%s]${reset}: " "$prompt" "$default"
  else
    printf "${bold}%s${reset}: " "$prompt"
  fi
  read -r reply
  echo "${reply:-$default}"
}

confirm() {
  local prompt="$1" default="${2:-y}"
  local hint="Y/n"; [[ "$default" == "n" ]] && hint="y/N"
  printf "${bold}%s${reset} ${dim}[%s]${reset}: " "$prompt" "$hint"
  read -r reply
  reply="${reply:-$default}"
  [[ "${reply,,}" == "y" || "${reply,,}" == "yes" ]]
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
declare -A EXPORTS=()

# ─── Check binder ───────────────────────────────────────────────────

echo ""
if ! command -v binder &>/dev/null; then
  err "binder not found on PATH."
  echo "  See: https://github.com/..."
  exit 1
fi
ok "binder found"

# ─── JOURNAL_DIR ─────────────────────────────────────────────────────

current_dir="${JOURNAL_DIR:-}"
if [[ -n "$current_dir" ]]; then
  warn "JOURNAL_DIR already set to: $current_dir"
  if ! confirm "Keep this value?"; then
    current_dir="$(ask "Journal directory" "$HOME/journal")"
  fi
else
  current_dir="$(ask "Journal directory" "$HOME/journal")"
fi

# Expand ~ and resolve
current_dir="${current_dir/#\~/$HOME}"
if [[ -d "$(dirname "$current_dir")" ]]; then
  current_dir="$(cd "$(dirname "$current_dir")" && pwd)/$(basename "$current_dir")"
fi
JOURNAL_DIR="$current_dir"

[[ -d "$JOURNAL_DIR" ]] || mkdir -p "$JOURNAL_DIR"
ok "JOURNAL_DIR: $JOURNAL_DIR"
EXPORTS[JOURNAL_DIR]="$JOURNAL_DIR"

# ─── Init binder workspace ──────────────────────────────────────────

if [[ ! -d "$JOURNAL_DIR/.binder" ]]; then
  (cd "$JOURNAL_DIR" && binder init --quiet)
  ok "Initialized binder workspace"
fi

# Copy schema if missing
if [[ ! -f "$JOURNAL_DIR/journal.yaml" && -f "$SCRIPT_DIR/journal.yaml" ]]; then
  cp "$SCRIPT_DIR/journal.yaml" "$JOURNAL_DIR/journal.yaml"
  ok "Copied journal.yaml schema"
fi

# ─── EDITOR ──────────────────────────────────────────────────────────

# GUI editors need workspace path; terminal editors use cwd
editor_cmd_for() {
  case "$1" in
    code|codium|cursor) echo "$1 \$JOURNAL_DIR -g" ;;
    zed)                echo "$1 \$JOURNAL_DIR" ;;
    *)                  echo "$1" ;;
  esac
}

detect_editor() {
  for e in code cursor zed nvim vim nano; do
    command -v "$e" &>/dev/null && echo "$e" && return
  done
}

current_editor="${EDITOR:-}"
if [[ -n "$current_editor" ]]; then
  warn "EDITOR already set to: $current_editor"
  if confirm "Keep this value?"; then
    EDITOR_RESULT="$current_editor"
  fi
fi

if [[ -z "${EDITOR_RESULT:-}" ]]; then
  detected="$(detect_editor)"
  EDITOR_RESULT="$(ask "Editor" "${detected:-vim}")"
  # Add workspace flags for bare editor names
  [[ "$EDITOR_RESULT" != *" "* ]] && EDITOR_RESULT="$(editor_cmd_for "$EDITOR_RESULT")"
  EXPORTS[EDITOR]="$EDITOR_RESULT"
fi
ok "EDITOR: $EDITOR_RESULT"

# ─── Write shell profile ────────────────────────────────────────────

detect_profile() {
  case "$(basename "${SHELL:-/bin/bash}")" in
    zsh)  echo "${ZDOTDIR:-$HOME}/.zshrc" ;;
    bash)
      if [[ -f "$HOME/.bash_profile" && "$(uname)" == "Darwin" ]]; then
        echo "$HOME/.bash_profile"
      else
        echo "$HOME/.bashrc"
      fi ;;
    fish) echo "$HOME/.config/fish/config.fish" ;;
    *)    echo "$HOME/.profile" ;;
  esac
}

if [[ ${#EXPORTS[@]} -gt 0 ]]; then
  PROFILE="$(detect_profile)"
  echo ""
  BLOCK=$'\n'"# ─── Journal (added by setup.sh) ───"$'\n'
  for key in "${!EXPORTS[@]}"; do
    line="export ${key}=\"${EXPORTS[$key]}\""
    printf "  ${dim}%s${reset}\n" "$line"
    BLOCK+="$line"$'\n'
  done

  echo ""
  if confirm "Append to $PROFILE?"; then
    echo "$BLOCK" >> "$PROFILE"
    ok "Written to $PROFILE"
    warn "Run: source $PROFILE"
  else
    warn "Add these manually:"; echo "$BLOCK"
  fi
fi

# ─── Done ────────────────────────────────────────────────────────────

echo ""
printf "${green}${bold}Setup complete!${reset}\n\n"
printf "  journal           ${dim}# today${reset}\n"
printf "  journal w         ${dim}# this week${reset}\n"
printf "  journal w prev    ${dim}# last week${reset}\n"
printf "  journal m next    ${dim}# next month${reset}\n"
echo ""
