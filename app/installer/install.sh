#!/bin/bash
# KB25 installer for macOS:
#
#   curl -fsSL https://github.com/elmir-mamedov/kb/releases/latest/download/install.sh | bash
#
# Fetches a private copy of Node.js and the latest KB25 release into
# ~/Library/Application Support/KB25, then hands over to installer/setup.mjs
# for the questions. Needs no admin password and touches nothing system-wide.
# Running it again updates KB25, or offers to remove it.
#
# For testing: KB25_HOME overrides the install folder, KB25_ZIP installs a
# local kb25.zip instead of the latest release, KB25_YES=1 takes every default.
set -euo pipefail

# Everything lives in a function called on the last line, so a download cut
# short can never run half a script.
main() {
  local node_version="24.15.0"
  local release="https://github.com/elmir-mamedov/kb/releases/latest/download/kb25.zip"
  local home="${KB25_HOME:-$HOME/Library/Application Support/KB25}"

  if [ "$(uname -s)" != "Darwin" ]; then
    echo "This installer is for macOS. On Windows, use the PowerShell line instead."
    exit 1
  fi
  local arch
  case "$(uname -m)" in
    arm64) arch="arm64" ;;
    x86_64) arch="x64" ;;
    *) echo "Unsupported Mac processor: $(uname -m)"; exit 1 ;;
  esac

  echo
  echo "KB25 installer"
  if [ -d "$home/app" ]; then
    ask "KB25 is already installed. Check for an update?" || exit 0
  else
    ask "This installs KB25 for you only. No admin password needed. Continue?" || exit 0
  fi
  mkdir -p "$home"

  # Global, not local: the EXIT trap runs after main has returned.
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT

  if [ "$(cat "$home/node/VERSION" 2>/dev/null || true)" != "$node_version" ]; then
    echo "Downloading Node.js, which only KB25 uses (about 25 MB, first time only)…"
    stop_server "$home" # it runs on the Node about to be replaced
    local name="node-v$node_version-darwin-$arch"
    curl -fL --progress-bar "https://nodejs.org/dist/v$node_version/$name.tar.xz" -o "$tmp/node.tar.xz"
    curl -fsSL "https://nodejs.org/dist/v$node_version/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
    local expected actual
    expected="$(awk -v f="$name.tar.xz" '$2 == f { print $1 }' "$tmp/SHASUMS256.txt")"
    actual="$(shasum -a 256 "$tmp/node.tar.xz" | awk '{ print $1 }')"
    if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
      echo "The Node.js download looks damaged. Please try again."
      exit 1
    fi
    tar -xf "$tmp/node.tar.xz" -C "$tmp"
    rm -rf "$home/node"
    mv "$tmp/$name" "$home/node"
    echo "$node_version" > "$home/node/VERSION"
  fi

  echo "Downloading KB25…"
  if [ -n "${KB25_ZIP:-}" ]; then
    cp "$KB25_ZIP" "$tmp/kb25.zip"
  else
    curl -fsSL "$release" -o "$tmp/kb25.zip"
  fi
  rm -rf "$home/app.new"
  mkdir -p "$home/app.new"
  unzip -q "$tmp/kb25.zip" -d "$home/app.new"

  # `curl | bash` feeds this script on stdin, so the questions read the keyboard.
  if [ -n "${KB25_YES:-}" ]; then
    "$home/node/bin/node" "$home/app.new/installer/setup.mjs"
  else
    "$home/node/bin/node" "$home/app.new/installer/setup.mjs" < /dev/tty
  fi
}

ask() {
  [ -n "${KB25_YES:-}" ] && return 0
  local reply
  printf '%s [Y/n] ' "$1" > /dev/tty
  read -r reply < /dev/tty || reply=""
  case "$reply" in [nN]*) return 1 ;; *) return 0 ;; esac
}

stop_server() {
  local pid_file="$1/server.pid"
  [ -f "$pid_file" ] && kill "$(cat "$pid_file")" 2>/dev/null || true
  rm -f "$pid_file"
}

main "$@"
