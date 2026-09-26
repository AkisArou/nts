#!/bin/sh
# A notes application in AppKit, run twice inside `[NSApp run]` on the lane's
# Mac, in its GUI session. See src/main.ts.
#
# The arms:
#
# - **First run:** no file, so the throwing read gives an empty list. The
#   application delegate hears the launch. Three notes are typed and added
#   by the button's action, the third through the main menu's item, the
#   table's data source
#   answers three rows, and the file is written.
# - **Swift:** `reference/notes.swift`, the same application in Swift, line for
#   line, compiled with `swiftc` on the Mac: its first run prints what the
#   TypeScript program's first run printed.
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
log="$out/build.log"
NTS_APPLE_ROOT="$apple" NTS_APPLE_SDK="$sdk" "$nts" build "$source/tsconfig.json" --out "$out" >"$log" 2>&1 ||
  { cat "$log" >&2; exit 1; }
if grep -qE "refused|NTS[0-9]{4}" "$log"; then
  cat "$log" >&2
  echo "macos-notes: nts build refused part of the program and exited 0" >&2
  exit 1
fi
ls "$source"/.nts/objc/*/AppKit.d.ts >/dev/null 2>&1 ||
  { echo "macos-notes: nts build did not generate the AppKit binding in .nts/objc" >&2; exit 1; }
echo "binding: generated from the program's imports"
NTS_APPLE_ROOT="$apple" NTS_APPLE_SDK="$sdk" "$nts" build "$source/tsconfig.json" --out "$out/rc" --rc >"$out/rc.log" 2>&1 ||
  { cat "$out/rc.log" >&2; exit 1; }
if grep -qE "refused|NTS[0-9]{4}" "$out/rc.log"; then
  cat "$out/rc.log" >&2
  echo "macos-notes: nts build --rc refused part of the program and exited 0" >&2
  exit 1
fi
echo "macos: both slices built and linked"

if ! "$root/tooling/apple/run.sh" --reachable; then
  echo "SKIP macos-notes: not run -- no Mac reachable (tooling/apple/vm.md)"
  exit 0
fi
if ! "$root/tooling/apple/run.sh" --gui; then
  echo "SKIP macos-notes: not run -- the Mac has no user logged in to its desktop, so no window can open (tooling/apple/vm.md)"
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
  printf '%s\n' "loaded $2" "layout 240 270 224" "launched" "added note 1 of $(($2 + 1))" "added note 2 of $(($2 + 2))" "added note 3 of $(($2 + 3))" \
    "rows $(($2 + 3))" "saved $(($2 + 3))" | diff -u - "$out/$product-$1.txt" ||
    { echo "macos-notes: the $1 run of $product did not say what it should" >&2; exit 1; }
}
run ./notes first 0
echo "first run: no file, three notes added through the button, three rows from the data source, three saved"

# The oracle: `reference/notes.swift`, the same application written in Swift,
# compiled with `swiftc` on the Mac. Its first run says, line for line, what
# the TypeScript program's first run said.
dest=${NTS_APPLE_SSH:-nts-mac}
scp -q -o BatchMode=yes "$source/reference/notes.swift" "$dest:/tmp/nts-notes.swift"
ssh -o BatchMode=yes "$dest" 'cd /tmp && rm -f /tmp/nts-macos-notes-swift.txt && swiftc -O -target x86_64-apple-macos13 nts-notes.swift -o nts-notes-swift && ./nts-notes-swift' \
  >"$out/swift.txt" 2>"$out/swift.err" || { cat "$out/swift.txt" "$out/swift.err" >&2; exit 1; }
diff -u "$out/swift.txt" "$out/notes-first.txt" ||
  { echo "macos-notes: the TypeScript program's first run did not say what the Swift one does" >&2; exit 1; }
echo "swift: the same application in Swift says the same, line for line"
run ./notes second 3
echo "second run: the three read back, three more added, six rows and six saved"
run ./notesLlvm third 6
echo "LLVM: the same application, from the LLVM backend, reading nine"
run rc/notes fourth 9
echo "counted: the C program under reference counting, reading twelve"
