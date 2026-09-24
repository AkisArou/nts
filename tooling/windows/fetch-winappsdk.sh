#!/usr/bin/env bash
# Fetches the Windows App SDK that `nts bind-winmd` reads for `Microsoft.*`
# (WinUI 3, `Microsoft.UI`), into
# ${NTS_WINDOWS_ROOT:-~/.cache/nts/windows}/metadata/winappsdk-<version>/:
# every `.winmd` of the packages read, and `native/` holding
# Microsoft.WindowsAppRuntime.Bootstrap.dll, which a program using the SDK
# ships beside itself to find the runtime installed on the machine.
#
# The release and its packages are `WINAPPSDK_VERSION` and `WINAPPSDK_PACKAGES`
# in tooling/cli/src/bind_winmd/winrt.rs, read from there so the two cannot
# disagree. Fetched once, never committed.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
source_file="$repo/tooling/cli/src/bind_winmd/winrt.rs"
version=$(sed -n 's/.*WINAPPSDK_VERSION: &str = "\([^"]*\)".*/\1/p' "$source_file")
packages=$(sed -n 's/.*WINAPPSDK_PACKAGES: &str = "\([^"]*\)".*/\1/p' "$source_file")
[[ -n "$version" && -n "$packages" ]] || { echo "could not read WINAPPSDK_VERSION and WINAPPSDK_PACKAGES" >&2; exit 1; }
root="${NTS_WINDOWS_ROOT:-$HOME/.cache/nts/windows}"
dest="$root/metadata/winappsdk-$version"
marker="$dest/native/Microsoft.WindowsAppRuntime.Bootstrap.dll"
if [[ -f "$marker" && -f "$dest/Microsoft.UI.Xaml.winmd" ]]; then
  echo "$dest"
  exit 0
fi
mkdir -p "$dest/native"
for entry in $packages; do
  id="microsoft.windowsappsdk.${entry%%=*}"
  pinned="${entry#*=}"
  package="$dest/$id.nupkg"
  curl -sSfL --max-time 600 -o "$package" "https://api.nuget.org/v3-flatcontainer/$id/$pinned/$id.$pinned.nupkg"
  # A .nupkg is a zip. Each package's `metadata/` holds its winmds, some of
  # them once per minimum SDK; the newest copy of each is the one read.
  python3 - "$package" "$dest" <<'PY'
import os, sys, zipfile
package, dest = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(package) as z:
    chosen = {}
    for name in z.namelist():
        if name.startswith("metadata/") and name.endswith(".winmd"):
            base = os.path.basename(name)
            if base not in chosen or name > chosen[base]:
                chosen[base] = name
        elif name == "runtimes/win-x64/native/Microsoft.WindowsAppRuntime.Bootstrap.dll":
            with z.open(name) as src, open(os.path.join(dest, "native", os.path.basename(name)), "wb") as out:
                out.write(src.read())
    for base, name in chosen.items():
        with z.open(name) as src, open(os.path.join(dest, base), "wb") as out:
            out.write(src.read())
PY
  rm -f "$package"
done
[[ -f "$marker" && -f "$dest/Microsoft.UI.Xaml.winmd" ]] || { echo "the packages lack WinUI's metadata or the bootstrap DLL" >&2; exit 1; }
echo "$dest"
