#!/bin/sh
# Build one TypeScript program for Linux and for macOS (x86_64 and arm64) from
# this Linux box, and hold every build to the same output.
#
# `expected.txt` is what node prints for the same source. What each arm
# asserts:
#
# - **Node:** where node is on PATH, it runs `src/main.ts` as it is and
#   prints `expected.txt`, so the expectation is the oracle's today and not a
#   copy of what it once said.
# - **Linux:** runs, and prints `expected.txt` byte for byte.
# - **Both streams:** where node is on PATH, the Linux program's stdout and
#   stderr in one file are node's. Nothing else checks that `console.log` is
#   written through: a buffered stdout keeps each stream's order and loses
#   only their interleaving.
# - **Control:** the comparison is fed a one-line change of `expected.txt` and
#   must reject it, so "matches" cannot come from a comparison that always
#   succeeds.
# - **Both Mach-O slices:** they are Mach-O for the right CPU, load nothing but
#   libSystem, and carry `minos 13.0`. That is what a cross link can get wrong
#   silently.
# - **x86_64 on a Mac:** runs through `tooling/apple/run.sh` (the lane's VM) and
#   prints `expected.txt`. With no Mac reachable this arm says so by name and
#   the others still count. arm64 is never run: the VM is x86_64
#   (tooling/apple/vm.md).
#
# `nts build` exits 0 with refused functions missing, so its output is checked
# for that as well as its status.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-macos-hello"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/macos-hello"
apple=${NTS_APPLE_ROOT:-"$HOME/.cache/nts/apple"}

for tool in zig ld64.lld llvm-objdump llvm-otool; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "SKIP macos-hello: no $tool on PATH"
    exit 0
  fi
done
# The sysroot and libuv are derived from zig and the vendored libuv, so they
# are made here rather than asked of the reader.
[ -d "$apple/zig-sdk/usr/include" ] || NTS_APPLE_ROOT="$apple" "$root/tooling/apple/zig-sdk.sh" >/dev/null
[ -f "$apple/x86_64/lib/libuv.a" ] && [ -f "$apple/aarch64/lib/libuv.a" ] ||
  NTS_APPLE_ROOT="$apple" "$root/tooling/apple/build-libuv.sh" >/dev/null

mkdir -p "$out"
log="$out/build.log"
NTS_APPLE_ROOT="$apple" "$nts" build "$source/tsconfig.json" --out "$out" >"$log" 2>&1 ||
  { cat "$log" >&2; exit 1; }
if grep -qE "refused|NTS[0-9]{4}" "$log"; then
  cat "$log" >&2
  echo "macos-hello: nts build refused part of the program and exited 0" >&2
  exit 1
fi

if command -v node >/dev/null 2>&1; then
  node "$source/src/main.ts" >"$out/node.txt" 2>/dev/null
  diff -u "$source/expected.txt" "$out/node.txt"
  echo "node: prints expected.txt"
fi

linux="$out/hello/linux-gnu-x86_64/hello"
"$linux" >"$out/linux.txt" 2>/dev/null
diff -u "$source/expected.txt" "$out/linux.txt"
echo "linux: matches node"
if command -v node >/dev/null 2>&1; then
  node "$source/src/main.ts" >"$out/node-both.txt" 2>&1
  "$linux" >"$out/linux-both.txt" 2>&1
  diff -u "$out/node-both.txt" "$out/linux-both.txt"
  grep -q "^stderr after sync$" "$out/linux-both.txt" ||
    { echo "macos-hello: the stderr line is missing from the combined log" >&2; exit 1; }
  echo "linux: stdout and stderr interleave as node's do"
fi

sed 's/^bigint .*/bigint 0/' "$source/expected.txt" >"$out/control.txt"
if diff -q "$out/control.txt" "$out/linux.txt" >/dev/null; then
  echo "macos-hello: the comparison accepted a changed expectation" >&2
  exit 1
fi
echo "control: a changed expectation is rejected"

for arch in x86_64 aarch64; do
  slice="$out/hello/macos-13-$arch/hello"
  case $arch in x86_64) cpu=x86_64 ;; aarch64) cpu=arm64 ;; esac
  kind=$(file -b "$slice")
  case $kind in
    *Mach-O*"$cpu"*executable*) ;;
    *) echo "macos-hello: $slice is not a $cpu Mach-O executable: $kind" >&2; exit 1 ;;
  esac
  loads=$(llvm-objdump --macho --dylibs-used "$slice" | tail -n +2 | awk '{print $1}')
  if [ "$loads" != "/usr/lib/libSystem.B.dylib" ]; then
    echo "macos-hello: $arch loads more than libSystem: $loads" >&2
    exit 1
  fi
  llvm-otool -l "$slice" | grep -q "minos 13.0" ||
    { echo "macos-hello: $arch does not carry minos 13.0" >&2; exit 1; }
  echo "macos-$arch: Mach-O $cpu, libSystem only, minos 13.0"
done

set +e
"$root/tooling/apple/run.sh" "$out/hello/macos-13-x86_64/hello" >"$out/macos.txt" 2>"$out/macos.err"
status=$?
set -e
case $status in
  0)
    diff -u "$source/expected.txt" "$out/macos.txt"
    echo "macos-x86_64: matches node, run on a Mac"
    ;;
  77) echo "SKIP macos-x86_64: not run -- no Mac reachable (tooling/apple/vm.md)" ;;
  *) cat "$out/macos.err" >&2; echo "macos-hello: the x86_64 program exited $status on the Mac" >&2; exit 1 ;;
esac
