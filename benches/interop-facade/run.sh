#!/bin/sh
# Does the instance forwarder cost anything? Skips loudly without a JDK.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
command -v javac > /dev/null 2>&1 || { echo "SKIP interop-facade: no javac"; exit 0; }
out="$here/target"; rm -rf "$out"; mkdir -p "$out"
javac --release 8 -Xlint:all,-options -d "$out" "$root/benches/common/Bench.java" "$here/Facade.java"
java -cp "$out" Facade "$@"
