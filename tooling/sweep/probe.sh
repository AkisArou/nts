#!/bin/sh
# One program, two runners: node on the source, and this compiler on the *same*
# source. Compared on exit status and on the message of whatever was thrown.
#
#   sh tooling/sweep/probe.sh <scratch-dir> <label> <body>
#
# # Why this exists beside `sweep.mjs`
#
# `sweep.mjs` generates a cross-product and settles it with `nts check`, whose
# harness drives **exported functions taking and returning scalars**. That is
# the right instrument for operations on values, and it cannot see a whole class
# of program: anything whose subject is a module-scope *statement*.
#
# Two correctness defects landed on 2026-09-18 were exactly that shape --
# `var a = 5; a = 99; var a = 5;` leaving `a` at 99, and `v = 2; var v: number;`
# answering 0 -- and neither is reachable through a scalar-argument export,
# because wrapping the statements in a function changes the construct under
# test. This runs the statements where they are written and asks node.
#
# # What it cannot oracle
#
# **TypeScript-only syntax.** `node --experimental-strip-types` erases types; it
# does not compile `enum`, `namespace`, or parameter properties. A probe using
# one comes back `DISAGREE node=1 nts=0`, which is node refusing the file rather
# than a finding. If an arm reports that, read the node output before believing
# it.
#
# **Anything the harness cannot express.** `assert.sameValue` is overloaded for
# number, string and boolean, so comparing an `undefined` or an object needs a
# different assertion than this file provides.
#
# # Why the thrown message is compared and not just the status
#
# Status alone reports agreement when the two throw for unrelated reasons -- a
# refusal on one side and a failed assertion on the other are both exit 1. A
# check that coarse is how a probe sweep comes back clean about nothing.
set -e
D="$1"; label="$2"; body="$3"
HERE=$(dirname "$0")
mkdir -p "$D/src"
[ -f "$D/tsconfig.json" ] || cat > "$D/tsconfig.json" <<'J'
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "strict": true,
    "noEmit": true
  },
  "include": ["src"]
}
J
{ cat "$HERE/probe-harness.ts"; printf '%s\n' "$body"; } > "$D/src/main.ts"
node --experimental-strip-types "$D/src/main.ts" >/dev/null 2>"$D/node.txt" && ns=0 || ns=$?
nmsg=$(grep -o "message: '[^']*'" "$D/node.txt" | head -1 | cut -d"'" -f2)
rm -rf "$D/out"
NTS_NO_SNAPSHOT_CACHE=1 "${NTS_BIN:-./target/release/nts}" emit-c "$D/tsconfig.json" \
  --out "$D/out" --main >/dev/null 2>"$D/r.txt" || true
# TypeScript first: a program the checker rejects says nothing about lowering.
if grep -q '^TS[0-9]' "$D/r.txt"; then
  printf '  %-34s node=%s  TYPESCRIPT %s\n' "$label" "$ns" "$(grep -m1 -o '^TS[0-9]*' "$D/r.txt")"
  exit 0
fi
# `emit-c` exits 0 while refusing, and prints the refusal on **stderr**.
if grep -q 'NTS100' "$D/r.txt"; then
  printf '  %-34s node=%s  REFUSED %s\n' "$label" "$ns" \
    "$(grep -m1 -o 'NTS100[0-9] .*' "$D/r.txt" | cut -c9-46)"
  exit 0
fi
( cd "$D/out" && cc -std=c11 -O2 -I. main.c program.c nts_runtime.c nts_uv_host.c -luv -lm \
  -o program ) 2>/dev/null || true
if [ ! -x "$D/out/program" ]; then
  printf '  %-34s node=%s  C DID NOT COMPILE\n' "$label" "$ns"
  exit 0
fi
"$D/out/program" >/dev/null 2>"$D/nts.txt" && cs=0 || cs=$?
cmsg=$(sed -n 's/^nts: uncaught [A-Za-z0-9_$]*: //p' "$D/nts.txt" | head -1)
if [ "$ns" != "$cs" ]; then
  printf '  %-34s DISAGREE node=%s nts=%s\n' "$label" "$ns" "$cs"
elif [ "$ns" = "0" ]; then
  printf '  %-34s agree (both pass)\n' "$label"
elif [ "$nmsg" = "$cmsg" ]; then
  printf '  %-34s agree (both threw: %s)\n' "$label" "$nmsg"
else
  printf '  %-34s DISAGREE both threw, node=%s nts=%s\n' "$label" "$nmsg" "$cmsg"
fi
