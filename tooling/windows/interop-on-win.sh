#!/usr/bin/env bash
# Runs an existing C interop example (examples/interop/<name>) for Windows:
# the library built here for windows x86_64, its C `caller` compiled and
# linked here with zig's mingw-w64, and the caller run on the lane's Windows.
#
#   tooling/windows/interop-on-win.sh <name>... [--out DIR]
#
# The Apple lane's `interop-on-mac.sh`, for Windows. The examples are the
# compiler lane's and their configs target Linux, so nothing in them is edited.
# Each is mirrored under DIR with its repository neighbours symlinked, the
# mirror's config is retargeted, and the example's own build.sh runs from the
# mirror with four substitutions:
# - CC is zig's mingw cross compiler;
# - the output directory is the Windows one;
# - a static library is `<name>.lib`, as `nts build` names it for Windows;
# - `"$out/caller"` goes through tooling/windows/run.sh.
# Whatever else the script asserts, it still asserts.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
out="${TMPDIR:-/tmp}/nts-interop-on-win"
names=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --out) out="$2"; shift 2 ;;
    *) names+=("$1"); shift ;;
  esac
done
[[ ${#names[@]} -gt 0 ]] || { echo "usage: $0 <example>... [--out DIR]" >&2; exit 2; }
"$here/run.sh" --reachable || { echo "SKIP interop-on-win: no Windows reachable"; exit 0; }

mirror="$out/mirror"
rm -rf "${mirror:?}"
mkdir -p "$out"
# A program rather than a command line: the examples quote `"$cc"`.
win_cc="$out/win-cc"
printf '#!/bin/sh\nexec zig cc -target x86_64-windows-gnu -Wno-unused-command-line-argument "$@"\n' >"$win_cc"
chmod +x "$win_cc"
mkdir -p "$mirror/examples/interop" "$mirror/runtime" "$mirror/tooling"
ln -s "$repo/tsconfig.fixtures.json" "$mirror/tsconfig.fixtures.json"
ln -s "$repo/node_modules" "$mirror/node_modules"
ln -s "$repo/runtime/native" "$mirror/runtime/native"
ln -s "$repo/tooling/config" "$mirror/tooling/config"
ln -s "$repo/target" "$mirror/target"
ln -s "$repo/examples/interop/node_modules" "$mirror/examples/interop/node_modules"
ln -s "$repo/examples/interop/package.json" "$mirror/examples/interop/package.json"

status=0
for name in "${names[@]}"; do
  source="$repo/examples/interop/$name"
  [[ -f "$source/build.sh" ]] || { echo "no example $name" >&2; status=1; continue; }
  copy="$mirror/examples/interop/$name"
  cp -R "$source" "$copy"
  config="$copy/nts.config.ts"
  grep -qF 'target.linux({ backend: "c" })' "$config" ||
    { echo "$name: its config does not name target.linux({ backend: \"c\" }) once" >&2; status=1; continue; }
  sed -i 's/target.linux({ backend: "c" })/target.windows({ arch: "x86_64", backend: "c" })/' "$config"
  # `CC` stays unset: `nts build` would take it for its own toolchain too, and
  # its Windows branch already chooses the right one. Only the consumer's
  # compiler is substituted.
  grep -qxF 'cc=${CC:-clang}' "$copy/build.sh" ||
    { echo "$name: its build.sh does not choose its compiler as cc=\${CC:-clang}" >&2; status=1; continue; }
  sed -i -e "s|^cc=\\\${CC:-clang}\$|cc=\"$win_cc\"|" \
    -e 's|linux-gnu-x86_64|windows-x86_64|g' \
    -e 's|"\$built/lib\([A-Za-z0-9_-]*\)\.a"|"$built/\1.lib"|g' \
    -e "s|^\\([[:space:]]*\\)\"\\\$out/caller\"|\\1\"$here/run.sh\" \"\$out/caller\"|" "$copy/build.sh"
  echo "== $name"
  grep -qxF "cc=\"$win_cc\"" "$copy/build.sh" ||
    { echo "$name: the compiler substitution did not take" >&2; status=1; continue; }
  if env -u CC sh "$copy/build.sh" "$out/$name"; then
    echo "== $name: passed on Windows"
  else
    echo "== $name: FAILED" >&2
    status=1
  fi
done
exit $status
