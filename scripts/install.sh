#!/bin/sh
# Installs Circuit on macOS and Linux:
#
#   curl -fsSL https://circuit.tako.id/install | sh
#
# Circuit goes in ~/.local/bin, like an app; that folder is added to PATH when it is not there yet. Run it again to update.
# Then, in a folder with a project (circuit.ts), the project is set up as it is; anywhere else, Circuit offers to start one.
#
# CIRCUIT_VERSION=1.0.0 installs that version. CIRCUIT_NO_SETUP=1 installs only. `circuit uninstall` removes it.

set -eu

REPO="takodotid/circuit"
BIN_DIR="$HOME/.local/bin"
MARKER="# Added by Circuit"

fail() {
    printf 'Circuit was not installed: %s\n' "$1" >&2
    exit 1
}

command -v curl >/dev/null 2>&1 || fail "this needs curl"

case "$(uname -s)" in
    Linux) os=linux ;;
    Darwin) os=darwin ;;
    *) fail "this is for macOS and Linux. On Windows, run in PowerShell: irm https://circuit.tako.id/install.ps1 | iex" ;;
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

# The newest Circuit 1 or later, from npm: the stable release, or the newest release candidate while there is none.
version="${CIRCUIT_VERSION:-}"
if [ -z "$version" ]; then
    tags="$(curl -fsSL https://registry.npmjs.org/-/package/@takodotid/circuit/dist-tags)" || fail "could not reach the npm registry to learn the newest version"
    tag() { printf '%s' "$tags" | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p"; }
    version="$(tag latest)"
    case "$version" in
        0.*) version="$(tag rc)" ;;
    esac
    [ -n "$version" ] || fail "npm names no version of Circuit 1 yet"
fi

target="$BIN_DIR/circuit"
installed=""
[ -x "$target" ] && installed="$("$target" --version 2>/dev/null || true)"

if [ "$installed" = "$version" ]; then
    printf 'Circuit %s is installed already.\n' "$version"
else
    if [ -n "$installed" ]; then
        printf 'Updating Circuit %s to %s\n' "$installed" "$version"
    else
        printf 'Installing Circuit %s\n' "$version"
    fi

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
    mv "$work/$asset" "$target"
fi

# PATH: the shell's own startup file, once, with a marker so `circuit uninstall` can take the line out again.
case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *)
        line="export PATH=\"\$HOME/.local/bin:\$PATH\" $MARKER"
        case "${SHELL:-}" in
            */zsh) profile="$HOME/.zshrc" ;;
            */bash) if [ "$os" = darwin ]; then profile="$HOME/.bash_profile"; else profile="$HOME/.bashrc"; fi ;;
            */fish)
                profile="$HOME/.config/fish/config.fish"
                line="fish_add_path \$HOME/.local/bin $MARKER"
                mkdir -p "$(dirname "$profile")"
                ;;
            *) profile="$HOME/.profile" ;;
        esac
        grep -qs "$MARKER" "$profile" || printf '%s\n' "$line" >>"$profile"
        printf 'Added %s to PATH in %s. Open a new terminal to run circuit.\n' "$BIN_DIR" "$profile"
        ;;
esac

# The project's questions need the terminal: this script's own input is the download.
if [ "${CIRCUIT_NO_SETUP:-}" != 1 ] && [ -t 1 ] && [ -r /dev/tty ]; then
    "$target" setup </dev/tty
fi
