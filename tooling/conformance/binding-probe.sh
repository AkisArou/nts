#!/usr/bin/env bash
# Build a Node-API addon around a handful of a module's C bindings, without
# compiling the module.
#
#   tooling/conformance/binding-probe.sh os probes/os.ts
#   NTS_COMPILER=<pinned> tooling/conformance/binding-probe.sh fs probes/fs.ts
#
# **Why this exists.** 308 native bindings are declared across `runtime/node`
# and 17 have ever been compared against node. The interpreted lane cannot
# compare them -- its stand-ins call node's own implementation, so that lane
# agrees with node by construction whatever the C does -- and the compiled lane
# only reaches a module once every refusal in it is fixed. `fs` alone declares
# 133 bindings behind a module that does not compile, so its native half is
# unreachable by any instrument here.
#
# A binding does not need its module. It needs its own `.c`, the shared runtime,
# and a program that declares and calls it. That is what this builds: a few
# lines of TypeScript naming the bindings, linked against the module's real C.
# The result loads in node and can be exercised directly.
#
# **What it does not do, stated because the first probe written showed it.**
# A binding is not always the node function of the same name.
# `nts_os_tmpdir` answers `""` where `os.tmpdir()` answers `/temp`, because the
# module's TypeScript does the `TMPDIR`/`TMP`/`TEMP` chain that node does in
# `lib/os.js` and libuv does not. Both are correct at their own level. So a probe
# compares a binding against **a stated expectation**, not against the node
# module function it resembles -- comparing those blindly manufactures
# divergences that are not defects.
set -euo pipefail

module="${1:?usage: binding-probe.sh <module> <declarations.ts>}"
declarations="${2:?usage: binding-probe.sh <module> <declarations.ts>}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
src="$root/runtime/node/$module"
[ -d "$src" ] || { echo "no such module: $module" >&2; exit 2; }
[ -f "$declarations" ] || { echo "no declarations at $declarations" >&2; exit 2; }

compiler="${NTS_COMPILER:-$root/target/release/nts}"
[ -x "$compiler" ] || { echo "no compiler at $compiler" >&2; exit 2; }

napi="${NTS_NAPI_INCLUDE:-$root/third_party/node/src}"
uv_include="${NTS_UV_INCLUDE:-$root/third_party/node/deps/uv/include}"
[ -f "$napi/node_api.h" ] || { echo "no node_api.h at $napi" >&2; exit 2; }

work="$(mktemp -d "${TMPDIR:-/tmp}/nts-probe-$module-XXXXXX")"
mkdir -p "$work/src"
cp "$declarations" "$work/src/main.ts"
cat > "$work/tsconfig.json" <<JSON
{
  "extends": "$root/tooling/conformance/blockers/tsconfig.base.json",
  "compilerOptions": { "rootDir": "." }
}
JSON

NTS_TSGO="${NTS_TSGO:-$root/target/tsgo}" "$compiler" \
  emit-c "$work/tsconfig.json" --out "$work/out" --napi

# Every header the module's own C expects, the same set `build.sh` force-includes
# so a native call is not diagnosed as an implicit declaration.
includes=(-include "$root/runtime/node/internal/nts_node.h"
          -include "$root/runtime/node/internal/shared.h")
while IFS= read -r -d '' header; do includes+=(-include "$header"); done \
  < <(find "$src" -maxdepth 1 -name '*.h' -print0)

module_libraries=()
[ "$module" = "zlib" ] && module_libraries=(-lz -lbrotlienc -lbrotlidec -lzstd)

module_c=()
while IFS= read -r -d '' c; do module_c+=("$c"); done \
  < <(find "$src" -maxdepth 1 -name '*.c' -print0)

# Every probe needs the shared internal half, but for `internal` itself that is
# the module's own directory -- so appending it unconditionally handed clang the
# same translation unit twice and the link died on a page of "multiple
# definition of nts_os_release". Deduplicate by real path rather than by module
# name: the next module to keep a file under `internal/` would hit this too, and
# a name check would not catch it.
link_c=("${module_c[@]}")
for support in "$root/runtime/node/internal/shared.c" "$root/runtime/node/internal/process.c"; do
  duplicate=0
  for existing in "${module_c[@]}"; do
    if [ "$(realpath "$existing")" = "$(realpath "$support")" ]; then duplicate=1; break; fi
  done
  [ "$duplicate" -eq 0 ] && link_c+=("$support")
done

clang -std=c11 -O2 -D_GNU_SOURCE -fPIC -shared \
  "${includes[@]}" \
  -I"$work/out" -I"$napi" -I"$uv_include" -I"$src" -I"$root/runtime/node/internal" \
  -o "$work/$module-probe.node" \
  "$work/out"/*.c \
  "${link_c[@]}" \
  "${module_libraries[@]}" -luv -lm

echo "$work/$module-probe.node"
