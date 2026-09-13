#!/bin/sh
# Build the Java library this project binds against.
#
# Skips loudly without a JDK: a skip that prints nothing is indistinguishable
# from a pass.
set -eu
here=$(cd "$(dirname "$0")" && pwd)

if ! command -v javac > /dev/null 2>&1; then
  echo "SKIP java-from-ts: no javac on PATH"
  exit 0
fi

out="$here/target"
mkdir -p "$out/classes"
javac --release 8 -Xlint:all,-options -d "$out/classes" "$here"/java/com/example/*.java
jar --create --file "$out/catalog.jar" -C "$out/classes" .
echo "built $out/catalog.jar"

# Once `nts bind` exists this is where it runs, and the .d.ts under types/
# stops being hand-written and starts being checked against this jar:
#
#   nts bind --jar "$out/catalog.jar" --out "$here/types" --overrides "$here/bind.overrides.json"
#
# Until then the declarations are the SPECIFICATION for that generator, which
# is why they are checked in and read rather than produced.
