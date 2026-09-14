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

# The declarations and the binding table -- see java-from-ts/build.sh for why
# both come from one invocation.
#
# **The nine classes used to be listed here by hand**, to keep `Demo` and the
# compiler's anonymous `Loader$1` out of the surface. `--package` selects
# exactly the package now and skips anonymous classes, which no source can name
# anyway, so the list said nothing the package name does not -- and a list is a
# second place to update when a class is added.
generated="$here/target/com.example.ui.d.ts"
table="$here/target/com.example.ui.bind"
( cd "$root" && CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-target-jvm}" cargo run --release -q \
    -p nts-cli -- bind --classes "$here/target/classes" --package com.example.ui \
    --out "$here/target" )

if [ "${NTS_REGENERATE:-}" = "1" ]; then
  cp "$generated" "$here/types/com.example.ui.d.ts"
  cp "$table" "$here/types/com.example.ui.bind"
  echo "regenerated types/com.example.ui.d.ts and types/com.example.ui.bind"
elif ! diff -u "$here/types/com.example.ui.d.ts" "$generated" \
  || ! diff -u "$here/types/com.example.ui.bind" "$table"; then
  echo
  echo "the generated declarations changed. If that was intended:"
  echo "  NTS_REGENERATE=1 $0"
  exit 1
fi

echo "android-shape: demo ran and declarations agree"
