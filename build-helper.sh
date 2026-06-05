#!/usr/bin/env bash
# Compiles the native Swift Keychain helper as a universal binary (arm64 + x86_64).
# Run once before `pnpm dev`, or automatically via `predev`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$ROOT/vault-keychain/main.swift"
OUT_ARM="$ROOT/resources/vault-keychain-arm64"
OUT_X64="$ROOT/resources/vault-keychain-x64"
OUT="$ROOT/resources/vault-keychain"

if ! command -v swiftc &>/dev/null; then
  echo "⚠  swiftc not found — install Xcode Command Line Tools:"
  echo "   xcode-select --install"
  exit 1
fi

echo "→ Compiling vault-keychain (universal)…"
mkdir -p "$ROOT/resources"

swiftc "$SRC" -O -target arm64-apple-macosx13.0  -o "$OUT_ARM"
swiftc "$SRC" -O -target x86_64-apple-macosx13.0 -o "$OUT_X64"

lipo -create "$OUT_ARM" "$OUT_X64" -output "$OUT"
chmod +x "$OUT"
rm "$OUT_ARM" "$OUT_X64"

if command -v codesign &>/dev/null; then
  codesign --force --sign - --timestamp=none "$OUT"
fi

echo "✓ Built universal binary: $OUT"
