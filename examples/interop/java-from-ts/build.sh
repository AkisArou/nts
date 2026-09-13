#!/bin/sh
# Build the Java library, generate the declarations from it, and check them
# against what is committed.
#
# `types/com.example.d.ts` is GENERATED as of this script existing. It used to
# be hand-written as the specification for the generator; keeping both would be
# two answers to one question, and the generator has already corrected the
# hand-written version once.
#
# Skips loudly without a JDK: a skip that prints nothing is indistinguishable
# from a pass.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../.." && pwd)

if ! command -v javac > /dev/null 2>&1; then
  echo "SKIP java-from-ts: no javac on PATH"
  exit 0
fi

out="$here/target"
rm -rf "$out"
mkdir -p "$out/classes"
javac --release 8 -Xlint:all,-options -d "$out/classes" "$here"/java/com/example/*.java
jar --create --file "$out/catalog.jar" -C "$out/classes" .

# The declarations, from the class files rather than from the source. That is
# the point: `nts bind` will read `android.jar`, where there is no source.
#
# A directory rather than the jar, because a jar is a zip and the reader crate
# deliberately has no zip dependency -- `unzip -o` is the caller's job, and here
# the classes are already unpacked.
generated="$out/com.example.d.ts"
( cd "$root" && CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-target-jvm}" cargo run --release -q \
    -p nts-jvm-emitter --example bind -- \
    "$out/classes" com.example ) > "$generated"

if [ "${NTS_REGENERATE:-}" = "1" ]; then
  cp "$generated" "$here/types/com.example.d.ts"
  echo "regenerated types/com.example.d.ts"
elif ! diff -u "$here/types/com.example.d.ts" "$generated"; then
  echo
  echo "the generated declarations changed. If that was intended:"
  echo "  NTS_REGENERATE=1 $0"
  exit 1
fi

echo "java-from-ts: jar built and declarations agree"
