#!/bin/sh
# How Buzz.xcframework was made: a dynamic framework built here from
# src/Buzz.{h,m}, universal x86_64 and arm64, in macOS's versioned bundle
# layout, then wrapped by Xcode's own `xcodebuild -create-xcframework` on the
# lane's Mac, which writes the Info.plist nts reads the slices from.
#
# A package publishes that zipped, at the `url:` its manifest names, with the
# zip's checksum; `swift package resolve` downloads it, checks the checksum,
# extracts it to `.build/artifacts/<package>/<target>/`, and records the
# download in `.build/workspace-state.json`. The fixture commits what resolve
# would leave -- the extracted framework, and the record, in the shape a real
# resolve wrote (tooling/cli's swiftpm tests have it) -- since the URL is not a
# server's. This prints the checksum Package.swift and the record carry.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
artifacts="$here/../../.build/artifacts/buzz/Buzz"
sdk=${NTS_APPLE_SDK:-"$HOME/.cache/nts/apple/MacOSX.sdk"}
work=$(mktemp -d)
for arch in x86_64 arm64; do
  clang -target "$arch-apple-macos13" -isysroot "$sdk" -fuse-ld=lld -x objective-c -fobjc-arc -dynamiclib \
    -framework Foundation -install_name @rpath/Buzz.framework/Versions/A/Buzz "$here/src/Buzz.m" -o "$work/Buzz-$arch"
done
framework="$work/Buzz.framework"
mkdir -p "$framework/Versions/A/Headers" "$framework/Versions/A/Resources"
llvm-lipo -create "$work/Buzz-x86_64" "$work/Buzz-arm64" -output "$framework/Versions/A/Buzz"
cp "$here/src/Buzz.h" "$framework/Versions/A/Headers/"
cat >"$framework/Versions/A/Resources/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>Buzz</string>
  <key>CFBundleIdentifier</key>
  <string>com.example.Buzz</string>
  <key>CFBundleName</key>
  <string>Buzz</string>
  <key>CFBundlePackageType</key>
  <string>FMWK</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
</dict>
</plist>
PLIST
ln -s A "$framework/Versions/Current"
for part in Buzz Headers Resources; do ln -s "Versions/Current/$part" "$framework/$part"; done
ssh nts-mac 'rm -rf /tmp/nts-buzz && mkdir -p /tmp/nts-buzz'
(cd "$work" && tar cf - Buzz.framework) | ssh nts-mac 'cd /tmp/nts-buzz && tar xf - && xcodebuild -create-xcframework -framework "$PWD/Buzz.framework" -output "$PWD/Buzz.xcframework" >/dev/null'
rm -rf "$artifacts/Buzz.xcframework"
mkdir -p "$artifacts"
ssh nts-mac 'cd /tmp/nts-buzz && tar cf - Buzz.xcframework' | (cd "$artifacts" && tar xf -)
# The zip a package would publish, made as Apple says to make one (`ditto`),
# and SwiftPM's own checksum of it.
ssh nts-mac 'cd /tmp/nts-buzz && ditto -c -k --keepParent Buzz.xcframework Buzz.xcframework.zip && cat Buzz.xcframework.zip' >"$work/Buzz.xcframework.zip"
swift=${NTS_SWIFT_TOOLCHAIN:-$(ls -d "$HOME"/.cache/nts/swift/swift-*/ | sort | tail -1)}
echo "checksum: $("$swift/usr/bin/swift-package" compute-checksum "$work/Buzz.xcframework.zip")"
rm -rf "$work"
