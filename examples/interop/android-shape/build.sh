#!/bin/sh
# Build the Android-shaped Java and run the demonstration that the two callback
# shapes really differ.
#
# No Android SDK: these are plain Java interfaces with the same shapes, so this
# runs on a desktop JVM in the gate and on a device unchanged.
set -eu
here=$(cd "$(dirname "$0")" && pwd)

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

# The TypeScript side is not compiled yet: it needs `nts bind` and a foreign
# layout, which are build items 4 and 1. `types/com.example.ui.d.ts` is the
# specification for what `nts bind` must produce from `target/ui.jar`.
