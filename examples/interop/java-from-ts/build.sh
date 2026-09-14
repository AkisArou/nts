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
nts=${NTS_BIN:-"$root/target/release/nts"}


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

# **And run it**, which is the half that was missing. Until this existed the
# script checked the *binder* -- that the generated declarations match what is
# committed -- and never compiled the TypeScript beside them. `new
# Catalog("widgets")`, the first line of `src/main.ts`, was refused for an
# unknown length of time under a comment reading "This file compiles, and
# lowers", and nothing here would ever have said so.
emitted="$out/classes-ts"
NTS_BACKEND=jvm "$nts" emit-jvm "$here/tsconfig.json" --out "$emitted" --entry main > "$out/emit.log" 2>&1
if grep -qE "NTS[0-9]{4}" "$out/emit.log"; then
  echo "java-from-ts: the program did not lower:"
  sed 's/^/    /' "$out/emit.log"
  exit 1
fi

cat > "$out/Driver.java" <<'DRIVER'
public final class Driver {
    public static void main(String[] a) { System.out.println(nts.gen.Program.main()); }
}
DRIVER
javac -cp "$emitted:$emitted/nts-runtime.jar" -d "$out" "$out/Driver.java"
answer=$(java -Xverify:all -cp "$out:$emitted:$out/classes:$emitted/nts-runtime.jar" Driver)
echo "java-from-ts: $answer"

# Two values checked rather than the whole line, and each says something a
# crash would not. `515` is `hits + MAX` computed *in Java* -- 3 + 512 -- so it
# proves the bound call arrived and came back with the jar's own arithmetic.
# `9007199254740993` is 2^53+1, which a `double` cannot hold, so it proves the
# `long` crossed as a `bigint` rather than being rounded on the way.
#
# **Not the whole line, because one field is knowingly wrong.** `Catalog.MAX`
# reads `0` where Java says `512`: an ambient numeric constant folds to zero in
# shared lowering, on this backend and on C, with no diagnostic. Asserting the
# current output whole would write that wrong value down as expected.
case $answer in
  *" 515 "*) ;;
  *) echo "java-from-ts: expected 515 (hits + MAX, computed in Java) in: $answer"; exit 1 ;;
esac
case $answer in
  *9007199254740993*) ;;
  *) echo "java-from-ts: expected 2^53+1 to survive as a bigint in: $answer"; exit 1 ;;
esac
