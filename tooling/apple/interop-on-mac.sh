#!/usr/bin/env bash
# Runs an existing C interop example (examples/interop/<name>) for macOS: the
# library built here for macos-13 x86_64, its C `caller` compiled and linked
# here against the Apple SDK, and the caller run on the lane's Mac.
#
#   tooling/apple/interop-on-mac.sh <name>... [--out DIR]
#
# The examples are the compiler lane's, and their configs target Linux. So
# nothing in them is edited: each is mirrored under DIR with its repository
# neighbours symlinked (the fixture tsconfig, the runtime's declarations,
# node_modules), the mirror's config is retargeted, and the example's own
# build.sh runs from the mirror with three substitutions: CC is the Apple
# clang, the output directory is the macOS one, and `"$out/caller"` goes
# through tooling/apple/run.sh. Whatever else the script asserts, it still
# asserts.
#
# Needs NTS_APPLE_SDK (the consumer links against it) and a reachable Mac.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
out="${TMPDIR:-/tmp}/nts-interop-on-mac"
names=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --out) out="$2"; shift 2 ;;
    *) names+=("$1"); shift ;;
  esac
done
[[ ${#names[@]} -gt 0 ]] || { echo "usage: $0 <example>... [--out DIR]" >&2; exit 2; }
[[ -n "${NTS_APPLE_SDK:-}" && -d "$NTS_APPLE_SDK/usr/include" ]] ||
  { echo "NTS_APPLE_SDK must name a MacOSX.sdk (tooling/apple/sync-sdk.sh)" >&2; exit 2; }
"$here/run.sh" --reachable || { echo "SKIP interop-on-mac: no Mac reachable"; exit 0; }

mirror="$out/mirror"
rm -rf "$mirror"
mkdir -p "$out"
# A program rather than a command line: the examples quote `"$cc"`.
apple_cc="$out/apple-cc"
printf '#!/bin/sh\nexec clang -target x86_64-apple-macos13 -isysroot "%s" -fuse-ld=lld -Wno-unused-command-line-argument "$@"\n' \
  "$NTS_APPLE_SDK" >"$apple_cc"
chmod +x "$apple_cc"
mkdir -p "$mirror/examples/interop" "$mirror/runtime" "$mirror/tooling"
ln -s "$repo/tsconfig.fixtures.json" "$mirror/tsconfig.fixtures.json"
ln -s "$repo/node_modules" "$mirror/node_modules"
ln -s "$repo/runtime/native" "$mirror/runtime/native"
ln -s "$repo/tooling/config" "$mirror/tooling/config"
ln -s "$repo/target" "$mirror/target"
# `@nts/config` resolves from the interop directory's own install.
ln -s "$repo/examples/interop/node_modules" "$mirror/examples/interop/node_modules"
ln -s "$repo/examples/interop/package.json" "$mirror/examples/interop/package.json"

status=0
for name in "${names[@]}"; do
  source="$repo/examples/interop/$name"
  [[ -f "$source/build.sh" ]] || { echo "no example $name" >&2; status=1; continue; }
  copy="$mirror/examples/interop/$name"
  cp -R "$source" "$copy"
  config="$copy/nts.config.ts"
  grep -q 'target.linux({ backend: "c" })' "$config" ||
    { echo "$name: its config does not name target.linux({ backend: \"c\" }) once" >&2; status=1; continue; }
  sed -i 's/target.linux({ backend: "c" })/target.macos({ minimumVersion: "13.0", arch: "x86_64", backend: "c" })/' "$config"
  # `CC` stays unset: `nts build` would take it for its own toolchain too, and
  # the Apple branch already chooses the right one. Only the consumer's
  # compiler is substituted.
  grep -q '^cc=${CC:-clang}$' "$copy/build.sh" ||
    { echo "$name: its build.sh does not choose its compiler as cc=\${CC:-clang}" >&2; status=1; continue; }
  sed -i -e "s|^cc=\\\${CC:-clang}\$|cc=\"$apple_cc\"|" \
    -e 's|linux-gnu-x86_64|macos-13-x86_64|g' \
    -e "s|^\\([[:space:]]*\\)\"\\\$out/caller\"|\\1\"$here/run.sh\" \"\$out/caller\"|" "$copy/build.sh"
  echo "== $name"
  grep -q "^cc=\"$apple_cc\"$" "$copy/build.sh" ||
    { echo "$name: the compiler substitution did not take" >&2; status=1; continue; }
  if env -u CC sh "$copy/build.sh" "$out/$name"; then
    echo "== $name: passed on the Mac"
  else
    echo "== $name: FAILED" >&2
    status=1
  fi
done
exit $status
