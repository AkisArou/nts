#!/bin/sh
# Header-spelled enums (a real tag, and typedefs of anonymous enums)
# crossed as the integer clang says each is compatible with, on Windows.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-windows-enum-tags"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/tests/interop/windows-enum-tags"
windows=${NTS_WINDOWS_ROOT:-"$HOME/.cache/nts/windows"}
for tool in zig clang; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "SKIP windows-enum-tags: no $tool on PATH"
    exit 0
  fi
done
if ! "$root/tooling/windows/fetch-win32metadata.sh" >/dev/null 2>&1; then
  echo "SKIP windows-enum-tags: no Win32 metadata"
  exit 0
fi
[ -f "$windows/x86_64/lib/libuv.a" ] || "$root/tooling/windows/build-libuv.sh" x86_64 >/dev/null
for provider in nogc rc; do
  build="$out/$provider"
  mkdir -p "$build"
  flags=""
  [ "$provider" = rc ] && flags="--rc"
  # shellcheck disable=SC2086
  "$nts" build "$source/tsconfig.json" --out "$build" $flags >"$build/build.log" 2>&1 ||
    { cat "$build/build.log" >&2; exit 1; }
  if grep -q -E 'refused and are absent|NTS[0-9]{4}' "$build/build.log"; then
    cat "$build/build.log" >&2
    exit 1
  fi
  for product in enumtags enumtagsLlvm; do
    built="$build/$product/windows-x86_64"
    set +e
    "$root/tooling/windows/run.sh" "$built/$product.exe" >"$build/$product.txt"
    status=$?
    set -e
    case $status in
      0) diff -u "$source/expected.txt" "$build/$product.txt"
         echo "windows-enum-tags ($product, $provider): tagged and anonymous header enums, run on Windows" ;;
      77) echo "SKIP windows-enum-tags ($product, $provider): not run -- no Windows reachable" ;;
      *) echo "windows-enum-tags ($product, $provider): exited $status" >&2; exit 1 ;;
    esac
  done
done
