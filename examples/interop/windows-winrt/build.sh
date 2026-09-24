#!/bin/sh
# The Windows Runtime from TypeScript: `Windows.Data.Json` through COM vtable
# calls, built here and run on the lane's Windows.
#
# What each arm asserts:
#
# - **The build:** `nts build` exits 0 and refuses nothing, with and without
#   `--rc`.
# - **The PE:** a console PE32+ for x86-64 that imports only Windows' own
#   DLLs -- the Windows Runtime is `api-ms-win-core-winrt-*`, present on every
#   Windows 10 and 11, with nothing to redistribute.
# - **Both backends:** `winrt` is the C backend's build and `winrtLlvm` the
#   LLVM backend's, of the same program, each held to the same text.
# - **On Windows:** each build prints its expectation. The line is built so a
#   part that did not work shows (see `src/main.ts`): the factory cache is
#   asserted by its count (a cache that never hit prints `activations=3`,
#   measured), and `released` is 0 without a counting provider and 2 under
#   `--rc`, one per object the program was handed.
#
# With no Windows reachable the run arms say so by name, and the rest still
# count.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-windows-winrt"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/windows-winrt"
windows=${NTS_WINDOWS_ROOT:-"$HOME/.cache/nts/windows"}

for tool in zig clang llvm-objdump; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "SKIP windows-winrt: no $tool on PATH"
    exit 0
  fi
done
[ -f "$windows/x86_64/lib/libuv.a" ] ||
  NTS_WINDOWS_ROOT="$windows" "$root/tooling/windows/build-libuv.sh" x86_64 >/dev/null

for provider in nogc rc; do
  build="$out/$provider"
  mkdir -p "$build"
  log="$build/build.log"
  flags=""
  [ "$provider" = rc ] && flags="--rc"
  # shellcheck disable=SC2086
  NTS_WINDOWS_ROOT="$windows" "$nts" build "$source/tsconfig.json" --out "$build" $flags >"$log" 2>&1 ||
    { cat "$log" >&2; exit 1; }
  if grep -q -E "refused and are absent|NTS[0-9]{4}" "$log"; then
    cat "$log" >&2
    echo "windows-winrt: nts build refused part of the program and exited 0" >&2
    exit 1
  fi
  for product in winrt winrtLlvm; do
    exe="$build/$product/windows-x86_64/$product.exe"
    kind=$(file -b "$exe")
    case $kind in
      *PE32+*console*x86-64*) ;;
      *) echo "windows-winrt: $exe is not an x86-64 console PE32+: $kind" >&2; exit 1 ;;
    esac
    foreign=$(llvm-objdump -p "$exe" | sed -n 's/^ *DLL Name: //p' | tr 'A-Z' 'a-z' |
      grep -v -e '^api-ms-win-' -e '^kernel32.dll$' -e '^advapi32.dll$' -e '^user32.dll$' \
        -e '^ws2_32.dll$' -e '^iphlpapi.dll$' -e '^userenv.dll$' -e '^dbghelp.dll$' \
        -e '^ole32.dll$' -e '^shell32.dll$' -e '^psapi.dll$' || true)
    if [ -n "$foreign" ]; then
      echo "windows-winrt: loads DLLs a stock Windows does not have: $foreign" >&2
      exit 1
    fi
    expected="$source/expected.txt"
    [ "$provider" = rc ] && expected="$source/expected-rc.txt"
    set +e
    "$root/tooling/windows/run.sh" "$exe" >"$build/windows-$product.txt"
    status=$?
    set -e
    case $status in
      0)
        diff -u "$expected" "$build/windows-$product.txt"
        echo "windows-x86_64 ($product, $provider): Windows.Data.Json through COM vtables, run on Windows"
        ;;
      77) echo "windows-x86_64 ($product, $provider): not run -- no Windows reachable (tooling/windows/vm.md)" ;;
      *) echo "windows-winrt: $product ($provider) exited $status on Windows" >&2; exit 1 ;;
    esac
  done
done
