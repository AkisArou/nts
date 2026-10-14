#!/bin/sh
# Build the Android-shaped Java, generate the declarations from it, run the
# demonstration, and check the declarations against what is committed.
#
# No Android SDK: plain Java interfaces with the same shapes, so this runs on a
# desktop JVM in the gate and on a device unchanged.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../.." && pwd)
out=${1:-"$root/target/interop-android-shape"}
nts=${NTS_BIN:-"$root/target/release/nts"}


if ! command -v javac > /dev/null 2>&1; then
  echo "SKIP android-shape: no javac on PATH"
  exit 0
fi

rm -rf "$here/target"
mkdir -p "$here/target/classes"

# **One command for the library and the TypeScript.** This was a `javac` over
# `java/com/example/ui` here and an `emit-jvm` forty lines below -- two builds of
# one artifact. The config declares `native: [sources({ dir:
# "java/com/example/ui" })]`, so the build compiles the Java, emits the
# TypeScript, and packages them together.
#
# `$here/target/ui.jar` went with it: created here, read by nothing, and
# superseded by the jar the build produces.
#
# Everything below is an assertion rather than a build step, which is why this
# file is not a one-line call: the demo, the declaration drift check, the
# consumer and its exact output are what the example is *for*.
NTS_TSGO="${NTS_TSGO:-$root/target/tsgo}" "$nts" build "$here/tsconfig.json" \
  --out "$here/target/build" > "$here/target/build.log" 2>&1 \
  || { cat "$here/target/build.log"; exit 1; }
built="$here/target/build/api/java-8"

# `Demo` is a consumer in the default package rather than part of the library,
# so the build does not see it and this compiles it against what the build made.
javac --release 8 -Xlint:all,-options -cp "$built" -d "$here/target/classes" \
  "$here"/java/Demo.java

# The demonstration. Its output is the evidence for the sharpest constraint in
# the interop plan, and it is four lines rather than an argument.
java -Xverify:all -cp "$here/target/classes:$built" Demo

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
    -p nts-cli -- bind --classes "$built" --package com.example.ui \
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

# **And the TypeScript, which until 2026-09-15 this script never compiled.**
#
# `src/main.ts` holds every construct the coverage matrix credits to this
# project -- a TypeScript class extending a Java one, a class implementing a
# Java interface, both callback shapes -- and none of it was built by anything.
# The file was a design sketch that read like a working example. It does work;
# that was luck rather than evidence, and two of its claims were false when
# finally run.
emitted="$built"
javac --release 8 -Xlint:all,-options -cp "$emitted:$here/target/classes:$emitted/nts-runtime.jar" \
  -d "$here/target/classes" "$here/java/Run.java"
got=$(java -Xverify:all -cp "$here/target/classes:$emitted:$emitted/nts-runtime.jar" Run)
want="100 1 1 1 10 4"  # the 4 is the loader's callback, posted from its thread and run on ours
if [ "$got" != "$want" ]; then
  echo "android-shape: the TypeScript printed"
  echo "  $got"
  echo "expected"
  echo "  $want"
  exit 1
fi
echo "android-shape: ts ran -- $got"

echo "android-shape: demo ran and declarations agree"

# And every refusal this project documents, produced rather than asserted in
# prose. `src/refused.ts` used to quote nine `NTS41xx` codes that do not exist
# in the compiler; the first run of this script found a tenth kind of wrong --
# a claim whose line could not reach the refusal it named, because the type was
# never imported.
sh "$root/tooling/jvm/check-refusals.sh" "$here"

