#!/bin/sh
# Installs Circuit on Linux and macOS, then starts a project:
#
#   curl -fsSL https://circuit.tako.id/install | sh
#
# It downloads the circuit binary for this system from Circuit's GitHub releases, checks it against the release's SHA256SUMS, puts it in
# ~/.circuit/bin, adds that folder to PATH, and runs `circuit setup`, which asks a few questions and writes the project.
#
# CIRCUIT_VERSION=1.0.0 installs that version instead of the newest. CIRCUIT_NO_SETUP=1 installs without starting a project.

set -eu

REPO="takodotid/circuit"
BIN_DIR="$HOME/.circuit/bin"

fail() {
    printf 'Circuit was not installed: %s\n' "$1" >&2
    exit 1
}

need() {
    command -v "$1" >/dev/null 2>&1 || fail "this needs $1, and it is not installed"
}

need curl
need uname

case "$(uname -s)" in
    Linux) os=linux ;;
    Darwin) os=darwin ;;
    *) fail "Circuit runs on Linux, macOS and Windows, not on $(uname -s). On Windows, run in PowerShell: irm https://circuit.tako.id/install.ps1 | iex" ;;
esac

case "$(uname -m)" in
    x86_64 | amd64) arch=x64 ;;
    arm64 | aarch64) arch=arm64 ;;
    *) fail "Circuit is not built for $(uname -m) processors" ;;
esac

# A shell on Apple silicon that runs under Rosetta says x86_64; the native build is faster.
if [ "$os" = darwin ] && [ "$arch" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || true)" = 1 ]; then
    arch=arm64
fi

asset="circuit-$os-$arch"

version="${CIRCUIT_VERSION:-}"
if [ -z "$version" ]; then
    latest="$(curl -fsSL https://circuit.tako.id/latest.json)" || fail "could not reach circuit.tako.id to learn the newest version"
    version="$(printf '%s' "$latest" | sed -n 's/.*"latest"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
    [ -n "$version" ] || fail "circuit.tako.id/latest.json does not name a version"
fi

printf 'Installing Circuit %s for %s %s\n' "$version" "$os" "$arch"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

base="https://github.com/$REPO/releases/download/v$version"
curl -fsSL --retry 3 -o "$work/$asset" "$base/$asset" || fail "could not download $asset for Circuit $version"
curl -fsSL --retry 3 -o "$work/SHA256SUMS" "$base/SHA256SUMS" || fail "could not download the checksums of Circuit $version"

expected="$(grep " $asset\$" "$work/SHA256SUMS" | cut -d ' ' -f 1)"
if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$work/$asset" | cut -d ' ' -f 1)"
else
    actual="$(shasum -a 256 "$work/$asset" | cut -d ' ' -f 1)"
fi
[ -n "$expected" ] && [ "$expected" = "$actual" ] || fail "$asset does not match the release's SHA256SUMS"

mkdir -p "$BIN_DIR"
chmod +x "$work/$asset"
mv "$work/$asset" "$BIN_DIR/circuit"

# PATH: the shell's own startup file, written once.
case ":$PATH:" in
    *":$BIN_DIR:"*) on_path=yes ;;
    *) on_path=no ;;
esac

if [ "$on_path" = no ]; then
    line="export PATH=\"\$HOME/.circuit/bin:\$PATH\""
    case "${SHELL:-}" in
        */zsh) profile="$HOME/.zshrc" ;;
        */bash) if [ "$os" = darwin ]; then profile="$HOME/.bash_profile"; else profile="$HOME/.bashrc"; fi ;;
        */fish)
            profile="$HOME/.config/fish/config.fish"
            line="fish_add_path \$HOME/.circuit/bin"
            mkdir -p "$(dirname "$profile")"
            ;;
        *) profile="$HOME/.profile" ;;
    esac

    if ! grep -qs '.circuit/bin' "$profile"; then
        printf '\n# Circuit\n%s\n' "$line" >>"$profile"
    fi
    printf 'Added %s to PATH in %s. Open a new terminal to run circuit from anywhere.\n' "$BIN_DIR" "$profile"
fi

printf 'Circuit %s is installed: %s\n' "$version" "$BIN_DIR/circuit"

# The project's questions need the terminal: this script's own input is the download.
if [ "${CIRCUIT_NO_SETUP:-}" != 1 ] && [ -t 1 ] && [ -r /dev/tty ]; then
    "$BIN_DIR/circuit" setup </dev/tty
fi
