#!/bin/sh
# Build the JVM runtime into a jar the backend embeds.
#
# `--release 8` is not incidental: it fixes the language level and the platform
# signatures javac compiles against, and it is what pins the class version at
# 52. It does *not* by itself keep `invokedynamic` out -- a lambda compiles to
# `LambdaMetafactory` at version 52 -- so `runtime_jar.rs` asserts the jar
# contains none rather than trusting that this flag did it.
#
# `--date` makes the archive reproducible: without it every rebuild differs in
# its timestamps and the drift test could never pass.
#
# `$1` is where the jar goes, defaulting to beside the sources. A test passes a
# temporary path so it can rebuild and compare without touching the checked-in
# artifact -- which is the whole point of a drift check.
set -eu
# Archive member ordering must not depend on the embedding shell's locale.
# Fixed timestamps alone still let en_US and C produce different jar bytes.
LC_ALL=C
export LC_ALL
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
jar_path=${1:-$root/nts-runtime.jar}
# **The classes go to a directory of this run's own.** They went to
# `$root/classes`, removed first and last: two builds at once -- the drift test
# (runtime_jar.rs) and the sabotage test (jvm_sabotage.rs), which the gate now
# runs side by side -- removed each other's classes mid-compile, and one failed
# with `file not found: runtime/jvm/classes/sources.txt` (2026-10-07).
out=$(mktemp -d "${TMPDIR:-/tmp}/nts-jvm-classes.XXXXXX")
trap 'rm -rf "$out" "$out.list"' EXIT
find "$root/src" -name '*.java' | sort > "$out/sources.txt"
javac --release 8 -Xlint:-options -d "$out" @"$out/sources.txt"
rm -f "$out/sources.txt"
(
  cd "$out"
  find . -name '*.class' | sed 's|^\./||' | sort > "$out.list"
  jar --create --file "$jar_path" \
      --date=2020-01-01T00:00:00Z \
      $(cat "$out.list")
  rm -f "$out.list"
)
rm -rf "$out"
echo "built $jar_path"
