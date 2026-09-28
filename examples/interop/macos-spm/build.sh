#!/bin/sh
# Swift packages from TypeScript: the `Package.swift` here depends on two
# local packages, `Tally` (Objective-C) and `Blink` (Swift), which the program
# imports as `objc:Tally` and `objc:Blink`. Run on the lane's Mac against the
# same program in Objective-C (`reference/main.m`).
#
# The arms:
#
# - **Binding:** none is committed. `nts build` reads each manifest with
#   SwiftPM's own `swift-package dump-package`, compiles each library target
#   -- `Tally` from its sources, bound from its `include/`, and linked with the
#   Core Foundation its linker settings name; `Blink` as a Swift module, bound
#   from the header Swift writes for it. Nothing resolves. The build log must
#   say nothing was refused.
# - **Oracle:** `reference/main.m`, compiled with the packages' sources by the
#   same toolchain, and run on the same Mac.
# - **Main (C) and LLVM:** the program prints exactly what the oracle prints.
#   stderr is empty.
# - **Control:** a `Package.resolved` pinning a package nothing checked out is
#   refused by name -- run `swift package resolve` -- rather than built without
#   it.
# - **arm64:** built and linked, never run here (tooling/apple/vm.md).
#
# Needs a macOS SDK and a Swift toolchain whose `swift-package` runs. Without
# either it prints SKIP; with no Mac reachable it says the runs were not made.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-macos-spm"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/macos-spm"
apple=${NTS_APPLE_ROOT:-"$HOME/.cache/nts/apple"}
sdk=${NTS_APPLE_SDK:-"$apple/MacOSX.sdk"}

for tool in clang ld64.lld; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "SKIP macos-spm: no $tool on PATH"
    exit 0
  fi
done
if [ ! -f "$sdk/usr/lib/libobjc.tbd" ]; then
  echo "SKIP macos-spm: no macOS SDK at $sdk (tooling/apple/sync-sdk.sh)"
  exit 0
fi
swift=${NTS_SWIFT_TOOLCHAIN:-$(ls -d "$HOME"/.cache/nts/swift/swift-*/ 2>/dev/null | sort | tail -1)}
if [ -z "$swift" ] || [ ! -x "$swift/usr/bin/swift-frontend" ]; then
  echo "SKIP macos-spm: no Swift toolchain (NTS_SWIFT_TOOLCHAIN, or one unpacked under ~/.cache/nts/swift)"
  exit 0
fi
[ -f "$apple/x86_64/lib/libuv.a" ] && [ -f "$apple/aarch64/lib/libuv.a" ] ||
  NTS_APPLE_ROOT="$apple" "$root/tooling/apple/build-libuv.sh" >/dev/null

# `build PROJECT DIR [nts build flags]`.
build() {
  project=$1
  dir=$2
  shift 2
  mkdir -p "$dir"
  NTS_APPLE_ROOT="$apple" NTS_APPLE_SDK="$sdk" NTS_SWIFT_TOOLCHAIN="$swift" "$nts" build "$project/tsconfig.json" --out "$dir" "$@" >"$dir.log" 2>&1
}
build "$source" "$out" --rc || { cat "$out.log" >&2; exit 1; }
if grep -qE "refused|NTS[0-9]{4}" "$out.log"; then
  cat "$out.log" >&2
  echo "macos-spm: nts build refused part of the program and exited 0" >&2
  exit 1
fi
for arch in x86_64 aarch64; do
  file -b "$out/spm/macos-13-$arch/spm" | grep -q "Mach-O" ||
    { echo "macos-spm: no $arch Mach-O executable" >&2; exit 1; }
  for object in Tally/Tally.m.o Blink.swift.o; do
    [ -f "$out/spm/macos-13-$arch/$object" ] ||
      { echo "macos-spm: the package's $object was not compiled for $arch" >&2; exit 1; }
  done
done
llvm_arm64="$out/spmLlvm/macos-13-aarch64/spmLlvm"
file -b "$llvm_arm64" | grep -q "Mach-O.*arm64" && [ -f "$out/spmLlvm/macos-13-aarch64/program.ll.o" ] ||
  { echo "macos-spm: no arm64 Mach-O compiled from LLVM IR at $llvm_arm64" >&2; exit 1; }
echo "macos: both slices built and linked, the packages' targets compiled in each"

# The control: the fixture's own files, with a Package.resolved pinning a
# package nothing here checked out.
control="$out/control"
rm -rf "$control"
mkdir -p "$control"
cp -R "$source/." "$control/"
cat >"$control/Package.resolved" <<'EOF'
{
  "pins" : [
    {
      "identity" : "files",
      "kind" : "remoteSourceControl",
      "location" : "https://github.com/JohnSundell/Files",
      "state" : {
        "revision" : "e85f2b4a8dfa0f242889f45236f3867d16e40480",
        "version" : "4.3.0"
      }
    }
  ],
  "version" : 2
}
EOF
# Outside the tree, so what the fixture reaches by relative path is named.
printf '{ "extends": "%s/tsconfig.fixtures.json", "include": ["src", "%s/runtime/native/libc.d.ts", "%s/runtime/objc/objc.d.ts"] }\n' \
  "$root" "$root" "$root" >"$control/tsconfig.json"
mkdir -p "$control/node_modules/@nts"
ln -sfn "$root/tooling/config" "$control/node_modules/@nts/config"
if build "$control" "$out/control-build"; then
  echo "macos-spm: a pin nothing checked out was built without" >&2
  exit 1
fi
grep -q "run \`swift package resolve\`" "$out/control-build.log" ||
  { cat "$out/control-build.log" >&2; echo "macos-spm: the missing checkout was refused, but not by name" >&2; exit 1; }
echo "control: a pin nothing checked out is refused, naming \`swift package resolve\`"

# The oracle's Blink, compiled by the same toolchain as the program's: a
# resource directory of its `shims` and `clang` only, as swift.rs makes one,
# and a module cache kept between runs.
resource="$out/swift-resource"
mkdir -p "$resource"
for part in shims clang; do
  [ -e "$resource/$part" ] || ln -s "$swift/usr/lib/swift/$part" "$resource/$part"
done
"$swift/usr/bin/swift-frontend" -frontend -c "$source/Packages/Blink/Sources/Blink/Blink.swift" -module-name Blink \
  -parse-as-library -O -target x86_64-apple-macos13 -sdk "$sdk" -resource-dir "$resource" -I "$resource/shims" \
  -module-cache-path "$apple/swift-oracle-modules" -emit-objc-header-path "$out/Blink-Swift.h" -o "$out/Blink.o"
clang -target x86_64-apple-macos13 -isysroot "$sdk" -fuse-ld=lld -x objective-c -fobjc-arc -fmodules -Wall -Werror \
  -I "$source/Packages/Tally/Sources/Tally/include" -I "$out" "$source/reference/main.m" \
  "$source/Packages/Tally/Sources/Tally/Tally.m" -x none "$out/Blink.o" -framework Foundation -framework CoreFoundation \
  -L"$sdk/usr/lib/swift" -Wl,-rpath,/usr/lib/swift -o "$out/oracle"

if ! "$root/tooling/apple/run.sh" --reachable; then
  echo "SKIP macos-spm: not run -- no Mac reachable (tooling/apple/vm.md)"
  exit 0
fi
# Runs a program on the Mac into `$2.txt`, and fails on anything on stderr.
run_quietly() {
  "$root/tooling/apple/run.sh" "$1" >"$2.txt" 2>"$2.err"
  if [ -s "$2.err" ]; then
    echo "macos-spm: $1 wrote to stderr:" >&2
    cat "$2.err" >&2
    exit 1
  fi
}
run_quietly "$out/oracle" "$out/expected"
[ "$(wc -l <"$out/expected.txt")" -eq 2 ] ||
  { echo "macos-spm: the oracle printed $(wc -l <"$out/expected.txt") lines, not 2" >&2; exit 1; }

run_quietly "$out/spm/macos-13-x86_64/spm" "$out/actual"
diff -u "$out/expected.txt" "$out/actual.txt"
echo "macos-x86_64: the packages' classes as Objective-C has them, stderr empty"

llvm="$out/spmLlvm/macos-13-x86_64"
[ -f "$llvm/program.ll.o" ] && [ ! -f "$llvm/program.c.o" ] ||
  { echo "macos-spm: spmLlvm was not compiled from LLVM IR" >&2; exit 1; }
run_quietly "$llvm/spmLlvm" "$llvm/actual"
diff -u "$out/expected.txt" "$llvm/actual.txt"
echo "macos-x86_64 (LLVM): the same, from the LLVM backend"
