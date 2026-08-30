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
# `third_party/node-headers` first, because it is the only candidate that is
# *pinned*: `tooling/bootstrap` fetches the official headers tarball for the
# version in `.tool-versions`, so `uv.h` there is the one node's own libuv was
# built from. The addon calls `uv_*` directly and libuv is not ABI-stable, so
# any other candidate is a version match by luck. `node-api-headers` does not
# carry `uv.h` at all, which is how the system one used to get in.
napi="${NTS_NAPI_INCLUDE:-}"
if [ -z "$napi" ]; then
  for candidate in \
    "$root/third_party/node-headers/include/node" \
    "$root/node_modules/node-api-headers/include" \
    "/tmp/napi-hdrs/node_modules/node-api-headers/include" \
    "/usr/include/node"; do
    [ -f "$candidate/node_api.h" ] && napi="$candidate" && break
  done
fi
[ -n "$napi" ] || { echo "no node_api.h; npm i node-api-headers, or set NTS_NAPI_INCLUDE" >&2; exit 2; }

mkdir -p "$work" "$out"
NTS_TSGO="${NTS_TSGO:-$root/target/tsgo}" "$root/target/debug/nts" \
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

clang -std=c11 -O2 -D_GNU_SOURCE -fPIC -shared $rename \
  -I"$work" -I"$napi" -I"$src" -I"$root/runtime/node/internal" \
  -o "$out/$module.node" \
  "$work/program.c" "$work/nts_runtime.c" "$work/addon.c" \
  $module_c $shared_c \
  -luv -lm

echo "$out/$module.node: $(stat -c%s "$out/$module.node") bytes"
