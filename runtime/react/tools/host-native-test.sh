#!/usr/bin/env bash
set -euo pipefail

experiment_root=$(cd "$(dirname "$0")/.." && pwd)
workspace_root=$(cd "$experiment_root/../.." && pwd)
project="$experiment_root/host-test/tsconfig.json"
output="$experiment_root/generated/host-native"
c_output="$output/c"
compiler_tmp="$output/tmp"

mkdir -p "$c_output" "$compiler_tmp"
(
  cd "$workspace_root"
  cargo run -q -p nts-cli -- emit-c "$project" --out "$c_output"
)

TMPDIR="$compiler_tmp" cc -std=c11 -O3 -fno-lto -Wno-attributes -I"$c_output" \
  "$c_output/program.c" \
  "$c_output/nts_runtime.c" \
  "$experiment_root/host-test/native-driver.c" \
  -luv -lm -o "$output/check"
"$output/check"
