#!/usr/bin/env bash
# Per-module root refusals, split into the module's own source and its cone.
#
#   tooling/conformance/own-refusals.sh "$PWD" /tmp/scratch /tmp/scratch/nts
#
# A cone-wide count is not a per-module one, and the gap is not small:
# `querystring` reports 78 roots and owns 3. `string_decoder` reports 74 and
# owns none at all -- every refusal standing between it and a published export
# belongs to a module it imports.
#
# Only NTS1001 is counted. NTS1003 is cascade: of querystring's 151, 149 say
# "calls X, which was refused above", so counting them measures how far a root
# propagates rather than how many roots there are.
#
# Copy the compiler to a scratch path and pass it as $3 -- never the live
# `target/release/nts`, which another session may be rebuilding underneath.
root="${1:?usage: own-refusals.sh <repo-root> <scratch-dir> <nts-binary>}"; scratch="${2:?}"; bin="${3:?}"
cd "$root"
printf '%-22s %8s %8s   %s\n' module own cone "first own-source refusal"
for m in $(ls runtime/node | grep -v '^node_modules$' | sort); do
  [ -f "runtime/node/$m/tsconfig.json" ] || continue
  log="$scratch/refusals-$m.txt"
  NTS_TSGO="$root/target/tsgo" "$bin" emit-c "runtime/node/$m/tsconfig.json" \
    --out "$scratch/emit-$m" --napi > "$log" 2>&1 || true
  own=$(grep -E 'NTS1001' "$log" | grep -c "runtime/node/$m/src" || true)
  cone=$(grep -cE 'NTS1001' "$log" || true)
  first=$(grep -E 'NTS1001' "$log" | grep "runtime/node/$m/src" | head -1 | sed "s|.*NTS1001 ||" | cut -c1-58)
  printf '%-22s %8s %8s   %s\n' "$m" "$own" "$cone" "$first"
done
