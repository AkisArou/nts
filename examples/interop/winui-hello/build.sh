#!/bin/sh
# WinUI 3 from TypeScript: a window made by an unpackaged program, built here
# and run on the lane's Windows.
#
# What each arm asserts:
#
# - **The build:** `nts build` exits 0 and refuses nothing, with and without
#   `--rc`, on both backends. Its bindings come from the Windows App SDK's
#   metadata (`types/winrt`), and the SDK's bootstrapper is built beside the
#   program, which loads it to find the runtime installed on the machine.
# - **The PE:** a console PE32+ for x86-64 that imports only Windows' own DLLs:
#   the bootstrapper is loaded, not linked.
# - **On Windows, in the signed-in session** (`run.sh --interactive`; XAML
#   cannot compose a window in ssh's session 0): the line `src/main.ts`
#   explains, and `after` once `Application.Start` has returned.
# - **Without the bootstrapper beside it,** the program ends naming the file
#   rather than failing somewhere inside the first activation.
#
# With no Windows reachable the run arms say so by name, and the rest still
# count.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-winui-hello"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/winui-hello"
windows=${NTS_WINDOWS_ROOT:-"$HOME/.cache/nts/windows"}

for tool in zig clang llvm-objdump; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "SKIP winui-hello: no $tool on PATH"
    exit 0
  fi
done
# The metadata the bindings are generated from, and the SDK's bootstrapper,
# fetched once.
if ! NTS_WINDOWS_ROOT="$windows" "$root/tooling/windows/fetch-winrt-metadata.sh" >/dev/null 2>&1 ||
  ! NTS_WINDOWS_ROOT="$windows" "$root/tooling/windows/fetch-winappsdk.sh" >/dev/null 2>&1; then
  echo "SKIP winui-hello: no Windows Runtime or Windows App SDK metadata, and it could not be fetched"
  exit 0
fi
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
    echo "winui-hello: nts build refused part of the program and exited 0" >&2
    exit 1
  fi
  for product in winui winuiLlvm; do
    dir="$build/$product/windows-x86_64"
    exe="$dir/$product.exe"
    kind=$(file -b "$exe")
    case $kind in
      *PE32+*console*x86-64*) ;;
      *) echo "winui-hello: $exe is not an x86-64 console PE32+: $kind" >&2; exit 1 ;;
    esac
    foreign=$(llvm-objdump -p "$exe" | sed -n 's/^ *DLL Name: //p' | tr 'A-Z' 'a-z' |
      grep -v -e '^api-ms-win-' -e '^kernel32.dll$' -e '^advapi32.dll$' -e '^user32.dll$' \
        -e '^ws2_32.dll$' -e '^iphlpapi.dll$' -e '^userenv.dll$' -e '^dbghelp.dll$' \
        -e '^ole32.dll$' -e '^shell32.dll$' -e '^psapi.dll$' || true)
    if [ -n "$foreign" ]; then
      echo "winui-hello: links DLLs a stock Windows does not have: $foreign" >&2
      exit 1
    fi
    [ -f "$dir/Microsoft.WindowsAppRuntime.Bootstrap.dll" ] ||
      { echo "winui-hello: no bootstrapper built beside $exe" >&2; exit 1; }
    set +e
    "$root/tooling/windows/run.sh" --interactive "$exe" >"$build/windows-$product.txt" 2>"$build/windows-$product.err"
    status=$?
    set -e
    case $status in
      0)
        diff -u "$source/expected.txt" "$build/windows-$product.txt"
        echo "windows-x86_64 ($product, $provider): a WinUI 3 window, and the event loop inside XAML's, run on Windows"
        ;;
      77) echo "SKIP windows-x86_64 ($product, $provider): not run -- no Windows reachable (tooling/windows/vm.md)"; continue ;;
      *) cat "$build/windows-$product.err" >&2; echo "winui-hello: $product ($provider) exited $status on Windows" >&2; exit 1 ;;
    esac
    # The control: the same program with its bootstrapper moved away.
    if [ "$provider" = nogc ]; then
      bare="$build/$product-bare"
      mkdir -p "$bare"
      cp -f "$exe" "$bare/"
      set +e
      "$root/tooling/windows/run.sh" --interactive "$bare/$product.exe" >"$bare/stdout.txt" 2>"$bare/stderr.txt"
      status=$?
      set -e
      if [ "$status" = 0 ] || ! grep -q "Microsoft.WindowsAppRuntime.Bootstrap.dll is not beside the program" "$bare/stderr.txt"; then
        cat "$bare/stderr.txt" >&2
        echo "winui-hello: $product ran without its bootstrapper (status $status) or did not name it" >&2
        exit 1
      fi
      echo "windows-x86_64 ($product, $provider): without the bootstrapper it ends naming it, run on Windows"
    fi
  done
done
