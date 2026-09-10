#!/usr/bin/env bash
set -euo pipefail

experiment_root=$(cd "$(dirname "$0")/.." && pwd)
workspace_root=$(cd "$experiment_root/../.." && pwd)
project="$experiment_root/experiments/representation/tsconfig.json"
output="$experiment_root/generated/representation"
c_output="$output/c"
compiler_tmp="$output/tmp"

mkdir -p "$output"
mkdir -p "$c_output"
mkdir -p "$compiler_tmp"

(
  cd "$workspace_root"
  cargo run -q -p nts-cli -- emit-c "$project" >"$output/program.c"
  cargo run -q -p nts-cli -- emit-llvm "$project" >"$output/program.ll"
  cargo run -q -p nts-cli -- emit-jvm "$project" --text >"$output/program.jvm.txt"
  cargo run -q -p nts-cli -- hir "$project" >"$output/program.hir.txt"
  cargo run -q -p nts-cli -- layouts "$project" >"$output/layouts.txt"
  cargo run -q -p nts-cli -- erasure "$project" --sites >"$output/erasure.txt"
  cargo run -q -p nts-cli -- emit-c "$project" --out "$c_output"
)

TMPDIR="$compiler_tmp" cc -std=c11 -O3 -fno-lto -Wno-attributes -I"$c_output" \
  "$c_output/program.c" \
  "$c_output/nts_runtime.c" \
  "$experiment_root/experiments/representation/bench.c" \
  -luv -lm -o "$output/bench"
TMPDIR="$compiler_tmp" cc -std=c11 -O3 -fno-lto -Wno-attributes -I"$c_output" -S \
  "$c_output/program.c" -o "$output/program.s"
"$output/bench" >"$output/bench.csv"

echo "wrote generated/representation/program.c"
echo "wrote generated/representation/program.ll"
echo "wrote generated/representation/program.jvm.txt"
echo "wrote generated/representation/program.hir.txt"
echo "wrote generated/representation/layouts.txt"
echo "wrote generated/representation/erasure.txt"
echo "wrote generated/representation/program.s"
echo "wrote generated/representation/bench.csv"
