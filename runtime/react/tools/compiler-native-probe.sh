#!/usr/bin/env bash
set -euo pipefail

experiment_root="$(cd "$(dirname "$0")/.." && pwd)"
nts_root="$(cd "$experiment_root/../.." && pwd)"
project="$experiment_root/experiments/compiler-output/nts/tsconfig.json"
output="$experiment_root/generated/compiler-output/backends"
mkdir -p "$output"

run_nts() {
  TMPDIR="$output" cargo run --manifest-path "$nts_root/Cargo.toml" -q -p nts-cli -- "$@"
}

run_nts hir "$project" >"$output/counter.hir.txt" 2>"$output/hir.stderr"
run_nts emit-c "$project" >"$output/counter.c" 2>"$output/c.stderr"
run_nts emit-llvm "$project" >"$output/counter.ll" 2>"$output/llvm.stderr"
run_nts emit-jvm "$project" --text >"$output/counter.jvm.txt" 2>"$output/jvm.stderr"

hir_functions="$(grep -c '^\(export \)\?func ' "$output/counter.hir.txt" || true)"
llvm_functions="$(grep -c '^define ' "$output/counter.ll" || true)"
jvm_methods="$(grep -c '^  method ' "$output/counter.jvm.txt" || true)"
printf 'React Compiler native probe: HIR functions=%s, LLVM definitions=%s, JVM methods=%s\n' \
  "$hir_functions" "$llvm_functions" "$jvm_methods"
if [[ -s "$output/c.stderr" ]]; then
  cat "$output/c.stderr"
fi
