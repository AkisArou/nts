#!/bin/sh
# Prove a Java test can fail, without breaking the tree while it runs.
#
#     sh tooling/jvm/sabotage.sh <edit-script-file> <driver> [args...]
#
# `<edit-script-file>` is a script run with `$src` set to a **copy** of
# `runtime/jvm/src`; it edits that copy. A file rather than an inline argument
# because these edits are multi-line replacements of Java source, and passing
# those through two levels of shell quoting is its own source of wrong answers.
# `<driver>` is a class under `compiler/codegen/jvm/tests/**`.
#
# # Why a copy
#
# Sabotage is how both halves of a test get proved: change the runtime, watch
# the suite go red, change it back. Done in place, the shared checkout holds
# **wrong source** for as long as the cycle takes, and three sessions build from
# it. `git status` shows the file modified for a few seconds and clean
# afterwards, so the window is nearly invisible -- and what comes out of it is a
# correct-looking tree that produced a wrong binary.
#
# That cost an hour today from the other direction: a sabotaged compiler left at
# `target/release/nts` while the source that built it was already restored. A
# private build directory fixes the artifact and not the source. Copying fixes
# both, for about four hundred kilobytes.
#
# Same shape as seven test binaries reading a jar being rewritten under them,
# one layer up: a shared mutable thing, read by something that assumed it was
# stable. That one was found by another session losing a run to it, and so was
# this.
set -e

edit=$1
driver=$2
if [ -z "$edit" ] || [ -z "$driver" ]; then
  echo "usage: sabotage.sh <edit-script-file> <driver> [args...]" >&2
  exit 2
fi
[ -r "$edit" ] || { echo "no such edit script: $edit" >&2; exit 2; }
shift 2

here=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

src=$work/src
cp -r "$here/runtime/jvm/src" "$src"

# The edit runs against the copy. `$src` is the only thing it may touch.
export src
sh "$edit"

mkdir -p "$work/rt" "$work/test"
javac --release 8 -Xlint:-options -d "$work/rt" "$src"/nts/rt/*.java

found=$(find "$here/compiler/codegen/jvm/tests" -name "$driver.java" | head -1)
[ -n "$found" ] || { echo "no driver named $driver" >&2; exit 2; }
javac --release 8 -Xlint:-options -cp "$work/rt" -d "$work/test" "$found"

java -Xverify:all -cp "$work/rt:$work/test" "$driver" "$@"
