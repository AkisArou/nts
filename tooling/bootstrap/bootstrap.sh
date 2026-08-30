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

# ------------------------------------------------------------- node's headers
#
# The addon the conformance harness builds is loaded into a node process and
# calls `uv_*` directly. libuv is not ABI-stable and node bundles a specific
# copy, so `uv_fs_t` has to have the layout node's own libuv was built with --
# and matching that by happening to have the same libuv installed system-wide
# is a coincidence rather than a guarantee. On this machine both are 1.52.1,
# which is Arch keeping them in step and not something to rely on.
#
# Node-API is a different case: it is ABI-stable by design, so `node_api.h` from
# any recent source would do. They are fetched together anyway, because the
# official headers tarball is one download that carries both and they agree with
# each other by construction. It is what node-gyp reaches for, for this reason.
#
# The version comes from `.tool-versions`, which asdf reads too -- so the
# headers and the binary that loads them are pinned by one line rather than two.
say "third_party/node-headers"
want=$node_pin
if [ -z "$want" ]; then
  echo "  no nodejs pin in .tool-versions; skipped"
elif have third_party/node-headers/include/node/uv.h; then
  echo "  already fetched (v$want)"
elif ! command -v curl >/dev/null; then
  echo "  need curl"
else
  url="https://nodejs.org/download/release/v$want/node-v$want-headers.tar.gz"
  tmp=$(mktemp -d)
  if curl -sSfL --max-time 300 "$url" -o "$tmp/headers.tar.gz"; then
    tar xzf "$tmp/headers.tar.gz" -C "$tmp"
    rm -rf third_party/node-headers
    mkdir -p third_party/node-headers
    mv "$tmp/node-v$want/include" third_party/node-headers/include
    echo "  fetched v$want"
  else
    echo "  could not fetch $url"
  fi
  rm -rf "$tmp"
fi
# The headers only match the binary that loads the addon. Said rather than
# assumed, because the failure it prevents is a struct layout disagreeing at
# run time, which does not look like a version problem when it happens.
running=$(node -p 'process.versions.node' 2>/dev/null || true)
if [ -n "$running" ] && [ -n "$want" ] && [ "$running" != "$want" ]; then
  echo "  note: node in PATH is v$running but the pin is v$want"
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
say "third_party/node (lib, test)  v$node_pin"
clone_sparse third_party/node https://github.com/nodejs/node.git "v$node_pin" lib test
# `clone_sparse` leaves an existing checkout alone, which is right for a clone
# that takes minutes and wrong for a *version* -- so the tag is checked rather
# than assumed. Reported rather than repaired: moving it is a fetch, and doing
# that silently under someone mid-task is worse than telling them.
at=$(git -C third_party/node describe --tags --exact-match 2>/dev/null || echo "unknown")
if [ "$at" != "v$node_pin" ]; then
  echo "  note: checked out at $at, pin is v$node_pin"
  echo "        git -C third_party/node fetch --depth 1 origin tag v$node_pin && git -C third_party/node checkout v$node_pin"
fi

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
