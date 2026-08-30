#!/bin/sh
# Everything a fresh clone needs before anything can be measured.
#
#   tooling/bootstrap/bootstrap.sh          # the parts the gate needs
#   tooling/bootstrap/bootstrap.sh --all    # and the optional corpora
#
# Each step says why it exists and each is skipped when already done, so this
# is safe to re-run and is the fastest way to find out what is missing.
#
# The optional clones are somebody else's repositories rather than vendored
# code, and the tools that use them skip gracefully when they are absent -- so
# `--all` is for the machine that runs conformance and benchmarks, not for one
# that only needs the gate green.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$root"

all=false
[ "${1:-}" = "--all" ] && all=true

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
have() { [ -e "$1" ]; }

# ---------------------------------------------------------------- the frontend
#
# `typescript-go` is a real submodule, and the *only* one. Cloning it
# recursively pulls microsoft/TypeScript as well -- that is typescript-go's own
# test fixture repository, it is enormous, and nothing here needs it.
say "typescript-go (submodule)"
if have third_party/typescript-go/go.mod; then
  echo "  already checked out"
else
  git submodule update --init third_party/typescript-go
fi

# The binary every other step depends on: `nts` shells out to it for the
# semantic snapshot, and finds it at target/tsgo unless NTS_TSGO says otherwise.
say "target/tsgo"
if have target/tsgo && [ target/tsgo -nt third_party/typescript-go/go.mod ]; then
  echo "  already built"
else
  command -v go >/dev/null || { echo "  need a Go toolchain"; exit 1; }
  (cd third_party/typescript-go && go build -o ../../target/tsgo ./cmd/tsgo)
  echo "  built"
fi

# ------------------------------------------------------------------- packages
#
# `examples/library` resolves a workspace dependency, and without this it fails
# to typecheck rather than failing to agree -- which reads like a compiler bug.
say "node_modules"
if have node_modules/.modules.yaml; then
  echo "  already installed"
else
  command -v pnpm >/dev/null || { echo "  need pnpm"; exit 1; }
  pnpm install --silent
fi

say "cargo build"
cargo build --release

if [ "$all" = false ]; then
  say "done"
  echo "  Optional corpora were skipped. Re-run with --all for:"
  echo "    third_party/node               the Node compatibility profile and conformance"
  echo "    third_party/test262            the numeric conformance slice"
  echo "    third_party/are-we-fast-yet    the benchmark fidelity gate"
  exit 0
fi

# --------------------------------------------------------- the optional clones
#
# Sparse and shallow throughout: what is wanted from each is a fraction of it.
clone_sparse() {
  path=$1 url=$2 branch=$3
  shift 3
  if have "$path/.git"; then
    echo "  already cloned"
  else
    if [ -n "$branch" ]; then
      git clone --depth 1 --filter=blob:none --sparse --branch "$branch" "$url" "$path"
    else
      git clone --depth 1 --filter=blob:none --sparse "$url" "$path"
    fi
  fi
  (cd "$path" && git sparse-checkout set "$@")
}

# `lib` is the profile in `runtime/node`'s image; `test` is what the node
# conformance runner in tooling/conformance reads.
say "third_party/node (lib, test)"
clone_sparse third_party/node https://github.com/nodejs/node.git v24.20.0 lib test

# Cloned whole rather than sparsely, deliberately: `harness/` and
# `INTERPRETING.md` matter as much as the tests, because the frontmatter is
# what makes the suite filterable at all.
say "third_party/test262"
if have third_party/test262/.git; then
  echo "  already cloned"
else
  git clone --depth 1 --filter=blob:none https://github.com/tc39/test262.git third_party/test262
fi

# The fidelity gate -- running their `.js` and our `.ts` on node and comparing
# -- plus the reference C++ column.
say "third_party/are-we-fast-yet"
clone_sparse third_party/are-we-fast-yet https://github.com/smarr/are-we-fast-yet "" \
  benchmarks/JavaScript 'benchmarks/C++' docs

say "done"
