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
# Only the top-level path is resolved (it may be `MacOSX.sdk -> MacOSX26.x.sdk`).
# Links *inside* the SDK are kept as links: a framework is
# `Headers -> Versions/Current/Headers`, and following them copies every
# header several times over.
remote=$(ssh -o BatchMode=yes "$dest" "cd \"$remote\" && pwd -P")
mkdir -p "$root"
rm -rf "$root/MacOSX.sdk.partial"
# bsdtar's file flags, xattrs and AppleDouble files mean nothing on Linux, and
# GNU tar warns once per file for the flags.
ssh -o BatchMode=yes "$dest" "COPYFILE_DISABLE=1 tar --no-fflags --no-xattrs --no-mac-metadata -C \"$(dirname "$remote")\" -cf - \"$(basename "$remote")\"" \
  | tar -C "$root" -xf - --transform "s|^$(basename "$remote")|MacOSX.sdk.partial|"
rm -rf "$root/MacOSX.sdk"
mv -f "$root/MacOSX.sdk.partial" "$root/MacOSX.sdk"
echo "export NTS_APPLE_SDK=$root/MacOSX.sdk"
