#!/bin/sh
# A pod from TypeScript: `Chirp`, which the program imports as `objc:Chirp`.
# Run on the lane's Mac against the same program in Objective-C
# (`reference/main.m`).
#
# `Podfile.lock`, `Pods/Manifest.lock`, `Pods/Headers`, `Pods/Local Podspecs`
# and the Podfile target's `.release.xcconfig` are what `pod install`
# (CocoaPods 1.11.3) wrote for the `Podfile` here; nothing else of `Pods/` is
# read, so nothing else is kept. To make them again, on the Mac: `pod install`
# beside the `Podfile`, and copy those back. `Beep/make.sh` makes
# `Beep.xcframework`.
#
# The arms:
#
# - **Binding:** none is committed. `nts build` reads the lockfile, finds each
#   pod where it says (development pods, `:path`), binds `objc:Chirp` from the
#   pod's public headers, and compiles its sources -- a private one in
#   `Classes/Internal` among them, against the header map CocoaPods made of
#   every header of the pod. `Hum` is Swift: compiled as one module, and bound
#   from the header Swift writes for it -- not from the umbrella CocoaPods
#   writes for a Swift pod, which is its own and not the pod's (its links
#   point into `Target Support Files`, which is not kept). `Beep` ships only
#   an `.xcframework`: the slice for each target is linked, shipped beside the
#   program as a dynamic framework, and bound from the framework's headers --
#   and `Beep/src`, which made it, is not compiled, since a development pod's
#   files are its podspec's, not its directory's. `Mix` is both languages
#   in one module: its Swift is compiled with its Objective-C as the module
#   it imports as its own, as CocoaPods' `-import-underlying-module` does, and
#   its `.m` against the header Swift writes; bound as one module, from both.
#   `Echo` is Swift over `Chirp`, which the lockfile says it depends on: its
#   Swift imports `Chirp` as a module of Chirp's public headers, as the
#   module map CocoaPods writes for a pod with modular headers is.
#   Nothing runs `pod`. The build log must say nothing was refused.
# - **Oracle:** `reference/main.m`, compiled with the pod's sources and run on
#   the same Mac.
# - **Main (C) and LLVM:** the program prints exactly what the oracle prints.
#   stderr is empty.
# - **Control:** a lockfile that `Pods/` was not installed from -- one pinning
#   another version -- is refused by name, as CocoaPods' own check refuses it,
#   rather than built from the checkout it does not describe.
# - **arm64:** built and linked, never run here (tooling/apple/vm.md).
#
# Needs a macOS SDK. Without one it prints SKIP; with no Mac reachable it says
# the runs were not made.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-macos-pods"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/macos-pods"
apple=${NTS_APPLE_ROOT:-"$HOME/.cache/nts/apple"}
sdk=${NTS_APPLE_SDK:-"$apple/MacOSX.sdk"}

for tool in clang ld64.lld; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "SKIP macos-pods: no $tool on PATH"
    exit 0
  fi
done
if [ ! -f "$sdk/usr/lib/libobjc.tbd" ]; then
  echo "SKIP macos-pods: no macOS SDK at $sdk (tooling/apple/sync-sdk.sh)"
  exit 0
fi
swift=${NTS_SWIFT_TOOLCHAIN:-$(ls -d "$HOME"/.cache/nts/swift/swift-*/ 2>/dev/null | sort | tail -1)}
if [ -z "$swift" ] || [ ! -x "$swift/usr/bin/swift-frontend" ]; then
  echo "SKIP macos-pods: no Swift toolchain (NTS_SWIFT_TOOLCHAIN, or one unpacked under ~/.cache/nts/swift)"
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
  echo "macos-pods: nts build refused part of the program and exited 0" >&2
  exit 1
fi
for arch in x86_64 aarch64; do
  file -b "$out/chirp/macos-13-$arch/chirp" | grep -q "Mach-O" ||
    { echo "macos-pods: no $arch Mach-O executable" >&2; exit 1; }
  for object in Chirp/Classes/Chirp.m.o Chirp/Classes/Internal/Tweeter.m.o Hum.swift.o Mix/Classes/MXCounter.m.o Mix.swift.o Echo.swift.o; do
    [ -f "$out/chirp/macos-13-$arch/$object" ] ||
      { echo "macos-pods: the pod's $object was not compiled for $arch" >&2; exit 1; }
  done
  [ ! -e "$out/chirp/macos-13-$arch/Beep" ] ||
    { echo "macos-pods: Beep's sources were compiled, where the pod is only its framework" >&2; exit 1; }
  [ -L "$out/chirp/macos-13-$arch/Beep.framework/Beep" ] ||
    { echo "macos-pods: Beep.framework was not shipped beside the $arch program, links as links" >&2; exit 1; }
done
llvm_arm64="$out/chirpLlvm/macos-13-aarch64/chirpLlvm"
file -b "$llvm_arm64" | grep -q "Mach-O.*arm64" && [ -f "$out/chirpLlvm/macos-13-aarch64/program.ll.o" ] ||
  { echo "macos-pods: no arm64 Mach-O compiled from LLVM IR at $llvm_arm64" >&2; exit 1; }
echo "macos: both slices built and linked, the pod's sources compiled in each"

# The control: the fixture's own files, with a lockfile pinning a version the
# checkout in `Pods/` is not.
control="$out/control"
rm -rf "$control"
mkdir -p "$control"
cp -R "$source/." "$control/"
sed 's/Chirp (0.1.0)/Chirp (0.2.0)/' "$source/Podfile.lock" >"$control/Podfile.lock"
# Outside the tree, so what the fixture reaches by relative path is named.
printf '{ "extends": "%s/tsconfig.fixtures.json", "include": ["src", "%s/runtime/native/libc.d.ts", "%s/runtime/objc/objc.d.ts"] }\n' \
  "$root" "$root" "$root" >"$control/tsconfig.json"
mkdir -p "$control/node_modules/@nts"
ln -sfn "$root/tooling/config" "$control/node_modules/@nts/config"
if build "$control" "$out/control-build"; then
  echo "macos-pods: a lockfile Pods/ was not installed from was built from" >&2
  exit 1
fi
grep -q "run \`pod install\`" "$out/control-build.log" ||
  { cat "$out/control-build.log" >&2; echo "macos-pods: the stale checkout was refused, but not by name" >&2; exit 1; }
echo "control: a lockfile Pods/ was not installed from is refused, naming \`pod install\`"

# The oracle's Hum, compiled by the same toolchain as the program's: a
# resource directory of its `shims` and `clang` only, as swift.rs makes one,
# and a module cache kept between runs.
resource="$out/swift-resource"
mkdir -p "$resource"
for part in shims clang; do
  [ -e "$resource/$part" ] || ln -s "$swift/usr/lib/swift/$part" "$resource/$part"
done
"$swift/usr/bin/swift-frontend" -frontend -c "$source/Hum/Sources/Hum.swift" -module-name Hum -parse-as-library -O \
  -target x86_64-apple-macos13 -sdk "$sdk" -resource-dir "$resource" -I "$resource/shims" \
  -module-cache-path "$apple/swift-oracle-modules" -emit-objc-header-path "$out/Hum-Swift.h" -o "$out/Hum.o"
# Mix as CocoaPods builds it: its Swift against a module of its Objective-C
# headers, and its `.m` against the header that Swift writes.
mkdir -p "$out/mix-map"
printf 'module Mix {\n  header "%s"\n  export *\n}\n' "$source/Mix/Classes/MXCounter.h" >"$out/mix-map/module.modulemap"
"$swift/usr/bin/swift-frontend" -frontend -c "$source/Mix/Classes/MXTally.swift" -module-name Mix -parse-as-library -O \
  -target x86_64-apple-macos13 -sdk "$sdk" -resource-dir "$resource" -I "$resource/shims" \
  -module-cache-path "$apple/swift-oracle-modules" -import-underlying-module -Xcc -fmodule-map-file="$out/mix-map/module.modulemap" \
  -emit-objc-header-path "$out/Mix-Swift.h" -o "$out/Mix.o"
# Echo as CocoaPods builds it: Chirp through a module map of the pod's public
# header, as the one CocoaPods writes for a pod with modular headers is.
mkdir -p "$out/chirp-map"
printf 'module Chirp {\n  header "%s"\n  export *\n}\n' "$source/Chirp/Classes/Chirp.h" >"$out/chirp-map/module.modulemap"
"$swift/usr/bin/swift-frontend" -frontend -c "$source/Echo/Sources/Echo.swift" -module-name Echo -parse-as-library -O \
  -target x86_64-apple-macos13 -sdk "$sdk" -resource-dir "$resource" -I "$resource/shims" \
  -module-cache-path "$apple/swift-oracle-modules" -Xcc -fmodule-map-file="$out/chirp-map/module.modulemap" \
  -emit-objc-header-path "$out/Echo-Swift.h" -o "$out/Echo.o"
clang -target x86_64-apple-macos13 -isysroot "$sdk" -fuse-ld=lld -x objective-c -fobjc-arc -fblocks -fmodules -Wall -Werror \
  -I "$source/Pods/Headers/Public/Chirp" -I "$source/Pods/Headers/Private/Chirp" -I "$source/Pods/Headers/Public/Mix" -I "$out" \
  "$source/reference/main.m" "$source/Chirp/Classes/Chirp.m" "$source/Chirp/Classes/Internal/Tweeter.m" "$source/Mix/Classes/MXCounter.m" \
  -x none "$out/Hum.o" "$out/Mix.o" "$out/Echo.o" -framework Foundation \
  -F "$source/Beep/Beep.xcframework/macos-arm64_x86_64" -framework Beep -Wl,-rpath,@executable_path \
  -L"$sdk/usr/lib/swift" -Wl,-rpath,/usr/lib/swift -o "$out/oracle"
rm -rf "$out/Beep.framework"
cp -R "$source/Beep/Beep.xcframework/macos-arm64_x86_64/Beep.framework" "$out/"

if ! "$root/tooling/apple/run.sh" --reachable; then
  echo "SKIP macos-pods: not run -- no Mac reachable (tooling/apple/vm.md)"
  exit 0
fi
# Runs a program on the Mac into `$2.txt`, and fails on anything on stderr.
run_quietly() {
  "$root/tooling/apple/run.sh" "$1" >"$2.txt" 2>"$2.err"
  if [ -s "$2.err" ]; then
    echo "macos-pods: $1 wrote to stderr:" >&2
    cat "$2.err" >&2
    exit 1
  fi
}
run_quietly "$out/oracle" "$out/expected"
[ "$(wc -l <"$out/expected.txt")" -eq 8 ] ||
  { echo "macos-pods: the oracle printed $(wc -l <"$out/expected.txt") lines, not 8" >&2; exit 1; }

run_quietly "$out/chirp/macos-13-x86_64/chirp" "$out/actual"
diff -u "$out/expected.txt" "$out/actual.txt"
echo "macos-x86_64: the pod's class as Objective-C has it, stderr empty"

llvm="$out/chirpLlvm/macos-13-x86_64"
[ -f "$llvm/program.ll.o" ] && [ ! -f "$llvm/program.c.o" ] ||
  { echo "macos-pods: chirpLlvm was not compiled from LLVM IR" >&2; exit 1; }
run_quietly "$llvm/chirpLlvm" "$llvm/actual"
diff -u "$out/expected.txt" "$llvm/actual.txt"
echo "macos-x86_64 (LLVM): the same, from the LLVM backend"
