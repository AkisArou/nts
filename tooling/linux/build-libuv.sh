#!/usr/bin/env bash
# Cross-builds the vendored libuv for Linux on <arch>, against musl and
# statically, with zig: into ${NTS_LINUX_ROOT:-~/.cache/nts/linux}/<arch>-musl/
# {include,lib}. What `tooling/linux/cc-musl.sh` compiles and links against.
#
#   tooling/linux/build-libuv.sh aarch64
#
# musl and static, because the machine that runs the result is qemu's user
# mode on this one, which has no <arch> glibc to load a dynamic program with.
set -euo pipefail

arch=${1:?usage: build-libuv.sh <arch>}
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
root="${NTS_LINUX_ROOT:-$HOME/.cache/nts/linux}/$arch-musl"
[[ -f "$root/lib/libuv.a" ]] && { echo "$root"; exit 0; }
for tool in zig cmake ninja; do
  command -v "$tool" >/dev/null || { echo "build-libuv.sh: no $tool on PATH" >&2; exit 1; }
done
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
printf '#!/bin/sh\nexec zig cc -target %s-linux-musl "$@"\n' "$arch" >"$work/cc"
chmod +x "$work/cc"
cmake -S "$repo/third_party/node/deps/uv" -B "$work/build" -G Ninja \
  -DCMAKE_C_COMPILER="$work/cc" -DCMAKE_SYSTEM_NAME=Linux -DCMAKE_SYSTEM_PROCESSOR="$arch" \
  -DLIBUV_BUILD_SHARED=OFF -DLIBUV_BUILD_TESTS=OFF -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="$root" >"$work/cmake.log" 2>&1 || { cat "$work/cmake.log" >&2; exit 1; }
ninja -C "$work/build" >"$work/ninja.log" 2>&1 || { cat "$work/ninja.log" >&2; exit 1; }
cmake --install "$work/build" >/dev/null
echo "$root"
