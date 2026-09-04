#!/bin/sh
# Build the JVM runtime into a jar the backend embeds.
#
# `--release 8` is not incidental. From JDK 9 on, javac compiles string `+` to
# `invokedynamic makeConcatWithConstants`, which needs Android API 26 -- so the
# floor keeps the Android path open, and `runtime_jar.rs` asserts the jar
# contains no `invokedynamic` at all rather than trusting that it worked.
#
# `--date` makes the archive reproducible: without it every rebuild differs in
# its timestamps and the drift test could never pass.
#
# `$1` is where the jar goes, defaulting to beside the sources. A test passes a
# temporary path so it can rebuild and compare without touching the checked-in
# artifact -- which is the whole point of a drift check.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
jar_path=${1:-$root/nts-runtime.jar}
out="$root/classes"
rm -rf "$out"
mkdir -p "$out"
find "$root/src" -name '*.java' | sort > "$out/sources.txt"
javac --release 8 -Xlint:-options -d "$out" @"$out/sources.txt"
rm -f "$out/sources.txt"
(
  cd "$out"
  find . -name '*.class' | sed 's|^\./||' | sort > /tmp/nts-jvm-classes.$$
  jar --create --file "$jar_path" \
      --date=2020-01-01T00:00:00Z \
      $(cat /tmp/nts-jvm-classes.$$)
  rm -f /tmp/nts-jvm-classes.$$
)
rm -rf "$out"
echo "built $jar_path"
