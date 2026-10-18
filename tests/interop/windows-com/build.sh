#!/bin/sh
# Real classic COM dispatch via generated bindings, under both ownership
# providers and native backends. Slot/signature refusal controls live in
# bind_winmd::map::tests::com_emission_checks_metadata_slots_signatures_and_explicit_out_slots.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-windows-com"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/tests/interop/windows-com"
windows=${NTS_WINDOWS_ROOT:-"$HOME/.cache/nts/windows"}
for tool in zig clang; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "SKIP windows-com: no $tool on PATH"
    exit 0
  fi
done
if ! "$root/tooling/windows/fetch-win32metadata.sh" >/dev/null 2>&1; then
  echo "SKIP windows-com: no Win32 metadata"
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
  expected="$source/expected.txt"
  [ "$provider" = rc ] && expected="$source/expected-rc.txt"
  for product in desktop desktopLlvm; do
    set +e
    "$root/tooling/windows/run.sh" "$build/$product/windows-x86_64/$product.exe" >"$build/$product.txt"
    status=$?
    set -e
    case $status in
      0) diff -u "$expected" "$build/$product.txt"
         echo "windows-com ($product, $provider): desktop vtable call and Release, run on Windows" ;;
      77) echo "SKIP windows-com ($product, $provider): not run -- no Windows reachable" ;;
      *) echo "windows-com ($product, $provider): exited $status" >&2; exit 1 ;;
    esac
  done
done


# A tiny reproducible WinMD fixture exercises the same binder on counted fake
# COM objects. Its marker-present Clone exercises the pure-out ownership contract. The synthetic
# direct C factory stays refused for the recorded status-spelling gap.
fixture="$source/ownership"
for provider in nogc rc; do
  build="$out/ownership/$provider"
  mkdir -p "$build"
  flags=""
  [ "$provider" = rc ] && flags="--rc"
  # shellcheck disable=SC2086
  NTS_WIN32_WINMD="$fixture/ownership.winmd" C_INCLUDE_PATH="$fixture/native" \
    "$nts" build "$fixture/tsconfig.json" --out "$build" $flags >"$build/build.log" 2>&1 ||
    { cat "$build/build.log" >&2; exit 1; }
  if grep -q -E 'refused and are absent|NTS[0-9]{4}' "$build/build.log"; then
    cat "$build/build.log" >&2
    exit 1
  fi
  expected="$fixture/expected.txt"
  [ "$provider" = rc ] && expected="$fixture/expected-rc.txt"
  for product in ownership ownershipLlvm; do
    set +e
    "$root/tooling/windows/run.sh" "$build/$product/windows-x86_64/$product.exe" >"$build/$product.txt"
    status=$?
    set -e
    case $status in
      0) diff -u "$expected" "$build/$product.txt"
         echo "windows-com ($product, $provider): owned/borrowed/copy/null/failure counters, run on Windows" ;;
      77) echo "SKIP windows-com ($product, $provider): not run -- no Windows reachable" ;;
      *) echo "windows-com ($product, $provider): exited $status" >&2; exit 1 ;;
    esac
  done
done
