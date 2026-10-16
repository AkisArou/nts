#!/usr/bin/env python3
"""Verify docs/coverage.md: every listed Expo module appears exactly
once; every `lib:X` citation exists in lib.native-dom.d.ts (rows marked
lib-gap are exempt — they cite what they intend to add); every `sdk:x`
citation names an existing module file (status gap-missing exempt).
Exit 1 with a per-row report on any mismatch.
"""
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(__file__), "..")

EXPECTED = [
    "Accelerometer", "AgeRange", "AppIntegrity", "AppIntents",
    "AppleAuthentication", "Application", "Asset", "Audio (expo-audio)",
    "AuthSession", "BackgroundTask", "Barometer", "Battery", "Blob",
    "BlurView", "Brightness", "BuildProperties", "Calendar", "Camera",
    "Cellular", "Checkbox", "Clipboard", "Constants", "Contacts",
    "Crypto", "Device", "DeviceMotion", "DocumentPicker", "FileSystem",
    "Fingerprint", "Font", "GlassEffect", "Gyroscope", "Haptics",
    "Hinge", "Image", "ImageManipulator", "ImagePicker", "IntentLauncher",
    "KeepAwake", "LightSensor", "LinearGradient", "Linking", "LivePhoto",
    "LocalAuthentication", "Localization", "Location", "Magnetometer",
    "MailComposer", "Manifests", "MediaLibrary", "MeshGradient",
    "NavigationBar", "Network", "Notifications", "Observe", "Pedometer",
    "Print", "ScreenCapture", "ScreenOrientation", "SecureStore",
    "Sensors", "Sharing", "SMS", "Speech", "SplashScreen", "SQLite",
    "StatusBar", "StoreReview", "Symbols", "SystemUI", "TaskManager",
    "TrackingTransparency", "Updates", "Video (expo-video)",
    "WebBrowser", "Widgets",
]


def main():
    rows = []
    for line in open(os.path.join(ROOT, "docs/coverage.md")):
        if not line.startswith("| "):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) == 5 and cells[0] != "Expo module":
            rows.append(cells)
    names = [r[0] for r in rows]
    errors = []
    for n in EXPECTED:
        if names.count(n) != 1:
            errors.append(f"{n}: appears {names.count(n)} times")
    for n in names:
        if n not in EXPECTED:
            errors.append(f"{n}: not on the expected list")

    lib = open(os.path.join(ROOT, "lib.native-dom.d.ts")).read()
    lib_names = set(re.findall(
        r"^(?:interface|type|declare var|declare function) ([A-Za-z_$][\w$]*)",
        lib, re.M))
    modules = set()
    for g in ("shared", "mobile", "desktop"):
        d = os.path.join(ROOT, "src", g)
        if os.path.isdir(d):
            modules |= {f[:-5] for f in os.listdir(d) if f.endswith(".d.ts")}

    for expo, _disp, served, status, _next in rows:
        for ref in re.findall(r"`lib:([A-Za-z]+)`", served):
            if ref not in lib_names and status != "lib-gap":
                errors.append(f"{expo}: lib:{ref} not in lib.native-dom.d.ts")
        for ref in re.findall(r"`sdk:([a-z-]+)`", served):
            if ref not in modules and status not in ("gap-missing", "partial"):
                errors.append(f"{expo}: sdk:{ref} has no module file")

    counts = {}
    for r in rows:
        counts[r[3]] = counts.get(r[3], 0) + 1
    print(f"rows: {len(rows)}  by status: {counts}")
    if errors:
        print("\n".join(errors))
        return 1
    print("coverage OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
