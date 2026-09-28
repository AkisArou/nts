#!/usr/bin/env bash
# Fetches the Windows App SDK that `nts bind-winmd` reads for `Microsoft.*`
# (WinUI 3, `Microsoft.UI`), into
# ${NTS_WINDOWS_ROOT:-~/.cache/nts/windows}/metadata/winappsdk-<version>/:
# every `.winmd` of the packages read, and `native/` holding what a program
# using the SDK ships beside itself: Microsoft.WindowsAppRuntime.Bootstrap.dll,
# which finds the runtime installed on the machine, and WebView2's
# WebView2Loader.dll and Microsoft.Web.WebView2.Core.dll, which WinUI's
# `WebView2` control loads from the program's directory -- as a C# WinUI
# build ships all three.
#
# The release and its packages are `WINAPPSDK_VERSION` and `WINAPPSDK_PACKAGES`
# in tooling/cli/src/bind_winmd/winrt.rs, with WebView2's `WEBVIEW2_PACKAGE`
# beside them, read from there so the two cannot disagree. Fetched once,
# never committed.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
source_file="$repo/tooling/cli/src/bind_winmd/winrt.rs"
version=$(sed -n 's/.*WINAPPSDK_VERSION: &str = "\([^"]*\)".*/\1/p' "$source_file")
packages=$(sed -n 's/.*WINAPPSDK_PACKAGES: &str = "\([^"]*\)".*/\1/p' "$source_file")
webview2=$(sed -n 's/.*WEBVIEW2_PACKAGE: &str = "\([^"]*\)".*/\1/p' "$source_file")
[[ -n "$version" && -n "$packages" && -n "$webview2" ]] || { echo "could not read WINAPPSDK_VERSION, WINAPPSDK_PACKAGES and WEBVIEW2_PACKAGE" >&2; exit 1; }
root="${NTS_WINDOWS_ROOT:-$HOME/.cache/nts/windows}"
dest="$root/metadata/winappsdk-$version"
marker="$dest/native/Microsoft.WindowsAppRuntime.Bootstrap.dll"
complete() {
  [[ -f "$marker" && -f "$dest/Microsoft.UI.Xaml.winmd" && -f "$dest/Microsoft.Web.WebView2.Core.winmd" &&
    -f "$dest/native/WebView2Loader.dll" && -f "$dest/native/Microsoft.Web.WebView2.Core.dll" ]]
}
if complete; then
  echo "$dest"
  exit 0
fi
mkdir -p "$dest/native"
# The Windows App SDK's own packages, then WebView2's, which WinUI's
# `WebView2` control stands on and which carries its winmd in `lib/`.
for entry in $(for p in $packages; do echo "microsoft.windowsappsdk.$p"; done) "$webview2"; do
  id="${entry%%=*}"
  pinned="${entry#*=}"
  package="$dest/$id.nupkg"
  curl -sSfL --max-time 600 -o "$package" "https://api.nuget.org/v3-flatcontainer/$id/$pinned/$id.$pinned.nupkg"
  # A .nupkg is a zip. Each package's `metadata/` holds its winmds (WebView2's
  # `lib/`), some of them once per minimum SDK; the newest copy of each is the
  # one read.
  python3 - "$package" "$dest" <<'PY'
import os, sys, zipfile
package, dest = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(package) as z:
    chosen = {}
    for name in z.namelist():
        if (name.startswith("metadata/") or name.startswith("lib/")) and name.endswith(".winmd"):
            base = os.path.basename(name)
            if base not in chosen or name > chosen[base]:
                chosen[base] = name
        elif name in ("runtimes/win-x64/native/Microsoft.WindowsAppRuntime.Bootstrap.dll",
                      "runtimes/win-x64/native/WebView2Loader.dll",
                      "runtimes/win-x64/native_uap/Microsoft.Web.WebView2.Core.dll"):
            with z.open(name) as src, open(os.path.join(dest, "native", os.path.basename(name)), "wb") as out:
                out.write(src.read())
    for base, name in chosen.items():
        with z.open(name) as src, open(os.path.join(dest, base), "wb") as out:
            out.write(src.read())
PY
  rm -f "$package"
done
complete || { echo "the packages lack WinUI's or WebView2's metadata, or a DLL a program ships" >&2; exit 1; }
echo "$dest"
