#!/bin/sh
# A Win32 window whose window procedure is TypeScript, closed by a TypeScript
# `await` while `GetMessageW` owns the thread, run on the lane's Windows.
#
# What each arm asserts:
#
# - **The build:** `nts build` exits 0 and refuses nothing. Its Win32
#   bindings are generated from Windows metadata by the build itself
#   (`types/winmd`, `nts bind-winmd`), and the witness compares each one the
#   program calls with <windows.h>.
# - **The PE:** a console PE32+ for x86-64 that imports only Windows' own DLLs.
# - **On Windows:** the program prints `expected.txt`: a window created and
#   destroyed once, closed `by=typescript`. The control is inside the program:
#   a Win32 timer closes the window instead after about two seconds, printing
#   `by=failsafe`, which is what a libuv that never turns inside the message
#   loop produces. It was measured so, with `nts_win_host_attach` removed and
#   with only its schedule hook removed.
# - **LLVM:** `windowLlvm` is the same program through the LLVM backend, held
#   to the same PE checks and the same output: its window procedure is a
#   bridge the LLVM backend writes, and its `POINT` crosses as Win64's integer.
#
# With no Windows reachable the run arm says so by name, and the rest still
# count.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-windows-window"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/windows-window"
windows=${NTS_WINDOWS_ROOT:-"$HOME/.cache/nts/windows"}

for tool in zig clang llvm-objdump; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "SKIP windows-window: no $tool on PATH"
    exit 0
  fi
done
# The Win32 metadata the bindings are generated from: fetched once, 24 MB.
if ! NTS_WINDOWS_ROOT="$windows" "$root/tooling/windows/fetch-win32metadata.sh" >/dev/null 2>&1; then
  echo "SKIP windows-window: no Win32 metadata, and it could not be fetched"
  exit 0
fi
[ -f "$windows/x86_64/lib/libuv.a" ] ||
  NTS_WINDOWS_ROOT="$windows" "$root/tooling/windows/build-libuv.sh" x86_64 >/dev/null

mkdir -p "$out"
log="$out/build.log"
NTS_WINDOWS_ROOT="$windows" "$nts" build "$source/tsconfig.json" --out "$out" >"$log" 2>&1 ||
  { cat "$log" >&2; exit 1; }
# The compiler's own refusals. The binder's summary lines ("129 refused (see
# ...refused.txt)") are about the metadata, not this program.
if grep -q -E "refused and are absent|NTS[0-9]{4}" "$log"; then
  cat "$log" >&2
  echo "windows-window: nts build refused part of the program and exited 0" >&2
  exit 1
fi

for product in window windowLlvm; do
  exe="$out/$product/windows-x86_64/$product.exe"
  kind=$(file -b "$exe")
  case $kind in
    *PE32+*console*x86-64*) ;;
    *) echo "windows-window: $exe is not an x86-64 console PE32+: $kind" >&2; exit 1 ;;
  esac
  foreign=$(llvm-objdump -p "$exe" | sed -n 's/^ *DLL Name: //p' | tr 'A-Z' 'a-z' |
    grep -v -e '^api-ms-win-' -e '^kernel32.dll$' -e '^advapi32.dll$' -e '^user32.dll$' \
      -e '^ws2_32.dll$' -e '^iphlpapi.dll$' -e '^userenv.dll$' -e '^dbghelp.dll$' \
      -e '^ole32.dll$' -e '^shell32.dll$' -e '^psapi.dll$' || true)
  if [ -n "$foreign" ]; then
    echo "windows-window: loads DLLs a stock Windows does not have: $foreign" >&2
    exit 1
  fi
  echo "windows-x86_64: console PE32+ x86-64, Windows DLLs only"

  set +e
  "$root/tooling/windows/run.sh" "$exe" >"$out/windows-$product.txt"
  status=$?
  set -e
  case $status in
    0)
      diff -u "$source/expected.txt" "$out/windows-$product.txt"
      echo "windows-x86_64 ($product): closed by TypeScript inside the message loop, run on Windows"
      ;;
    77) echo "SKIP windows-x86_64: not run -- no Windows reachable (tooling/windows/vm.md)" ;;
    *) echo "windows-window: $product exited $status on Windows" >&2; exit 1 ;;
  esac
done
