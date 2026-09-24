#!/usr/bin/env bash
# Asks the lane's Mac how Swift imports each framework, and keeps the answer:
# `swift-symbolgraph-extract` for every framework named, copied to
# ${NTS_APPLE_ROOT:-~/.cache/nts/apple}/symbolgraph/<SDK version>/<Framework>.symbols.json.
#
# This is where `nts bind-objc` gets Swift's names from -- `init(contentRect:
# styleMask:backing:defer:)`, `NSWindow.StyleMask.titled`, `Timer` for
# NSTimer, `var title: String` -- rather than reproducing the importer's
# rules itself. Each symbol is keyed by the clang USR the headers give it,
# which is how the generator joins it to what clang says about the ABI.
#
# Once per SDK: the files are keyed by the synced SDK's version, and after
# that generation needs no Mac. ~90 s for AppKit.
set -euo pipefail

dest="${NTS_APPLE_SSH:-nts-mac}"
root="${NTS_APPLE_ROOT:-$HOME/.cache/nts/apple}"
sdk="${NTS_APPLE_SDK:-$root/MacOSX.sdk}"
[ "$#" -gt 0 ] || { echo "usage: $0 Framework..." >&2; exit 2; }
version=$(sed -n 's/.*"Version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$sdk/SDKSettings.json" | head -1)
[ -n "$version" ] || { echo "no Version in $sdk/SDKSettings.json" >&2; exit 1; }
remote_version=$(ssh -o BatchMode=yes "$dest" 'plutil -extract Version raw "$(xcrun --sdk macosx --show-sdk-path)/SDKSettings.plist"')
[ "$version" = "$remote_version" ] || {
  echo "the synced SDK is $version and the Mac's is $remote_version: run tooling/apple/sync-sdk.sh first" >&2
  exit 1
}
out="$root/symbolgraph/$version"
mkdir -p "$out"
for framework in "$@"; do
  ssh -o BatchMode=yes "$dest" "rm -rf /tmp/nts-symbolgraph && mkdir -p /tmp/nts-symbolgraph && \
    xcrun swift-symbolgraph-extract -module-name '$framework' -target x86_64-apple-macos13 \
      -sdk \"\$(xcrun --sdk macosx --show-sdk-path)\" -output-dir /tmp/nts-symbolgraph -minimum-access-level public >/dev/null"
  scp -q "$dest:/tmp/nts-symbolgraph/$framework.symbols.json" "$out/$framework.symbols.json.partial"
  mv -f "$out/$framework.symbols.json.partial" "$out/$framework.symbols.json"
  echo "$out/$framework.symbols.json"
done
