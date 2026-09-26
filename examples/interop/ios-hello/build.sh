#!/bin/sh
# A UIKit application, run on the iOS simulator of the lane's Mac. See
# src/main.ts.
#
# The arms:
#
# - **Binding:** none is committed. `nts build` generates it from what
#   `src/main.ts` imports from `objc:UIKit`, into `.nts/objc`, and this
#   asserts the build read one.
# - **Main (C, `--rc`) and LLVM:** each is an `.app` for the simulator
#   (`LC_BUILD_VERSION` names `iossimulator`), installed and launched with
#   `simctl`. UIKit starts it, sends the application delegate its launch, the
#   button's action reaches the program's controller, and a timer ends it.
# - **Swift:** `reference/hello.swift`, the same application in Swift, line
#   for line, built by `swiftc` for the simulator: it says what the two
#   TypeScript products say.
#
# Needs `tooling/apple/sync-sdk.sh iphonesimulator` and
# `NTS_APPLE_PLATFORM=iphonesimulator tooling/apple/symbolgraph.sh UIKit
# Foundation ObjectiveC`. Without them it prints SKIP; with no Mac reachable
# it says the runs were not made.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-ios-hello"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/ios-hello"
apple=${NTS_APPLE_ROOT:-"$HOME/.cache/nts/apple"}
sdk=${NTS_IOS_SIMULATOR_SDK:-"$apple/iPhoneSimulator.sdk"}

for tool in clang ld64.lld llvm-objdump; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "SKIP ios-hello: no $tool on PATH"
    exit 0
  fi
done
if [ ! -f "$sdk/SDKSettings.json" ]; then
  echo "SKIP ios-hello: no iOS simulator SDK at $sdk (tooling/apple/sync-sdk.sh iphonesimulator)"
  exit 0
fi
symbols="$apple/symbolgraph/$(sed -n 's/.*"CanonicalName":"\([^"]*\)".*/\1/p' "$sdk/SDKSettings.json")"
if [ ! -f "$symbols/UIKit.symbols.json" ]; then
  echo "SKIP ios-hello: no iOS symbol graphs at $symbols (NTS_APPLE_PLATFORM=iphonesimulator tooling/apple/symbolgraph.sh UIKit Foundation ObjectiveC)"
  exit 0
fi
[ -f "$apple/x86_64-ios-simulator/lib/libuv.a" ] ||
  NTS_APPLE_ROOT="$apple" "$root/tooling/apple/build-libuv.sh" x86_64-ios-simulator >/dev/null

mkdir -p "$out"

NTS_IOS_SIMULATOR_SDK="$sdk" "$nts" build "$source/tsconfig.json" --out "$out" --rc >"$out/build.log" 2>&1 ||
  { cat "$out/build.log" >&2; exit 1; }
if grep -qE "refused|NTS[0-9]{4}" "$out/build.log"; then
  cat "$out/build.log" >&2
  echo "ios-hello: nts build refused part of the program and exited 0" >&2
  exit 1
fi
ls "$source"/.nts/objc/*/UIKit.d.ts >/dev/null 2>&1 ||
  { echo "ios-hello: nts build did not generate the UIKit binding in .nts/objc" >&2; exit 1; }
echo "binding: generated from the program's imports"
for product in hello helloLlvm; do
  binary="$out/$product/ios-17-x86_64/$product"
  llvm-objdump --macho --private-headers "$binary" | grep -q "platform iossimulator" ||
    { echo "ios-hello: $binary is not built for the iOS simulator" >&2; exit 1; }
  [ -f "$out/$product/ios-17-x86_64/$product.app/Info.plist" ] ||
    { echo "ios-hello: no bundle for $product" >&2; exit 1; }
done
echo "ios: both products built for the simulator and bundled"

if ! "$root/tooling/apple/run-ios.sh" --reachable; then
  echo "SKIP ios-hello: not run -- no Mac reachable (tooling/apple/vm.md)"
  exit 0
fi
printf '%s\n' "launched Hello from TypeScript true 2" "pressed 1" "done" >"$out/expected.txt"
for product in hello helloLlvm; do
  "$root/tooling/apple/run-ios.sh" "$out/$product/ios-17-x86_64/$product.app" >"$out/$product.txt" 2>"$out/$product.err" ||
    { cat "$out/$product.txt" "$out/$product.err" >&2; exit 1; }
  diff -u "$out/expected.txt" "$out/$product.txt"
done
echo "simulator: UIKit launched the TypeScript delegate, the button's action reached its controller, on both backends"

# The oracle: `reference/hello.swift`, the same application in Swift, built by
# `swiftc` for the simulator on the Mac and bundled from the TypeScript
# product's `Info.plist` under a name and identifier of its own.
dest=${NTS_APPLE_SSH:-nts-mac}
swift_app="$out/helloSwift.app"
rm -rf "$swift_app"
command cp -R "$out/hello/ios-17-x86_64/hello.app" "$swift_app"
rm -f "$swift_app/hello"
sed -i -e 's|<string>hello</string>|<string>helloSwift</string>|' \
  -e 's|<string>dev.nts.examples.ios-hello</string>|<string>dev.nts.examples.ios-hello-swift</string>|' "$swift_app/Info.plist"
scp -q -o BatchMode=yes "$source/reference/hello.swift" "$dest:/tmp/nts-ios-hello.swift"
ssh -o BatchMode=yes "$dest" 'cd /tmp && swiftc -O -target x86_64-apple-ios17.0-simulator -sdk "$(xcrun --sdk iphonesimulator --show-sdk-path)" nts-ios-hello.swift -o nts-ios-hello-swift' >&2
scp -q -o BatchMode=yes "$dest:/tmp/nts-ios-hello-swift" "$swift_app/helloSwift"
"$root/tooling/apple/run-ios.sh" "$swift_app" >"$out/swift.txt" 2>"$out/swift.err" ||
  { cat "$out/swift.txt" "$out/swift.err" >&2; exit 1; }
diff -u "$out/expected.txt" "$out/swift.txt"
echo "swift: the same application in Swift says the same, line for line"
