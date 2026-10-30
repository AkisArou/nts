#!/bin/sh
# nts-gate-capabilities: jvm
# Emit the TypeScript, check the published API against the checked-in capture,
# then compile and run a plain Java consumer against it.
#
# Unlike java-from-ts, everything here works today.
#
# Skips loudly without a JDK or nts binary: a skip that prints nothing is
# indistinguishable from a pass.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../.." && pwd)
nts_jvm_flags=$(cat "$root/runtime/jvm/test-vm-flags.txt")
nts_jdk_flags=$(sed 's/^/-J/' "$root/runtime/jvm/test-vm-flags.txt")
out=${1:-"$root/target/interop-ts-from-java"}
nts=${NTS_BIN:-"$root/target/release/nts"}


if ! command -v javac > /dev/null 2>&1; then
  echo "SKIP ts-from-java: no javac on PATH"
  exit 0
fi
nts=${NTS_BIN:-$root/target-jvm/release/nts}
if [ ! -x "$nts" ]; then
  echo "SKIP ts-from-java: no nts binary at $nts"
  exit 0
fi

rm -rf "$here/target"
mkdir -p "$here/target/java"

# **One command, and it reads `nts.config.ts`.** This was `emit-jvm --out`, which
# is the emitter rather than the build: it says where to put class files and
# nothing about what the product is. The config says `library.jvm`, so the build
# knows the artifact is a jar, which target it is for, and which package the
# classes have to land in -- and refuses if the emitter and the declaration
# disagree about the last one.
#
# Everything below this line is an assertion rather than a build step, which is
# why this file is not a one-line call to `nts build`: the javap capture, the
# consumer, and running it are what the example is *for*.
NTS_CHECKERS=1 "$nts" build "$here/tsconfig.json" \
  --out "$here/target/build" > /dev/null
classes="$here/target/build/api/java-8"

# The published API, as Java sees it. `nts/gen` only -- the consumer's own
# class is not part of what we publish.
capture="$here/target/Api.javap"
{
  echo "// Captured from the emitted class files by build.sh. Checked in as a guard:"
  echo "// the day a generated field goes back to \`public\`, this diff says so out loud."
  echo "// Regenerate with NTS_REGENERATE=1 ./build.sh"
  echo
  # Byte order makes this API record independent of the caller's locale.
  for c in $(find "$classes/nts/gen" -name '*.class' | LC_ALL=C sort); do
    n=$(echo "$c" | sed "s|$classes/||; s|/|.|g; s|\.class\$||")
    javap $nts_jdk_flags -p -cp "$classes" "$n"
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

javac $nts_jdk_flags --release 8 -Xlint:all,-options -cp "$classes:$classes/nts-runtime.jar" \
  -d "$here/target/java" "$here"/java/Main.java
java $nts_jvm_flags -Xverify:all -cp "$here/target/java:$classes:$classes/nts-runtime.jar" Main

# Public source entries remain usable above. Internal generated methods must
# also be hidden from javac even when class-file inspection lists them.
for member in 'answer$nts$uint32' 'echoed$nts$uint32' 'Closure0$erased_call'; do
  case "$member" in
    'answer$nts$uint32') expression="nts.gen.Program.$member()" ;;
    'echoed$nts$uint32') expression="nts.gen.Program.$member(0)" ;;
    'Closure0$erased_call') expression="nts.gen.Program.$member(null, null, null)" ;;
  esac
  cat > "$here/target/Forbidden.java" <<EOF
public final class Forbidden {
  public static void call() { $expression; }
}
EOF
  if javac $nts_jdk_flags --release 8 -Xlint:all,-options \
    -cp "$classes:$classes/nts-runtime.jar" -d "$here/target/java" \
    "$here/target/Forbidden.java" > "$here/target/forbidden.log" 2>&1; then
    echo "ts-from-java: javac accepted internal method $member"
    exit 1
  fi
  if ! grep -F 'cannot find symbol' "$here/target/forbidden.log" > /dev/null \
    || ! grep -F "$member" "$here/target/forbidden.log" > /dev/null; then
    cat "$here/target/forbidden.log"
    echo "ts-from-java: internal-method control did not produce the expected javac refusal"
    exit 1
  fi
  echo "ts-from-java: javac refused internal method $member"
done
