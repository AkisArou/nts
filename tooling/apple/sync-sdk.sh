#!/usr/bin/env bash
# Copies the macOS SDK out of the lane's Mac into
# ${NTS_APPLE_ROOT:-~/.cache/nts/apple}/MacOSX.sdk, so framework headers and
# `.tbd` stubs are available on this box with the Mac off.
#
#   tooling/apple/sync-sdk.sh                  # MacOSX.sdk
#   tooling/apple/sync-sdk.sh iphonesimulator  # iPhoneSimulator.sdk
#
# The SDK is Apple's, licensed with Xcode; it is copied for local builds and
# never committed.
set -euo pipefail

dest="${NTS_APPLE_SSH:-nts-mac}"
root="${NTS_APPLE_ROOT:-$HOME/.cache/nts/apple}"
platform="${1:-macosx}"
case "$platform" in
  macosx) name=MacOSX.sdk ;;
  iphonesimulator) name=iPhoneSimulator.sdk ;;
  *) echo "usage: $0 [macosx|iphonesimulator]" >&2; exit 2 ;;
esac
remote=$(ssh -o BatchMode=yes "$dest" "xcrun --sdk $platform --show-sdk-path") \
  || { echo "no SDK on $dest: run \`xcode-select --install\` there" >&2; exit 1; }
# Only the top-level path is resolved (it may be `MacOSX.sdk -> MacOSX26.x.sdk`).
# Links *inside* the SDK are kept as links: a framework is
# `Headers -> Versions/Current/Headers`, and following them copies every
# header several times over.
remote=$(ssh -o BatchMode=yes "$dest" "cd \"$remote\" && pwd -P")
mkdir -p "$root"
rm -rf "$root/$name.partial"
# bsdtar's file flags, xattrs and AppleDouble files mean nothing on Linux, and
# GNU tar warns once per file for the flags.
ssh -o BatchMode=yes "$dest" "COPYFILE_DISABLE=1 tar --no-fflags --no-xattrs --no-mac-metadata -C \"$(dirname "$remote")\" -cf - \"$(basename "$remote")\"" \
  | tar -C "$root" -xf - --transform "s|^$(basename "$remote")|$name.partial|"
rm -rf "$root/$name"
mv -f "$root/$name.partial" "$root/$name"
if [ "$platform" = macosx ]; then
  echo "export NTS_APPLE_SDK=$root/$name"
else
  echo "$root/$name"
fi
