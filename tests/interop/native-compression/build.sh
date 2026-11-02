#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-native-compression"}
exec node "$root/tests/interop/native-compression/verify.ts" "$out"
