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
# we ship. `node-api-headers` from npm, or an installed node's include dir.
napi="${NTS_NAPI_INCLUDE:-}"
if [ -z "$napi" ]; then
  for candidate in \
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

clang -std=c11 -O2 -D_GNU_SOURCE -fPIC -shared $rename \
  -I"$work" -I"$napi" -I"$root/runtime/node/c" \
  -o "$out/$module.node" \
  "$work/program.c" "$work/nts_runtime.c" "$work/addon.c" \
  "$root/runtime/node/c/node_all.c" \
  -luv -lm

echo "$out/$module.node: $(stat -c%s "$out/$module.node") bytes"
