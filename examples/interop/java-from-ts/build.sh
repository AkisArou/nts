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
# `|| true`, because `set -e` otherwise kills the script on a typecheck
# failure *before* the grep below can print why -- which is how a `TS2339`
# surfaced as a bare non-zero exit and an empty log.
NTS_BACKEND=jvm "$nts" emit-jvm "$here/tsconfig.json" --out "$emitted" --entry main > "$out/emit.log" 2>&1 || true
if grep -qE "^TS[0-9]{4}|does not typecheck" "$out/emit.log"; then
  echo "java-from-ts: the program does not typecheck:"
  sed 's/^/    /' "$out/emit.log"
  exit 1
fi
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

# And every refusal this project documents, produced rather than asserted in
# prose. `src/refused.ts` used to quote nine `NTS41xx` codes that do not exist
# in the compiler; the first run of this script found a tenth kind of wrong --
# a claim whose line could not reach the refusal it named, because the type was
# never imported.
sh "$root/tooling/jvm/check-refusals.sh" "$here"


# **The whole line, now that none of it is knowingly wrong.** This used to
# check two values and say why: `Catalog.MAX` read `0` where Java says `512`,
# because a declared numeric constant folded to zero in shared lowering, and
# asserting the output whole would have written that wrong value down as
# expected. That is fixed, so the check is the answer rather than a sample of
# it.
#
# Each field is a matrix row and several would survive a plausible break: `515`
# is `hits + MAX` computed in Java, `9007199254740993` is 2^53+1 surviving as a
# bigint, `65535` is nowhere here but `s:x` is a bound `String` round trip, and
# `k` and the trailing `widgets` are a static nested class and an inner one.
expected="catalog 3 512 10 0 0 widgets 515 4 9007199254740993 1 3 0 3 s:x 6 6 widgets 3 2 k widgets"
if [ "$answer" != "$expected" ]; then
  echo "java-from-ts: the answer changed."
  echo "  expected: $expected"
  echo "  actual:   $answer"
  exit 1
fi
