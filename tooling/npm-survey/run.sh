#!/usr/bin/env bash
# The whole survey, in the order the stages depend on each other.
#
# Every stage caches to disk, so a re-run costs nothing until the cache is
# deleted. `meta/` and `tars/` hold the registry's answers, and keeping them is
# what makes a number in `docs/npm-deps.md` re-derivable rather than
# re-measured against an ecosystem that has moved underneath it.
#
# TypeScript, run directly: node 24 strips types with no flag and no build step.
# The last stage runs the compiler, so it needs a built one:
#   cargo build --release -p nts-cli   (or point NTS_BIN at one)
set -euo pipefail
cd "$(dirname "$0")"

export NTS_BIN="${NTS_BIN:-../../target/release/nts}"
export NTS_TSGO="${NTS_TSGO:-../../target/tsgo}"

node resolve.ts "$(tr -d '\n' < roots.json)"   # roots     -> closure.json
node classify.ts                               # closure   -> classified.json, and the tables
node vendor.ts                                 # tarballs  -> vendored/
node verdict.ts                                # vendored/ -> verdict.json
