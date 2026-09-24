#!/bin/sh
# Build one TypeScript program for Linux and for Windows (x86_64 and arm64) from
# this Linux box, and hold every build to the same output.
#
# `expected.txt` is what node prints for the same source, with `report` as
# `console.log`. What each arm asserts:
#
# - **Linux:** runs, and prints `expected.txt` byte for byte.
# - **Control:** the comparison is fed a one-line change of `expected.txt` and
#   must reject it, so "matches" cannot come from a comparison that always
#   succeeds.
# - **Both PE executables:** they are console PE32+ for the right machine and
#   import nothing but Windows' own DLLs. That is what a cross link can get
#   wrong silently: a mingw runtime DLL (`libwinpthread-1.dll`) links fine
#   here and is missing on a stock Windows.
# - **x86_64 on Windows:** runs through `tooling/windows/run.sh` (the lane's
#   VM) and prints `expected.txt`. With no Windows reachable this arm says so by
#   name and the others still count. arm64 is never run (tooling/windows/vm.md).
#
# `nts build` exits 0 with refused functions missing, so its output is checked
# for that as well as its status.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-windows-hello"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/windows-hello"
windows=${NTS_WINDOWS_ROOT:-"$HOME/.cache/nts/windows"}

for tool in zig clang llvm-objdump; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "SKIP windows-hello: no $tool on PATH"
    exit 0
  fi
done
# libuv is derived from the vendored copy, so it is made here rather than
# asked of the reader.
[ -f "$windows/x86_64/lib/libuv.a" ] && [ -f "$windows/aarch64/lib/libuv.a" ] ||
  NTS_WINDOWS_ROOT="$windows" "$root/tooling/windows/build-libuv.sh" >/dev/null

mkdir -p "$out"
log="$out/build.log"
NTS_WINDOWS_ROOT="$windows" "$nts" build "$source/tsconfig.json" --out "$out" >"$log" 2>&1 ||
  { cat "$log" >&2; exit 1; }
if grep -q "refused" "$log"; then
  cat "$log" >&2
  echo "windows-hello: nts build refused part of the program and exited 0" >&2
  exit 1
fi

linux="$out/hello/linux-gnu-x86_64/hello"
"$linux" >"$out/linux.txt"
diff -u "$source/expected.txt" "$out/linux.txt"
echo "linux: matches node"

sed 's/^bigint .*/bigint 0/' "$source/expected.txt" >"$out/control.txt"
if diff -q "$out/control.txt" "$out/linux.txt" >/dev/null; then
  echo "windows-hello: the comparison accepted a changed expectation" >&2
  exit 1
fi
echo "control: a changed expectation is rejected"

for arch in x86_64 aarch64; do
  exe="$out/hello/windows-$arch/hello.exe"
  case $arch in x86_64) machine=x86-64 ;; aarch64) machine=ARM64 ;; esac
  kind=$(file -b "$exe")
  case $kind in
    *PE32+*console*"$machine"*) ;;
    *) echo "windows-hello: $exe is not a $machine console PE32+: $kind" >&2; exit 1 ;;
  esac
  # Windows' own DLLs: the UCRT API sets, and the system libraries libuv needs.
  foreign=$(llvm-objdump -p "$exe" | sed -n 's/^ *DLL Name: //p' | tr 'A-Z' 'a-z' |
    grep -v -e '^api-ms-win-' -e '^kernel32.dll$' -e '^advapi32.dll$' -e '^user32.dll$' \
      -e '^ws2_32.dll$' -e '^iphlpapi.dll$' -e '^userenv.dll$' -e '^dbghelp.dll$' \
      -e '^ole32.dll$' -e '^shell32.dll$' -e '^psapi.dll$' || true)
  if [ -n "$foreign" ]; then
    echo "windows-hello: $arch loads DLLs a stock Windows does not have: $foreign" >&2
    exit 1
  fi
  echo "windows-$arch: console PE32+ $machine, Windows DLLs only"
done

set +e
"$root/tooling/windows/run.sh" "$out/hello/windows-x86_64/hello.exe" >"$out/windows.txt"
status=$?
set -e
case $status in
  0)
    diff -u "$source/expected.txt" "$out/windows.txt"
    echo "windows-x86_64: matches node, run on Windows"
    ;;
  77) echo "windows-x86_64: not run -- no Windows reachable (tooling/windows/vm.md)" ;;
  *) echo "windows-hello: the x86_64 program exited $status on Windows" >&2; exit 1 ;;
esac
