#!/bin/sh
# A notes application in AppKit, run twice inside `[NSApp run]` on the lane's
# Mac, in its GUI session. See src/main.ts.
#
# The arms:
#
# - **First run:** no file, so the throwing read gives an empty list. Three
#   notes are typed and added by the button's action, the table's data source
#   answers three rows, and the file is written.
# - **Second run:** the three notes read back, three more added, six rows and
#   six saved -- what the first run wrote is what the second finds.
# - **LLVM:** the second run's program from the LLVM backend, a third run on
#   the same file: nine.
# - **Counted:** the C program built with reference counting (`--rc`), which
#   releases each note, string and view at its last use: twelve.
#
# Needs a macOS SDK and Swift's symbol graphs. Without them it prints SKIP;
# with no Mac reachable it says the runs were not made.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-macos-notes"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/macos-notes"
apple=${NTS_APPLE_ROOT:-"$HOME/.cache/nts/apple"}
sdk=${NTS_APPLE_SDK:-"$apple/MacOSX.sdk"}

for tool in clang ld64.lld; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "SKIP macos-notes: no $tool on PATH"
    exit 0
  fi
done
if [ ! -d "$sdk/System/Library/Frameworks/AppKit.framework" ]; then
  echo "SKIP macos-notes: no macOS SDK at $sdk (tooling/apple/sync-sdk.sh)"
  exit 0
fi
version=$(sed -n 's/.*"Version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$sdk/SDKSettings.json" | head -1)
if [ ! -f "$apple/symbolgraph/$version/AppKit.symbols.json" ]; then
  echo "SKIP macos-notes: no Swift symbol graphs for SDK $version (tooling/apple/symbolgraph.sh AppKit Foundation ObjectiveC)"
  exit 0
fi
[ -f "$apple/x86_64/lib/libuv.a" ] && [ -f "$apple/aarch64/lib/libuv.a" ] ||
  NTS_APPLE_ROOT="$apple" "$root/tooling/apple/build-libuv.sh" >/dev/null

mkdir -p "$out"
# `types/appkit.d.ts` is `nts bind-objc`'s, and must still be: regenerated and
# compared. NTS_REGENERATE=1 writes it instead.
"$nts" bind-objc --sdk "$sdk" --module objc:AppKit --framework AppKit --framework Foundation \
  --class NSApplication --class NSWindow --class NSButton --class NSTextField --class NSTableView \
  --class NSTableColumn --class NSScrollView --class NSString --class NSTimer --class NSEvent \
  --protocol NSTableViewDataSource --out "$out/appkit.d.ts" --values "$out/appkit.values.ts" >/dev/null
for generated in appkit.d.ts appkit.values.ts; do
  if [ "${NTS_REGENERATE:-}" = 1 ]; then
    command cp -f "$out/$generated" "$source/types/$generated"
  fi
  diff -u "$source/types/$generated" "$out/$generated" >"$out/$generated.diff" || {
    head -40 "$out/$generated.diff" >&2
    echo "macos-notes: types/$generated is not what nts bind-objc writes; NTS_REGENERATE=1 rewrites it" >&2
    exit 1
  }
done
log="$out/build.log"
NTS_APPLE_ROOT="$apple" NTS_APPLE_SDK="$sdk" "$nts" build "$source/tsconfig.json" --out "$out" >"$log" 2>&1 ||
  { cat "$log" >&2; exit 1; }
if grep -qE "refused|NTS[0-9]{4}" "$log"; then
  cat "$log" >&2
  echo "macos-notes: nts build refused part of the program and exited 0" >&2
  exit 1
fi
NTS_APPLE_ROOT="$apple" NTS_APPLE_SDK="$sdk" "$nts" build "$source/tsconfig.json" --out "$out/rc" --rc >"$out/rc.log" 2>&1 ||
  { cat "$out/rc.log" >&2; exit 1; }
if grep -qE "refused|NTS[0-9]{4}" "$out/rc.log"; then
  cat "$out/rc.log" >&2
  echo "macos-notes: nts build --rc refused part of the program and exited 0" >&2
  exit 1
fi
echo "macos: both slices built and linked"

if ! "$root/tooling/apple/run.sh" --reachable; then
  echo "macos-notes: not run -- no Mac reachable (tooling/apple/vm.md)"
  exit 0
fi
ssh -o BatchMode=yes "${NTS_APPLE_SSH:-nts-mac}" rm -f /tmp/nts-macos-notes.txt

# One run, bounded, its log compared with what it should say.
run() {
  product=$1
  dir=${product%%/*}
  product=${product#*/}
  shift
  timeout 60 "$root/tooling/apple/run.sh" "$out/$dir/$product/macos-13-x86_64/$product" >"$out/$product-$1.txt" 2>"$out/$product-$1.err" ||
    { cat "$out/$product-$1.txt" "$out/$product-$1.err" >&2; exit 1; }
  if [ -s "$out/$product-$1.err" ]; then
    cat "$out/$product-$1.err" >&2
    exit 1
  fi
  printf '%s\n' "loaded $2" "added note 1 of $(($2 + 1))" "added note 2 of $(($2 + 2))" "added note 3 of $(($2 + 3))" \
    "rows $(($2 + 3))" "saved $(($2 + 3))" | diff -u - "$out/$product-$1.txt" ||
    { echo "macos-notes: the $1 run of $product did not say what it should" >&2; exit 1; }
}
run ./notes first 0
echo "first run: no file, three notes added through the button, three rows from the data source, three saved"
run ./notes second 3
echo "second run: the three read back, three more added, six rows and six saved"
run ./notesLlvm third 6
echo "LLVM: the same application, from the LLVM backend, reading nine"
run rc/notes fourth 9
echo "counted: the C program under reference counting, reading twelve"
