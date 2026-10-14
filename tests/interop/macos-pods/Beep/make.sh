#!/bin/sh
# How Beep.xcframework was made: a dynamic framework built here from
# src/Beep.{h,m}, universal x86_64 and arm64, in macOS's versioned bundle
# layout, then wrapped by Xcode's own `xcodebuild -create-xcframework` on the
# lane's Mac, which writes the Info.plist nts reads the slices from. The
# fixture vendors the result, as a pod shipping a binary does.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
sdk=${NTS_APPLE_SDK:-"$HOME/.cache/nts/apple/MacOSX.sdk"}
work=$(mktemp -d)
for arch in x86_64 arm64; do
  clang -target "$arch-apple-macos13" -isysroot "$sdk" -fuse-ld=lld -x objective-c -fobjc-arc -dynamiclib \
    -framework Foundation -install_name @rpath/Beep.framework/Versions/A/Beep "$here/src/Beep.m" -o "$work/Beep-$arch"
done
framework="$work/Beep.framework"
mkdir -p "$framework/Versions/A/Headers" "$framework/Versions/A/Resources"
llvm-lipo -create "$work/Beep-x86_64" "$work/Beep-arm64" -output "$framework/Versions/A/Beep"
cp "$here/src/Beep.h" "$framework/Versions/A/Headers/"
cat >"$framework/Versions/A/Resources/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>Beep</string>
  <key>CFBundleIdentifier</key>
  <string>com.example.Beep</string>
  <key>CFBundleName</key>
  <string>Beep</string>
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
for part in Beep Headers Resources; do ln -s "Versions/Current/$part" "$framework/$part"; done
ssh nts-mac 'rm -rf /tmp/nts-beep && mkdir -p /tmp/nts-beep'
(cd "$work" && tar cf - Beep.framework) | ssh nts-mac 'cd /tmp/nts-beep && tar xf - && xcodebuild -create-xcframework -framework "$PWD/Beep.framework" -output "$PWD/Beep.xcframework" >/dev/null'
rm -rf "$here/Beep.xcframework"
ssh nts-mac 'cd /tmp/nts-beep && tar cf - Beep.xcframework' | (cd "$here" && tar xf -)
rm -rf "$work"
