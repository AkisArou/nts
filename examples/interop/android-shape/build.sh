#!/bin/sh
# Build the Android-shaped Java, generate the declarations from it, run the
# demonstration, and check the declarations against what is committed.
#
# No Android SDK: plain Java interfaces with the same shapes, so this runs on a
# desktop JVM in the gate and on a device unchanged.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../.." && pwd)

if ! command -v javac > /dev/null 2>&1; then
  echo "SKIP android-shape: no javac on PATH"
  exit 0
fi

rm -rf "$here/target"
mkdir -p "$here/target/classes"
javac --release 8 -Xlint:all,-options -d "$here/target/classes" \
  "$here"/java/com/example/ui/*.java "$here"/java/Demo.java
jar --create --file "$here/target/ui.jar" -C "$here/target/classes" com

# The demonstration. Its output is the evidence for the sharpest constraint in
# the interop plan, and it is four lines rather than an argument.
java -Xverify:all -cp "$here/target/classes" Demo

# The declarations, generated from the class files.
generated="$here/target/com.example.ui.d.ts"
( cd "$root" && CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-target-jvm}" cargo run --release -q \
    -p nts-jvm-emitter --example bind -- \
    "$here/target/classes" com.example.ui \
    com/example/ui/Rect com/example/ui/Widget com/example/ui/View com/example/ui/Loader \
    ) > "$generated"

if [ "${NTS_REGENERATE:-}" = "1" ]; then
  cp "$generated" "$here/types/com.example.ui.d.ts"
  echo "regenerated types/com.example.ui.d.ts"
elif ! diff -u "$here/types/com.example.ui.d.ts" "$generated"; then
  echo
  echo "the generated declarations changed. If that was intended:"
  echo "  NTS_REGENERATE=1 $0"
  exit 1
fi

echo "android-shape: demo ran and declarations agree"
