#!/bin/sh
# Can `d8` spell everything this backend emits?
#
#     sh tooling/android/dexes.sh              # every example and bench case
#     sh tooling/android/dexes.sh symbol-keys  # named ones
#
# # Why this exists beside two ratchets that already run d8
#
# `d8_accepts_the_runtime_jar` dexes the runtime, which is hand-written Java --
# so it can only ever fail if a person writes something d8 refuses, and no
# person has. `agrees-on-device.sh` dexes the sixty bench cases, which is where
# `__@kCount@2` was finally caught, but it needs an emulator and so is not
# something that runs on the way past.
#
# Neither had ever dexed an *example*, and there are 137 of them against 60
# cases. That is the larger half of the corpus and the half with the odd
# programs in it. This script needs no device: `d8` is a compiler, and whether
# it accepts a class file is a question about the class file.
#
# # What it found the day it was written
#
# Nothing in the corpus -- the two defects it is a ratchet for were both found
# by asking the *rule* instead (`dex_can_spell` over every mangled ASCII name,
# and the duplicate-field refusal), each from a four-line program no corpus
# contains. That is the right order and it is worth saying rather than
# implying: a sweep tells you about the sweep, and this one is here to keep a
# fix from rotting, not to have found the bug.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
work=${TMPDIR:-/tmp}/nts-dex.$$
sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}

[ -n "$sdk" ] || { echo "SKIP: no ANDROID_HOME" >&2; exit 0; }
tools=$(ls -d "$sdk"/build-tools/* 2>/dev/null | sort -V | tail -1)
[ -n "$tools" ] || { echo "SKIP: no build-tools" >&2; exit 0; }
[ -x "$tools/d8" ] || { echo "SKIP: no d8 in $tools" >&2; exit 0; }

nts=${NTS_BIN:-$root/target-jvm/release/nts}
[ -x "$nts" ] || { echo "no nts at $nts -- set NTS_BIN" >&2; exit 1; }

mkdir -p "$work"
trap 'rm -rf "$work"' EXIT INT TERM

if [ $# -gt 0 ]; then
  targets=""
  for name in "$@"; do
    if [ -d "$root/benches/cases/$name" ]; then targets="$targets benches/cases/$name"
    elif [ -d "$root/examples/$name" ]; then targets="$targets examples/$name"
    else echo "no such example or case: $name" >&2; exit 1
    fi
  done
else
  targets=$( (ls -d "$root"/examples/*/ "$root"/benches/cases/*/ 2>/dev/null) \
    | sed "s|^$root/||;s|/$||" | sort)
fi

dexed=0 refused=0 declined=0
for target in $targets; do
  name=$(basename "$target")
  out="$work/$name"
  rm -rf "$out"; mkdir -p "$out/classes" "$out/dex"
  # An example carries its own tsconfig; a bench case does not.
  if [ -f "$root/$target/tsconfig.json" ]; then
    config=$root/$target/tsconfig.json
  else
    config=$out/tsconfig.json
    cat > "$config" <<JSON
{ "extends": "$root/tsconfig.fixtures.json", "include": ["$root/$target"] }
JSON
  fi
  if ! NTS_TSGO=${NTS_TSGO:-$root/target/tsgo} "$nts" emit-jvm "$config" \
       --out "$out/classes" > "$out/emit.log" 2>&1; then
    # A refusal is this backend working. It is counted, not failed: the corpus
    # has programs every backend declines, and a lane that reported those as
    # dex failures would be measuring the wrong thing.
    declined=$((declined + 1))
    continue
  fi
  classes=$(find "$out/classes" -name '*.class' 2>/dev/null)
  [ -n "$classes" ] || { declined=$((declined + 1)); continue; }
  # The generated classes only. The runtime jar has its own ratchet and
  # including it here would make every failure ambiguous about which half of
  # the artefact d8 refused.
  # shellcheck disable=SC2086
  if "$tools/d8" --min-api 29 --lib "$out/classes/nts-runtime.jar" \
       --output "$out/dex" $classes > "$out/d8.log" 2>&1; then
    dexed=$((dexed + 1))
  else
    refused=$((refused + 1))
    printf "%-28s d8 refused it\n" "$name"
    sed -n '1,3p' "$out/d8.log" | sed 's/^/    /'
  fi
done

printf "\n%s dexed, %s refused, %s declined by the backend\n" "$dexed" "$refused" "$declined"
[ "$refused" -eq 0 ] || exit 1
