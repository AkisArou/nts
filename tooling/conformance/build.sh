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
out="$root/target/node"
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
# Absent, no `-I` is added at all and `<uv.h>` comes from the system -- which is
# what happened before the clone carried them, and is a version match by luck
# rather than a wrong answer. Better to build and say so than to refuse.
uv_include="${NTS_UV_INCLUDE:-$root/third_party/node/deps/uv/include}"
if [ -f "$uv_include/uv.h" ]; then
  uv_flag="-I$uv_include"
else
  uv_flag=""
  echo "no pinned uv.h; using the system's. run tooling/bootstrap/bootstrap.sh" >&2
fi

mkdir -p "$work" "$out"
compiler="${NTS_COMPILER:-$root/target/release/nts}"
[ -x "$compiler" ] || {
  echo "no compiler at $compiler; the compiler session must build it" >&2
  exit 2
}
NTS_TSGO="${NTS_TSGO:-$root/target/tsgo}" "$compiler" \
  emit-c "$src/tsconfig.json" --out "$work" --napi

# GAP: the C backend spells an exported function with its source name, so an
# export colliding with a libc symbol does not compile. `basename` is handled by
# the backend's collision list; `dirname` lives in <libgen.h>, which nothing we
# emit includes, so it is renamed here instead. Remove both when the module-
# qualified naming of RFC §27.1 lands.
rename="-Ddirname=nts_node_dirname"

# The module's own C, plus the C every module shares. Globbed rather than
# listed: a module owns its bindings, so adding one is adding a file to its own
# directory and nothing else. The previous version named a single
# `runtime/node/c/node_all.c`, which was deleted in 299b218 and left this
# script referring to a file that does not exist -- invisible because no module
# lowers enough to reach the link step yet.
module_c=$(find "$src" -maxdepth 1 -name '*.c' 2>/dev/null | tr '\n' ' ')
shared_c=$(find "$root/runtime/node/internal" -maxdepth 1 -name '*.c' | tr '\n' ' ')

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

module_libraries=()
case "$module" in
  zlib)
    module_libraries=(-lz -lbrotlienc -lbrotlidec -lzstd)
    ;;
esac

clang -std=c11 -O2 -D_GNU_SOURCE -fPIC -shared $rename \
  "${binding_header_flags[@]}" \
  -I"$work" -I"$napi" $uv_flag -I"$src" -I"$root/runtime/node/internal" \
  -o "$out/$module.node" \
  "$work/program.c" "$work/nts_runtime.c" "$work/addon.c" \
  $module_c $shared_c \
  "${module_libraries[@]}" -luv -lm

echo "$out/$module.node: $(stat -c%s "$out/$module.node") bytes"
