#!/usr/bin/env bash
# Assembles a minimal macOS sysroot from zig's bundled Darwin libc:
# ${NTS_APPLE_ROOT:-~/.cache/nts/apple}/zig-sdk/{usr/include,usr/lib/libSystem.tbd,SDKSettings.json}
#
# `clang -target <arch>-apple-macos<N> -isysroot <this> -fuse-ld=lld` then
# compiles and links libSystem-only programs from Linux: every nts executable
# that uses no framework. It is the same command line a real SDK uses, with a
# different sysroot, so the build has one Apple path rather than two.
#
# It has no frameworks and no libobjc: Foundation, AppKit and the ObjC runtime
# need a real SDK (`NTS_APPLE_SDK`, see vm.md).
set -euo pipefail

# `zig env` prints ZON: `.lib_dir = "/usr/lib/zig",`.
zig_libc="$(zig env | sed -n 's/^ *\.lib_dir = "\([^"]*\)".*/\1/p')/libc"
[[ -f "$zig_libc/darwin/libSystem.tbd" ]] || { echo "no Darwin libc in zig at $zig_libc" >&2; exit 1; }

sdk="${NTS_APPLE_ROOT:-$HOME/.cache/nts/apple}/zig-sdk"
mkdir -p "$sdk/usr/lib"
ln -sfn "$zig_libc/include/any-darwin-any" "$sdk/usr/include"
ln -sf "$zig_libc/darwin/libSystem.tbd" "$sdk/usr/lib/libSystem.tbd"
# Written rather than linked: zig's own file holds only a display name, and
# clang warns that it cannot parse it.
printf '%s\n' '{"Version":"14.0","CanonicalName":"macosx14.0","DisplayName":"macOS 14.0 (zig libc)","MinimalDisplayName":"14.0","DefaultDeploymentTarget":"14.0","MaximumDeploymentTarget":"14.99"}' \
  >"$sdk/SDKSettings.json"
echo "$sdk"
