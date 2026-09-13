#!/bin/sh
# Emit the TypeScript, check the published API against the checked-in capture,
# then compile and run a plain Java consumer against it.
#
# Unlike java-from-ts, everything here works today.
#
# Skips loudly without a JDK or tsgo: a skip that prints nothing is
# indistinguishable from a pass.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../.." && pwd)

if ! command -v javac > /dev/null 2>&1; then
  echo "SKIP ts-from-java: no javac on PATH"
  exit 0
fi
nts=${NTS_BIN:-$root/target-jvm/release/nts}
if [ ! -x "$nts" ]; then
  echo "SKIP ts-from-java: no nts binary at $nts"
  exit 0
fi

classes="$here/target/classes"
rm -rf "$here/target"
mkdir -p "$classes" "$here/target/java"

NTS_TSGO="${NTS_TSGO:-$root/target/tsgo}" "$nts" emit-jvm "$here/tsconfig.json" --out "$classes" > /dev/null

# The published API, as Java sees it. `nts/gen` only -- the consumer's own
# class is not part of what we publish.
capture="$here/target/Api.javap"
{
  echo "// Captured from the emitted class files by build.sh. Checked in as a guard:"
  echo "// the day a generated field goes back to \`public\`, this diff says so out loud."
  echo "// Regenerate with NTS_REGENERATE=1 ./build.sh"
  echo
  for c in $(find "$classes/nts/gen" -name '*.class' | sort); do
    n=$(echo "$c" | sed "s|$classes/||; s|/|.|g; s|\.class\$||")
    javap -p -cp "$classes" "$n"
  done
} > "$capture"

if [ "${NTS_REGENERATE:-}" = "1" ]; then
  cp "$capture" "$here/expected/Api.javap"
  echo "regenerated expected/Api.javap"
elif ! diff -u "$here/expected/Api.javap" "$capture"; then
  echo
  echo "the published Java API changed. If that was intended, NTS_REGENERATE=1 ./build.sh"
  exit 1
fi

javac --release 8 -Xlint:all,-options -cp "$classes:$classes/nts-runtime.jar" \
  -d "$here/target/java" "$here"/java/Main.java
java -Xverify:all -cp "$here/target/java:$classes:$classes/nts-runtime.jar" Main
