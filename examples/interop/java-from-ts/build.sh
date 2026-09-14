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

# The declarations and the binding table, from the class files rather than from
# the source. That is the point: this reads `android.jar`, where there is no
# source.
#
# **One invocation, two files.** The `.d.ts` tells the checker what `index()`
# returns; the `.bind` says which instruction the call becomes, keyed by the
# byte offset of each declaration's end. Those offsets number the text the same
# run produced, so generating the two separately would be two derivations of
# one fact -- and the failure is silent, an offset landing one declaration over
# and resolving a call to the wrong overload rather than to none.
generated="$out/com.example.d.ts"
table="$out/com.example.bind"
( cd "$root" && CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-target-jvm}" cargo run --release -q \
    -p nts-cli -- bind --classes "$out/classes" --package com.example --out "$out" )

if [ "${NTS_REGENERATE:-}" = "1" ]; then
  cp "$generated" "$here/types/com.example.d.ts"
  cp "$table" "$here/types/com.example.bind"
  echo "regenerated types/com.example.d.ts and types/com.example.bind"
elif ! diff -u "$here/types/com.example.d.ts" "$generated" \
  || ! diff -u "$here/types/com.example.bind" "$table"; then
  echo
  echo "the generated declarations changed. If that was intended:"
  echo "  NTS_REGENERATE=1 $0"
  exit 1
fi

echo "java-from-ts: jar built and declarations agree"
