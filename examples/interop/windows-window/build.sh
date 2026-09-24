#!/bin/sh
# A Win32 window whose window procedure is TypeScript, closed by a TypeScript
# `await` while `GetMessageW` owns the thread, run on the lane's Windows.
#
# What each arm asserts:
#
# - **The build:** `nts build` exits 0 and refuses nothing. The witness
#   compares every hand-written binding with <windows.h>.
# - **The PE:** a console PE32+ for x86-64 that imports only Windows' own DLLs.
# - **On Windows:** the program prints `expected.txt`: a window created and
#   destroyed once, closed `by=typescript`. The control is inside the program:
#   a Win32 timer closes the window instead after about two seconds, printing
#   `by=failsafe`, which is what a libuv that never turns inside the message
#   loop produces. It was measured so, with `nts_win_host_attach` removed and
#   with only its schedule hook removed.
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
[ -f "$windows/x86_64/lib/libuv.a" ] ||
  NTS_WINDOWS_ROOT="$windows" "$root/tooling/windows/build-libuv.sh" x86_64 >/dev/null

mkdir -p "$out"
log="$out/build.log"
NTS_WINDOWS_ROOT="$windows" "$nts" build "$source/tsconfig.json" --out "$out" >"$log" 2>&1 ||
  { cat "$log" >&2; exit 1; }
if grep -q -e "refused" -e "NTS[0-9]" "$log"; then
  cat "$log" >&2
  echo "windows-window: nts build refused part of the program and exited 0" >&2
  exit 1
fi

exe="$out/window/windows-x86_64/window.exe"
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
"$root/tooling/windows/run.sh" "$exe" >"$out/windows.txt"
status=$?
set -e
case $status in
  0)
    diff -u "$source/expected.txt" "$out/windows.txt"
    echo "windows-x86_64: closed by TypeScript inside the message loop, run on Windows"
    ;;
  77) echo "windows-x86_64: not run -- no Windows reachable (tooling/windows/vm.md)" ;;
  *) echo "windows-window: the program exited $status on Windows" >&2; exit 1 ;;
esac
