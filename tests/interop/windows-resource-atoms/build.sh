#!/bin/sh
# Overload dispatch on both host backends; real resource APIs on Windows.
# The DLL is rebuilt from the committed .rc and C sources, never downloaded.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-windows-resource-atoms"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/tests/interop/windows-resource-atoms"
windows=${NTS_WINDOWS_ROOT:-"$HOME/.cache/nts/windows"}
cc=${CC:-clang}
for tool in zig clang llvm-rc llvm-cvtres; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "SKIP windows-resource-atoms: no $tool on PATH"
    exit 0
  fi
done
if ! "$root/tooling/windows/fetch-win32metadata.sh" >/dev/null 2>&1; then
  echo "SKIP windows-resource-atoms: no Win32 metadata"
  exit 0
fi
[ -f "$windows/x86_64/lib/libuv.a" ] || "$root/tooling/windows/build-libuv.sh" x86_64 >/dev/null
mkdir -p "$out/fixture"
llvm-rc /fo "$out/fixture/fixture.res" "$source/resource/fixture.rc"
llvm-cvtres /machine:x64 /out:"$out/fixture/fixture.obj" "$out/fixture/fixture.res"
zig cc -target x86_64-windows-gnu -shared -nostdlib -Wl,--entry,nts_resource_entry \
  "$source/resource/fixture.c" "$out/fixture/fixture.obj" -o "$out/fixture/nts-resource-fixture.dll"
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
  # The host proof is a separate TS project: Windows module-scope statements
  # must not enter a Linux product's lowering.
  # shellcheck disable=SC2086
  "$nts" build "$source/overloads/tsconfig.json" --out "$build/overloads" $flags >"$build/host-build.log" 2>&1 ||
    { cat "$build/host-build.log" >&2; exit 1; }
  if grep -q -E 'refused and are absent|NTS[0-9]{4}' "$build/host-build.log"; then
    cat "$build/host-build.log" >&2
    exit 1
  fi
  for product in host hostLlvm; do
    built="$build/overloads/$product/linux-gnu-x86_64"
    "$cc" -std=c11 -O2 -Wall -Wextra -Werror -I"$built" -I"$source/overloads/native" \
      "$source/overloads/consumer/caller.c" "$built/lib$product.a" -lm -o "$build/$product-consumer"
    "$build/$product-consumer" >"$build/$product.txt"
    diff -u "$source/overloads/expected.txt" "$build/$product.txt"
    echo "windows-resource-atoms ($product, $provider): atom bits, UTF-16 conversion and an atom-carrying callback, run on host"
  done
  for product in resources resourcesLlvm; do
    built="$build/$product/windows-x86_64"
    command cp "$out/fixture/nts-resource-fixture.dll" "$built/nts-resource-fixture.dll"
    set +e
    "$root/tooling/windows/run.sh" "$built/$product.exe" >"$build/$product.txt"
    status=$?
    set -e
    case $status in
      0) diff -u "$source/expected.txt" "$build/$product.txt"
         echo "windows-resource-atoms ($product, $provider): shared cursor/icon, four resource overloads and the four enumerations, run on Windows" ;;
      77) echo "SKIP windows-resource-atoms ($product, $provider): not run -- no Windows reachable" ;;
      *) echo "windows-resource-atoms ($product, $provider): exited $status" >&2; exit 1 ;;
    esac
  done
done
