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
  --out "$D/out" --main >/dev/null 2>"$D/r.txt" && es=0 || es=$?
# **The compiler crashing is its own outcome.** It was reported as `C DID NOT
# COMPILE` -- the output directory is simply absent, and `cc` fails the same way
# for a missing file as for a bad one, so "the compiler did not survive" and "the
# C is wrong" arrived as one line. A module-scope `switch` assigning a global
# panicked `lower_switch` and read as a toolchain problem.
if grep -q "^thread '.*panicked at" "$D/r.txt"; then
  printf '  %-34s node=%s  COMPILER PANIC %s\n' "$label" "$ns" \
    "$(grep -m1 -A1 "panicked at" "$D/r.txt" | tail -1 | cut -c1-30)"
  exit 0
fi
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
# **A backend decline is not a lowering refusal**, and this only looked for the
# second. `NTS2008` -- a value the C backend cannot erase yet -- leaves the HIR
# pronounced well by `nts hir` and drops a body afterwards, so the emit wrote
# some files and not others and the line below said `C DID NOT COMPILE`. That is
# a true sentence about `cc` and a false one about the program: nothing was
# wrong with the C, there was none of it to compile.
if grep -q 'NTS2[0-9][0-9][0-9]' "$D/r.txt"; then
  printf '  %-34s node=%s  DECLINED %s\n' "$label" "$ns" \
    "$(grep -m1 -o 'NTS2[0-9][0-9][0-9] .*' "$D/r.txt" | cut -c9-46)"
  exit 0
fi
# And anything else that made `emit-c` exit non-zero. It used to exit 0 for every
# refusal, so `|| true` above lost nothing; it now fails a standalone build whose
# module initialiser a backend declined, and swallowing that reported the
# *toolchain* as the problem.
if [ "$es" -ne 0 ]; then
  printf '  %-34s node=%s  EMIT FAILED (%s) %s\n' "$label" "$ns" "$es" \
    "$(tail -1 "$D/r.txt" | cut -c1-38)"
  exit 0
fi
# **Every `.c` the emitter wrote, not a list of the ones it used to write.**
#
# This named four files -- `main.c program.c nts_runtime.c nts_uv_host.c` --
# and the emitter also writes `nts_unicode.c`, which holds `nts_str_to_lower_case`
# and its neighbours. So any probe touching `toUpperCase` or `toLowerCase`
# failed to *link* and was reported as `C DID NOT COMPILE`: a false failure
# naming the compiler for a gap in this line. Found on 2026-09-21 by a
# generated-expression fuzzer whose first working run reported fifteen
# "compiler bugs", every one of them this.
#
# A hardcoded list is a second derivation of "what does the emitter produce",
# and the emitter is the one that knows. `*.c` asks it.
( cd "$D/out" && cc -std=c11 -O2 -I. *.c -luv -lm -o program ) 2>/dev/null || true
if [ ! -f "$D/out/program.c" ]; then
  printf '  %-34s node=%s  NO C WAS WRITTEN\n' "$label" "$ns"
  exit 0
fi
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
