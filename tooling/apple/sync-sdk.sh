#!/usr/bin/env bash
# Copies the macOS SDK out of the lane's Mac into
# ${NTS_APPLE_ROOT:-~/.cache/nts/apple}/MacOSX.sdk, so framework headers and
# `.tbd` stubs are available on this box with the Mac off.
#
# The SDK is Apple's, licensed with Xcode; it is copied for local builds and
# never committed.
set -euo pipefail

dest="${NTS_APPLE_SSH:-nts-mac}"
root="${NTS_APPLE_ROOT:-$HOME/.cache/nts/apple}"
remote=$(ssh -o BatchMode=yes "$dest" 'xcrun --sdk macosx --show-sdk-path') \
  || { echo "no SDK on $dest: run \`xcode-select --install\` there" >&2; exit 1; }
# The path is a symlink (MacOSX.sdk -> MacOSX15.x.sdk); -L follows it.
mkdir -p "$root"
rm -rf "$root/MacOSX.sdk.partial"
ssh -o BatchMode=yes "$dest" "tar -C \"$(dirname "$remote")\" -chf - \"$(basename "$remote")\"" \
  | tar -C "$root" -xf - --transform "s|^$(basename "$remote")|MacOSX.sdk.partial|"
rm -rf "$root/MacOSX.sdk"
mv -f "$root/MacOSX.sdk.partial" "$root/MacOSX.sdk"
echo "export NTS_APPLE_SDK=$root/MacOSX.sdk"
