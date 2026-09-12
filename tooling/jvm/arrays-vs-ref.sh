#!/bin/sh
# Which array element type does each lane allocate, ours against the reference?
#
#     sh tooling/jvm/arrays-vs-ref.sh              # every case with a ref.java
#     CASES="awfy-queens awfy-permute" sh tooling/jvm/arrays-vs-ref.sh
#
# # The question, and why it needs no device
#
# `awfy-queens` (1.23x) and `awfy-permute` (1.22x) are the only two AWFY rows
# that allocate more than their reference on ART, and both are `newarray double`
# where the reference writes `newarray int` -- `widen` holding integers as
# doubles. Whether that shape is worth un-widening depends on how much of the
# corpus has it, and that is a question about class files. `javac` and `javap`
# answer it; the emulator is not involved and neither is the gate lock.
#
# Run 2026-09-12: **2 of 52**, and both are the two already known. 34 rows match
# their reference exactly. See `benches/jvm-rows.md`.
#
# # What it cannot answer, which is the more useful half
#
# This reads the *emitted classes*. A growable program allocates inside
# `nts/rt/NtsArrayD` in the runtime jar, so `growth-grown` and `array-from` come
# back `(none)` while allocating plenty -- `(none)` means "not in the emitted
# classes", not "nothing". And a static count of `newarray` instructions is
# doubled wherever specialisation fires, because the allocation appears in both
# `work(double)` and `work$whole(int)` and one of the two runs.
#
# So: element type, completely. Volume, not at all --
# `tooling/android/bytes-on-device.sh` is the instrument for that one, because
# it counts what the platform actually allocated.
#
# # Its own first run
#
# Forty-four of fifty-two references came back carrying one identical
# signature. Two defects: the whole are-we-fast-yet suite was on every
# reference's source list rather than only the `awfy-*` ones, and `anewarray`
# names a constant-pool index with the class in a trailing comment, so reading
# the next token printed types like `62:1`. A column constant across forty-four
# rows is the instrument, every time. The control is the five rows whose answers
# `benches/jvm-rows.md` already records.
set -u
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
nts=${NTS_BIN:-$root/target-jvm/release/nts}
awfy=${NTS_AWFY:-$root/third_party/are-we-fast-yet/benchmarks/Java}
work=${NTS_WORK:-$HOME/.cache/nts-arrays}/$$
mkdir -p "$work/stub"
trap 'rm -rf "$work"' EXIT INT TERM

cat > "$work/stub/Bench.java" <<'JAVA'
public final class Bench {
    private Bench() {}
    public abstract static class Work {
        public abstract double run();
    }
}
JAVA

# `newarray <type>` for primitives, `anewarray <class>` for references. Counted
# by type so "three boolean and one double" is legible rather than a total.
kinds() {
  awk '
    # `newarray double` names its type in the next token. `anewarray` and
    # `multianewarray` name a constant-pool index and put the class in the
    # trailing comment -- reading the token gives `#62`, which is what the
    # first version of this printed and what made every row look like a type
    # nobody has. Reference arrays are counted together as `obj`, because the
    # class names differ between the lanes by construction and the question
    # here is the element *kind*.
    /anewarray/ { n["obj"]++; next }
    /newarray/  { for (i = 1; i <= NF; i++) if ($i == "newarray") n[$(i+1)]++ }
    END { for (t in n) printf "%s:%s ", t, n[t] }
  ' | tr ' ' '\n' | sort | tr '\n' ' ' | sed 's/  */ /g;s/^ //;s/ $//'
}

printf "%-26s %-34s %s\n" "case" "ours" "reference"
for case in ${CASES:-$(find $root/benches/cases -name ref.java | sed "s|$root/benches/cases/||;s|/ref.java||" | sort)}; do
  out=$work/$case; mkdir -p "$out/ours" "$out/ref"

  cat > "$out/tsconfig.json" <<JSON
{ "extends": "$root/tsconfig.fixtures.json", "include": ["$root/benches/cases/$case"] }
JSON
  if NTS_TSGO=$root/target/tsgo "$nts" emit-jvm "$out/tsconfig.json" --out "$out/ours" \
       > "$out/emit.log" 2>&1; then
    cls=$(find "$out/ours" -name '*.class' | sed "s|$out/ours/||g;s|\.class||g;s|/|.|g")
    # shellcheck disable=SC2086
    ours=$(javap -c -p -cp "$out/ours" $cls 2>/dev/null | kinds)
    [ -n "$ours" ] || ours="(none)"
  else
    ours="(declined)"
  fi

  cp "$root/benches/cases/$case/ref.java" "$out/ref/Ref.java"
  cp "$work/stub/Bench.java" "$out/ref/"
  sources=$(find "$out/ref" -name '*.java')
  # **Only for `awfy-*`.** Appending these to every reference compiled the whole
  # are-we-fast-yet suite into each row and counted its arrays as the
  # reference's: forty-four rows came back with one identical signature, which
  # is what a constant column should always be read as.
  case "$case" in
    awfy-*)
      theirs=$(find "$awfy" -name '*.java' 2>/dev/null)
      [ -n "$theirs" ] || { printf "%-26s %-34s %s\n" "$case" "$ours" "(no awfy sources)"; continue; }
      sources="$sources $theirs" ;;
  esac
  # shellcheck disable=SC2086
  if javac -nowarn -d "$out/ref/classes" $sources > "$out/javac.log" 2>&1; then
    # The reference's OWN classes only. The AWFY sources are on the classpath
    # the way `ref.cpp` puts their headers on the include path, and counting
    # every class in `third_party` would measure their whole suite per row.
    keep=$(find "$out/ref/classes" -name '*.class' | while read -r c; do
             b=$(basename "$c" .class)
             if [ "$case" != "${case#awfy-}" ]; then
               # For an AWFY row the reference IS their class, so keep what
               # `Ref` names rather than only `Ref` itself.
               grep -q "\b${b%%\$*}\b" "$out/ref/Ref.java" && echo "$c"
             else
               case "$b" in Bench*) ;; *) echo "$c" ;; esac
             fi
           done)
    # shellcheck disable=SC2086
    ref=$([ -n "$keep" ] && javap -c -p $keep 2>/dev/null | kinds)
    [ -n "$ref" ] || ref="(none)"
  else
    ref="(javac)"
  fi
  printf "%-26s %-34s %s\n" "$case" "$ours" "$ref"
done
