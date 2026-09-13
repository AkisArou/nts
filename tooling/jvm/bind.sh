#!/bin/sh
# Generate TypeScript declarations and a binding table from a jar.
#
# `docs/jvm-interop.md` has written `nts bind --jar app.jar --out types/` since
# the first draft and there is no such subcommand -- the generator is an example
# binary that takes a *directory* of class files, because `nts-jvm-emitter`
# deliberately has no zip dependency and unpacking is the caller's job.
#
# This is the caller. It is not a substitute for the subcommand and does not
# pretend to be one: `tooling/cli` is where that belongs and is not this lane's
# to write. What it does is make the documented workflow real, in one place,
# instead of leaving every reader to reconstruct the `cargo run --example`
# invocation and the `jar --extract` in front of it.
#
#   tooling/jvm/bind.sh --jar app.jar --package com.example --out types/
#   tooling/jvm/bind.sh --classes out/classes --package com.example --out types/
#
# Writes <out>/<package>.d.ts and <out>/<package>.bind. The second is the half
# the compiler reads: a `.d.ts` says `drawText` takes a string and says nothing
# about which of four overloads to invoke.
set -eu

jar=""; classes=""; package=""; out=""; prelude=""
while [ $# -gt 0 ]; do
  case "$1" in
    --jar)     jar=${2:?--jar needs a path};     shift 2 ;;
    --classes) classes=${2:?--classes needs a path}; shift 2 ;;
    --package) package=${2:?--package needs a name}; shift 2 ;;
    --out)     out=${2:?--out needs a directory}; shift 2 ;;
    # A global `declare namespace java.util` rather than an ambient
    # `declare module "java:java.util"`. Bindings reach the prelude with no
    # import, which is why `java.util.List` reads as it does in Java.
    --prelude) prelude=1; shift ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    # **Refused rather than ignored.** An argument that silently does nothing is
    # indistinguishable from the thing it configures being broken -- which cost
    # somebody an hour on `emit-jvm -o` in this repository, twice.
    *) echo "bind.sh: unknown argument \`$1\`" >&2; exit 2 ;;
  esac
done

[ -n "$package" ] || { echo "bind.sh: --package is required" >&2; exit 2; }
[ -n "$out" ]     || { echo "bind.sh: --out is required" >&2; exit 2; }
if [ -n "$jar" ] && [ -n "$classes" ]; then
  echo "bind.sh: give --jar or --classes, not both" >&2; exit 2
fi
[ -n "$jar" ] || [ -n "$classes" ] || { echo "bind.sh: --jar or --classes is required" >&2; exit 2; }

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)

if [ -n "$jar" ]; then
  [ -f "$jar" ] || { echo "bind.sh: no such jar: $jar" >&2; exit 1; }
  command -v jar > /dev/null 2>&1 || { echo "SKIP bind.sh: no \`jar\` on PATH"; exit 0; }
  classes=$(mktemp -d "${TMPDIR:-/tmp}/nts-bind-XXXXXX")
  trap 'rm -rf "$classes"' EXIT INT TERM
  # Only the package asked for. A jar of the Android SDK is 60k classes and
  # binding all of them is neither wanted nor affordable; the transitive closure
  # is `hir::reachable`'s question and is not answered here.
  ( cd "$classes" && jar --extract --file "$(cd "$(dirname "$jar")" && pwd)/$(basename "$jar")" \
      "$(printf '%s' "$package" | tr '.' '/')" )
fi

[ -d "$classes" ] || { echo "bind.sh: no such directory: $classes" >&2; exit 1; }

# Every class of the package, as binary names. Not a recursive sweep: a nested
# class is `Outer$Inner` in the same directory, and a *sub*-package is a
# different module with its own declaration file.
dir=$(printf '%s' "$package" | tr '.' '/')
set -- $(cd "$classes" && find "$dir" -maxdepth 1 -name '*.class' 2>/dev/null | sed 's/\.class$//' | sort)
[ $# -gt 0 ] || { echo "bind.sh: no classes under $classes/$dir" >&2; exit 1; }

mkdir -p "$out"

# **Exported rather than written as an assignment prefix.** `${prelude:+VAR=1}`
# in front of a command does not make an assignment: the shell expands it to a
# word and then tries to run it, which is `NTS_BIND_PRELUDE=1: command not
# found`. An assignment prefix has to be literal.
if [ -n "$prelude" ]; then
  NTS_BIND_PRELUDE=1
  export NTS_BIND_PRELUDE
fi
( cd "$root" && CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-target-jvm}" \
    cargo run --release -q \
    -p nts-jvm-emitter --example bind -- "$classes" "$package" "$@" ) > "$out/$package.d.ts"
( cd "$root" && CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-target-jvm}" NTS_BIND_TABLE=1 \
    cargo run --release -q \
    -p nts-jvm-emitter --example bind -- "$classes" "$package" "$@" ) > "$out/$package.bind"

echo "bind.sh: $# class(es) -> $out/$package.d.ts and $out/$package.bind"
