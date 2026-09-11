#!/usr/bin/env bash
# Compile one `runtime/node` module into a `.node` addon.
#
#   tooling/conformance/build.sh path            → target/node/path.node
#
# Emits C plus the Node-API wrapper, then links them with the module's native
# layer and libuv. Node loads the result; nothing an addon needs enters a
# shipped binary, and a shipped binary still links no engine.
set -euo pipefail

module="${1:?usage: build.sh <module>}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
src="$root/runtime/node/$module"
# `target/node` is shared with the other sessions in this tree, and a
# measurement that reads it is reading whatever they last wrote.
#
# On 2026-09-09 a 22-module axis run reported `buffer 0 passed` and a re-run
# minutes later, same binary and same md5, reported `1 passed`. Another
# session was part-way through its own rebuild sweep -- fs at 14:02:01, http
# at 14:02:26, net at 14:02:49, path at 14:02:58, alphabetical, while my run
# was reading the same directory. Nothing in my scripts could tell.
#
# `NTS_ADDON_OUT` gives a run its own directory, so the artifact measured is
# the artifact built. The default is unchanged, so every existing caller and
# every other lane behaves exactly as before -- this is the addon half of the
# rule that already exists for the compiler: copy it and pass `NTS_BIN`.
# `NTS_CONFORMANCE_OUT` as well, because it was here first and did not work.
# `build-floor.sh:130` reads `${NTS_CONFORMANCE_OUT:-$PWD/target/node}` and then
# looks for `$out_dir/$module.node` -- but this script wrote to `target/node`
# unconditionally, so setting that variable made the floor search a directory
# nothing writes to and report every module as failing to load. One concept with
# two names is worse than either; both resolve here, `NTS_ADDON_OUT` first.
#
# Controlled after the fact, since it shipped with the claim read off the code
# rather than demonstrated. At `dc3a2fb9` this line was
# `out="${NTS_ADDON_OUT:-$root/target/node}"` and `build-floor.sh:130` was
# `out_dir=${NTS_CONFORMANCE_OUT:-$PWD/target/node}` -- so setting that variable
# sent the writer to `target/node` and the reader somewhere else. With this
# line, `NTS_CONFORMANCE_OUT=<dir> build.sh punycode` puts `punycode.node` in
# `<dir>`, which is where the floor looks.
out="${NTS_ADDON_OUT:-${NTS_CONFORMANCE_OUT:-$root/target/node}}"
work="$out/$module.build"

[ -d "$src" ] || { echo "no such module: runtime/node/$module" >&2; exit 2; }

# Node's headers are a build dependency of the *test harness*, not of anything
# we ship.
#
# `third_party/node/src` first, because it is the only candidate that is
# *pinned*: the clone is at the tag in `.tool-versions`, so `node_api.h` there
# and `deps/uv/include/uv.h` beside it are the same commit as the `lib` being
# ported. `node-api-headers` does not carry `uv.h` at all, which is how the
# system one used to get in -- and libuv is not ABI-stable, so a version match
# by luck is what that was.
napi="${NTS_NAPI_INCLUDE:-}"
if [ -z "$napi" ]; then
  for candidate in \
    "$root/third_party/node/src" \
    "$root/node_modules/node-api-headers/include" \
    "/tmp/napi-hdrs/node_modules/node-api-headers/include" \
    "/usr/include/node"; do
    [ -f "$candidate/node_api.h" ] && napi="$candidate" && break
  done
fi
[ -n "$napi" ] || { echo "no node_api.h; run tooling/bootstrap/bootstrap.sh, or set NTS_NAPI_INCLUDE" >&2; exit 2; }

# libuv's headers, a separate directory and a separate dependency: Node-API is
# ABI-stable by design and libuv is not, so this is the one that has to match
# the running binary exactly.
#
uv_include="${NTS_UV_INCLUDE:-$root/third_party/node/deps/uv/include}"
[ -f "$uv_include/uv.h" ] || {
  echo "no pinned uv.h at $uv_include; run tooling/bootstrap/bootstrap.sh, or set NTS_UV_INCLUDE" >&2
  exit 2
}

mkdir -p "$work" "$out"
# `NTS_BIN` as well as `NTS_COMPILER`, because both are in circulation and only
# one of them used to work here.
#
# `build-floor.sh` accepts either and passes `NTS_COMPILER` down, so a floor run
# was always pinned. A *direct* call written `NTS_BIN=<pin> build.sh <module>`
# was not: the variable was ignored and the live `target/release/nts` used
# instead, silently and with no way to tell from the output.
#
# That cost a whole attribution on 2026-09-09. `os` had regressed, and the
# control -- build it with four older pinned binaries -- reported that every one
# of them failed too, which said the regression was not the compiler's. All four
# runs had used the same live binary. With the variable honoured, `445ea94b`
# builds `os` and `fc0df644` does not, which is the opposite conclusion.
#
# A pin that is silently ignored is worse than no pin: it produces a control that
# looks run and is not.
compiler="${NTS_COMPILER:-${NTS_BIN:-$root/target/release/nts}}"
[ -x "$compiler" ] || {
  echo "no compiler at $compiler; the compiler session must build it" >&2
  exit 2
}
# The counted provider, as one switch rather than two.
#
# `NTS_CONFORMANCE_RC=1` selects reference counting, and it sets *both* halves
# because either alone is incoherent. `tooling/differential` puts it best: "the
# provider decides what the compiler emits, not only what the runtime does with
# it, so selecting one without the other compares a program that never releases
# against an allocator that expects it to." `--rc` alone emits retains and
# releases against a bump allocator that never frees, where a release too few
# leaks unseen and a release too many is never observed. `-DNTS_PROVIDER_RC`
# alone gives an allocator expecting counts from code that emits none.
#
# `-DNTS_POISON=1` rides along, because under the default provider an unwritten
# or freed slot reads as exactly zero and is indistinguishable from a legitimate
# zero, while under poison it reads `a5d03c3c3c3c3c3c`.
#
# There is an `NTS_RC` in this repository and it is *not* this: it is read only
# by `tooling/differential`, and setting it here changes nothing. Verified the
# hard way -- a build with `NTS_RC=1` produced byte-identical C, so a test that
# "passed under reference counting" had done no such thing.
rc_emit=()
rc_defines=()
if [ -n "${NTS_CONFORMANCE_RC:-}" ]; then
  rc_emit=(--rc)
  rc_defines=(-DNTS_PROVIDER_RC -DNTS_POISON=1)
fi

NTS_TSGO="${NTS_TSGO:-$root/target/tsgo}" "$compiler" \
  emit-c "$src/tsconfig.json" --out "$work" --napi "${rc_emit[@]}"

# The module's own C, plus the C every module shares. Globbed rather than
# listed: a module owns its bindings, so adding one is adding a file to its own
# directory and nothing else. The previous version named a single
# `runtime/node/c/node_all.c`, which was deleted in 299b218 and left this
# script referring to a file that does not exist -- invisible because no module
# lowers enough to reach the link step yet.
module_c=()
while IFS= read -r -d '' source; do
  module_c+=("$source")
done < <(find "$src" -maxdepth 1 -name '*.c' -print0)

shared_c=()
while IFS= read -r -d '' source; do
  shared_c+=("$source")
done < <(find "$root/runtime/node/internal" -maxdepth 1 -name '*.c' -print0)
# Where node's vendored compression headers live, for the sibling compile and the
# link both. `zlib.c` includes <zlib.h>, <brotli/*.h>, <zstd.h> and <zstd_errors.h>
# and would otherwise resolve every one of them against /usr/include.
node_deps="$root/third_party/node/deps"
vendored_includes=(
  -I"$node_deps/zlib"
  -I"$node_deps/brotli/c/include"
  -I"$node_deps/zstd/lib"
)


# And every *other* module's C, because a module's TypeScript imports other
# modules' TypeScript and inherits their `declare function`s with it.
#
# `dgram` imports `net`, so its program calls `nts_net_default_auto_select_family`.
# That binding has a complete C half -- `net/net.c:7` -- and `dgram.node` linked
# without it, because this list was the module's own directory and `internal`.
# The result compiled, linked, and **failed at load**:
#
#     undefined symbol: nts_net_default_auto_select_family
#
# A shared object resolves lazily, so nothing before `require()` says a word. It
# was the only module in the corpus that built and could not be loaded, and it
# looked like a defect in something already shipped.
#
# As an *archive*, not a list of objects. The linker pulls a member only when
# something still undefined is in it, so a module gets exactly the other-module
# C it actually calls -- `dgram` gets `net.c` and not `zlib.c`. Naming every
# object instead would drag all of them in and need every module's libraries on
# every link.
sibling_dir="$work/sibling"
rm -rf "$sibling_dir"
mkdir -p "$sibling_dir"
while IFS= read -r -d '' source; do
  case "$source" in "$src"/*) continue ;; esac
  object="$sibling_dir/$(printf '%s' "$source" | tr '/' '_').o"
  # Best effort: a sibling whose own headers are not on this module's include
  # path simply does not join the archive, and the link then fails on the symbol
  # it would have provided -- which is the honest outcome and the same one as
  # before this existed.
  clang -std=c11 -O2 -D_GNU_SOURCE -fPIC "${binding_header_flags[@]}" \
    -I"$napi" -I"$uv_include" -I"$(dirname "$source")" \
    -I"$root/runtime/node/internal" -I"$root/runtime/c" \
    "${vendored_includes[@]}" \
    -c "$source" -o "$object" > /dev/null 2>&1 || true
done < <(find "$root/runtime/node" -mindepth 2 -maxdepth 2 -name '*.c' -print0)
sibling_archive=()
if ls "$sibling_dir"/*.o > /dev/null 2>&1; then
  ar rcs "$sibling_dir/libsiblings.a" "$sibling_dir"/*.o
  sibling_archive=("$sibling_dir/libsiblings.a")
fi

# `declare function` lowers to an ordinary external C call. The corresponding
# prototypes are owned by the same binding triples as their definitions, so
# make those headers visible to the generated translation unit as well as to
# the hand-written C files. Without this, clang has to diagnose every reached
# native call as an implicit declaration even when its complete C half exists.
binding_headers=(
  "$root/runtime/node/internal/nts_node.h"
  "$root/runtime/node/internal/shared.h"
)
while IFS= read -r -d '' header; do
  binding_headers+=("$header")
done < <(find "$src" -maxdepth 1 -name '*.h' -print0)

binding_header_flags=()
for header in "${binding_headers[@]}"; do
  binding_header_flags+=(-include "$header")
done

# **Node's compression libraries, not the machine's.** `process.versions` names
# a zlib, a brotli and a zstd, and node vendors all three under `deps`. This
# linked the system copies: zlib 1.3.2 against node's `1.3.2.1-motley` (Chromium's
# fork), and whatever `-lbrotlienc`/`-lzstd` happened to be installed.
#
# It matters here more than it usually would, because the `zlib` corpus compares
# **compressed bytes** byte-for-byte against node's output, deliberately -- two
# correct implementations can disagree on bytes. It reported 0 divergences, so
# the versions agreed at the settings exercised; that was incidental parity
# between two builds, not a property of this one, and a system package bump would
# have produced divergences that were nobody's defect.
#
# Compiled from source rather than linked, because node ships no prebuilt object.
module_libraries=()
module_extra_c=()
module_extra_flags=()

# Relative `.c` paths from a gyp source list. Node maintains these lists as it
# bumps each dependency, so deriving them beats copying them: `zstd.gyp` names 26
# of the 40 `.c` files under `lib` -- `legacy`, `deprecated` and `dictBuilder`
# are present in the tree and not built -- and `brotli.gyp` names 35 of 36,
# leaving out `c/tools/brotli.c`, which is a command-line program with a `main`.
# Both files quote their sources and quote nothing else ending in `.c`, so this
# needs no gyp parser; a `.gyp` that grew one would show up as a link error
# naming a symbol, not as silence.
gyp_sources() { grep -oE "'[^']+\.c'" "$1" | tr -d "'"; }

add_vendored() {
  local dir="$1" rel
  while IFS= read -r rel; do module_extra_c+=("$dir/$rel"); done \
    < <(gyp_sources "$dir/$(basename "$dir").gyp")
}

case "$module" in
  zlib)
    if [ -f "$node_deps/zlib/deflate.c" ] \
      && [ -f "$node_deps/brotli/brotli.gyp" ] \
      && [ -f "$node_deps/zstd/zstd.gyp" ]; then
      # zlib has no gyp source list in the checkout; every `.c` at its top level
      # is built. The SIMD translation units are guarded by defines this build
      # does not set, so they compile to nothing, and `deflate.c` calls
      # `cpu_check_features()` unconditionally, so `cpu_features.c` is required.
      while IFS= read -r -d '' zsrc; do module_extra_c+=("$zsrc"); done \
        < <(find "$node_deps/zlib" -maxdepth 1 -name '*.c' -print0)
      add_vendored "$node_deps/brotli"
      add_vendored "$node_deps/zstd"
      # Node's own defines, from the two gyp files, carried across because node
      # sets them rather than because each was shown to be required here.
      # `XXH_NAMESPACE` was *tested*: node's zstd sources build and round-trip
      # with it, without it, and with an unrelated define in its place, so it is
      # symbol hygiene -- it keeps zstd's xxhash from colliding with another
      # copy in the same binary -- and not a correctness requirement. A comment
      # here first claimed the opposite. `ZSTD_DISABLE_ASM` is node's choice
      # too, with a TODO beside it: `huf_decompress_amd64.S` is in the tree and
      # node does not assemble it.
      module_extra_flags=(
        -DOS_LINUX
        -DXXH_NAMESPACE=ZSTD_
        -DZSTD_MULTITHREAD
        -DZSTD_DISABLE_ASM
      )
      module_libraries=(-lm -pthread)
    else
      # Named rather than silently falling back: a missing vendored tree would
      # otherwise link the machine's libraries again and the parity would go
      # back to being about this machine.
      echo "note: $node_deps is missing a vendored tree -- linking the system compression libraries instead" >&2
      module_libraries=(-lz -lbrotlienc -lbrotlidec -lzstd)
    fi
    ;;
esac

# Everything the compiler emitted, rather than the three files it used to
# emit. `nts_unicode.c` appeared beside them and this script kept naming
# `program.c`, `nts_runtime.c` and `addon.c`, so the link silently produced an
# addon with `nts_str_to_lower_case` undefined -- and a shared library links
# happily with an unresolved symbol, so it surfaced only when a call reached
# it. That is the same failure the comment above records for `node_all.c`: a
# hand-maintained list of generated files, updated by hand.
#
# `-maxdepth 1` on purpose. `quickjs/libunicode.c` and `quickjs/dtoa.c` are
# `#include`d by the generated sources rather than compiled beside them, so
# picking them up here would define every symbol twice.
generated_c=()
while IFS= read -r -d '' source; do
  generated_c+=("$source")
done < <(find "$work" -maxdepth 1 -name '*.c' -print0)
[ "${#generated_c[@]}" -gt 0 ] || { echo "the compiler emitted no C into $work" >&2; exit 2; }

# `-fvisibility=hidden`, because a shared object without it is preemptable by
# whatever was loaded first.
#
# A `.so` linked without `-Bsymbolic` routes calls to its **own** global
# functions through the PLT, and the dynamic linker resolves them against the
# global symbol table -- where libc got there first. An addon exporting a
# function named `access` therefore called libc's `access(2)` with an
# `NtsString *` where a `const char *` was expected, and answered `0` for every
# input: no refusal, no clang warning, an addon that links and loads and returns
# plausible values. `nm` showed the addon *defining* `T access` and never calling
# it. See `blockers/libc-name-collision`.
#
# The compiler lane escapes colliding names in the emitted C, which fixes the
# other direction of the same hazard -- a program's `strlen` preempting libc's
# for `nts_runtime.c`, which makes 58 such calls. **The two are different
# defects.** An escape list cannot close this one, because the risk here is
# libc's *dynamic symbol table* rather than any header, and nobody can enumerate
# that. Hidden visibility removes every program function from the table, so the
# question does not arise for names nobody thought of.
#
# Safe for the entry point: `NAPI_MODULE_INIT()` declares both
# `node_api_module_get_api_version_vN` and `napi_register_module_vN` with
# `NAPI_MODULE_EXPORT`, which is `__attribute__((visibility("default")))`.
# Checked in `third_party/node/src/node_api.h` before landing this, because a
# module whose initializer is hidden does not load at all.
clang -std=c11 -O2 -D_GNU_SOURCE -fPIC -shared -fvisibility=hidden \
  "${rc_defines[@]}" \
  "${binding_header_flags[@]}" \
  -I"$work" -I"$napi" -I"$uv_include" -I"$src" -I"$root/runtime/node/internal" \
  "${vendored_includes[@]}" "${module_extra_flags[@]}" \
  -o "$out/$module.node" \
  "${generated_c[@]}" \
  "${module_c[@]}" "${shared_c[@]}" "${sibling_archive[@]}" \
  "${module_extra_c[@]}" \
  "${module_libraries[@]}" -luv -lm

echo "$out/$module.node: $(stat -c%s "$out/$module.node") bytes"
