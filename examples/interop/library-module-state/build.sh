#!/bin/sh
# A library whose module scope has work to do, linked the ordinary way.
#
# The arm that matters is the plain `clang caller.o liblib.a`: no
# `--whole-archive`. Before `tooling/cli` put the `.init_array` constructor in
# `program.c`, that link dropped the member holding it, module evaluation never
# ran, and `total()` read an empty array -- a SIGSEGV or a wrong answer rather
# than a link error.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-library-module-state"}
cc=${CC:-clang}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/library-module-state"
mkdir -p "$out"

"$nts" build "$source/tsconfig.json" --out "$out"
built="$out/lib/linux-gnu-x86_64"

# The constructor must be *in* the archive and reachable without being asked
# for. Both halves are checked: it is not a separate member, and it arrives.
if ar t "$built/liblib.a" | grep -q nts_auto_init; then
  echo "the initialiser is a member of its own again; a plain link will drop it" >&2
  exit 1
fi

"$cc" -std=c11 -O2 -Wall -Wextra -Werror -I"$built" \
  -c "$source/consumer/caller.c" -o "$out/caller.o"
"$cc" "$out/caller.o" "$built/liblib.a" -lm -o "$out/caller"

if ! nm "$out/caller" | grep -q nts_auto_init; then
  echo "the constructor did not survive an ordinary link" >&2
  exit 1
fi

"$out/caller"
