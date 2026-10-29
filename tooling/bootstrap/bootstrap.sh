#!/bin/sh
# Everything a fresh clone needs before anything can be measured.
#
#   tooling/bootstrap/bootstrap.sh             # everything
#   tooling/bootstrap/bootstrap.sh --minimal   # only what the gate needs
#
# Each step says why it exists and each is skipped when already done, so this
# is safe to re-run and is the fastest way to find out what is missing.
#
# The corpora used to be behind `--all`, on the argument that they are somebody
# else's repositories and the tools that read them skip gracefully when absent.
# That is true and it was the wrong default: the node profile is the surface
# almost every measurement in this repo is taken against, so a bootstrap that
# leaves it out produces a machine that builds and cannot measure. `--minimal`
# is there for the case that genuinely only wants a green gate.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$root"

# `--all` stays accepted and means what it always did, which is now the
# default: it is in muscle memory and in the message this script prints.
all=true
[ "${1:-}" = "--minimal" ] && all=false

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
have() { [ -e "$1" ]; }

# A shallow, blobless, sparse clone of somebody else's repository.
#
#   clone_sparse <path> <url> <branch-or-tag> <path>...
#
# Blobless and sparse because these are corpora: we want a few directories out
# of a repository whose history is enormous, and `--filter=blob:none` fetches a
# file's content only when something reads it. An empty branch takes the
# remote's default.
#
# An existing clone is left where it is -- re-cloning node takes minutes and
# the caller checks the tag itself -- but the sparse set is re-applied every
# time, so adding a directory to the list is picked up without a re-clone.
clone_sparse() {
  path=$1 url=$2 branch=$3
  shift 3
  if have "$path/.git"; then
    echo "  already cloned"
  elif [ -n "$branch" ]; then
    git clone --depth 1 --filter=blob:none --sparse --branch "$branch" "$url" "$path"
  else
    git clone --depth 1 --filter=blob:none --sparse "$url" "$path"
  fi
  (cd "$path" && git sparse-checkout set "$@")
}

# The node version, in one place.
#
# `.tool-versions` is asdf's own file, so pinning it there pins the *binary* a
# developer gets as well as everything below -- the sparse checkout of node's
# `lib` and `test`, and the headers the addon is compiled against. Those three
# have to agree: the conformance harness ports from `lib`, runs fixtures from
# `test`, and loads an addon into the binary, so a version skew between any two
# of them is a difference nobody wrote down.
node_pin=$(awk '/^nodejs /{print $2}' "$root/.tool-versions" 2>/dev/null)
[ -n "$node_pin" ] || { echo "no 'nodejs <version>' in .tool-versions" >&2; exit 1; }

# ----------------------------------------------------------------- the machine
#
# The toolchains and instruments around nts, listed in arch-packages.txt so a
# second machine gets the same set. Reported, never installed: installing is the
# person's decision, and nts itself depends on none of them.
say "machine packages (tooling/bootstrap/arch-packages.txt)"
packages="$root/tooling/bootstrap/arch-packages.txt"
if command -v pacman >/dev/null 2>&1; then
  missing=$(awk '!/^#/ && NF && $1 != "manual" { print $1 }' "$packages" | while read -r package; do
    pacman -Q "$package" >/dev/null 2>&1 || printf '%s ' "$package"
  done)
  if [ -n "$missing" ]; then
    echo "  missing: $missing"
    echo "  install: paru -S --needed $missing"
  else
    echo "  all present"
  fi
else
  echo "  not an Arch machine: install the equivalents of the list by hand"
fi
# A JDK is "a Java 21", not one package: asdf provides it on some machines.
java_major=$(java -version 2>&1 | awk -F'"' '/version/ { split($2, v, "."); print v[1]; exit }')
[ "$java_major" = 21 ] || echo "  jdk21: \`java\` is ${java_major:-absent}, not 21 -- see the 'manual jdk21' line of arch-packages.txt"
# hsdis lives in the JDK the JVM backend runs, so it is asked of that JDK.
java_home=$(java -XshowSettings:properties -version 2>&1 | awk -F'= ' '/java.home/ { print $2 }')
if [ -n "$java_home" ] && ! ls "$java_home"/lib/hsdis-*.so >/dev/null 2>&1; then
  echo "  hsdis: not in $java_home/lib -- see the 'manual hsdis' line of arch-packages.txt"
fi

# ------------------------------------------------------------------- packages
#
# `tests/programs/library` resolves a workspace dependency, and without this it fails
# to typecheck rather than failing to agree -- which reads like a compiler bug.
say "node_modules"
if have node_modules/.modules.yaml; then
  echo "  already installed"
else
  command -v pnpm >/dev/null || { echo "  need pnpm"; exit 1; }
  pnpm install --silent
fi

say "pinned Node native dependency sources"
node tooling/bootstrap/node.ts

say "cargo build"
cargo build --release

if [ "$all" = false ]; then
  say "done"
  echo "  Corpora skipped by --minimal. Re-run without it for:"
  echo "    third_party/node               the Node compatibility profile and conformance"
  echo "    third_party/test262            the ECMAScript conformance corpus"
  echo "    third_party/typescript         the native checker's upstream tests"
  echo "    third_party/are-we-fast-yet    the C++ and Java reference columns"
  exit 0
fi

say "third_party/node (lib, test, headers)  v$node_pin"
clone_sparse third_party/node https://github.com/nodejs/node.git "v$node_pin" \
  lib test src deps/uv/include
# `clone_sparse` leaves an existing checkout alone, which is right for a clone
# that takes minutes and wrong for a *version* -- so the tag is checked rather
# than assumed. Reported rather than repaired: moving it is a fetch, and doing
# that silently under someone mid-task is worse than telling them.
at=$(git -C third_party/node describe --tags --exact-match 2>/dev/null || echo "unknown")
if [ "$at" != "v$node_pin" ]; then
  echo "  note: checked out at $at, pin is v$node_pin"
  echo "        git -C third_party/node fetch --depth 1 origin tag v$node_pin && git -C third_party/node checkout v$node_pin"
fi
# The headers only match the binary that loads the addon. Said rather than
# assumed, because the failure it prevents is a struct layout disagreeing at
# run time, which does not look like a version problem when it happens.
running=$(node -p 'process.versions.node' 2>/dev/null || true)
if [ -n "$running" ] && [ "$running" != "$node_pin" ]; then
  echo "  note: node in PATH is v$running but the pin is v$node_pin"
fi

# Cloned whole rather than sparsely, deliberately: `harness/` and
# `INTERPRETING.md` matter as much as the tests, because the frontmatter is
# what makes the suite filterable at all.
#
# **The pin is checked out, and it is read from the one place that decides it.**
# This cloned master and checked nothing out, so a fresh bootstrap landed
# off-pin by construction -- and `discover_suite` refuses a suite that is not at
# `TEST262_PIN` before doing any work, so the whole protocol layer was
# unrunnable on any machine that had not happened to clone it at the right
# moment. It had never run against the corpus it was written for.
#
# Retyping the SHA here would make bootstrap a second derivation of the pin, and
# the drift above was invisible precisely because the pin was spelled in three
# places already.
test262_pin=$(awk -F'"' '/^pub const TEST262_PIN/ { print $2 }' \
  tooling/suite/src/test262_runner/mod.rs)
say "third_party/test262  ${test262_pin}"
if have third_party/test262/.git; then
  # Reported rather than repaired, exactly as the node checkout above: moving it
  # is a fetch, and doing that silently under someone mid-task is worse than
  # telling them. What is new is that it is *checked* at all.
  at=$(git -C third_party/test262 rev-parse HEAD 2>/dev/null || echo unknown)
  if [ "$at" = "$test262_pin" ]; then
    echo "  already cloned, at the pin"
  else
    echo "  note: checked out at ${at}, pin is ${test262_pin}"
    echo "        git -C third_party/test262 fetch --depth 1 origin ${test262_pin} && \\"
    echo "        git -C third_party/test262 checkout --detach ${test262_pin}"
  fi
else
  git clone --filter=blob:none --no-checkout \
    https://github.com/tc39/test262.git third_party/test262
  git -C third_party/test262 checkout --detach "$test262_pin"
fi

say "third_party/typescript (tests only, at the native checker's TypeScript pin)"
node tooling/bootstrap/typescript.ts

# The `C++` and `Java` columns of the benchmark table: their own hand-written
# implementations of the same programs, built and timed by our harness.
#
# `benchmarks/JavaScript` was cloned for a `fidelity.mjs` that ran their `.js`
# beside our `.ts` on node, to check the *port* rather than the result. Nothing
# ever ran it -- no gate step, no test, no CI -- and a check that does not run
# is worse than one that does not exist, because it reads as coverage. It is
# gone, and so is the directory it lived in: the ported benchmarks are now
# inlined into the cases that use them. The two reference columns are what this
# clone is for.
say "third_party/are-we-fast-yet"
clone_sparse third_party/are-we-fast-yet https://github.com/smarr/are-we-fast-yet "" \
  'benchmarks/C++' benchmarks/Java docs

say "done"
