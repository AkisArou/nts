#!/usr/bin/env bash
# Fetches the Win32 metadata `nts bind-winmd` reads, into
# ${NTS_WINDOWS_ROOT:-~/.cache/nts/windows}/metadata/win32-<version>/Windows.Win32.winmd.
#
# The version is `WIN32_METADATA_VERSION` in tooling/cli/src/bind_winmd/mod.rs,
# read from there so the two cannot disagree. Microsoft publishes the package
# (`Microsoft.Windows.SDK.Win32Metadata`) only as previews; that is not a
# placeholder. 24 MB, fetched once, never committed.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
version=$(sed -n 's/.*WIN32_METADATA_VERSION: &str = "\([^"]*\)".*/\1/p' "$repo/tooling/cli/src/bind_winmd/mod.rs")
[[ -n "$version" ]] || { echo "could not read WIN32_METADATA_VERSION" >&2; exit 1; }
root="${NTS_WINDOWS_ROOT:-$HOME/.cache/nts/windows}"
dest="$root/metadata/win32-$version"
winmd="$dest/Windows.Win32.winmd"
if [[ -f "$winmd" ]]; then
  echo "$winmd"
  exit 0
fi
mkdir -p "$dest"
package="$dest/package.nupkg"
url="https://api.nuget.org/v3-flatcontainer/microsoft.windows.sdk.win32metadata/$version/microsoft.windows.sdk.win32metadata.$version.nupkg"
curl -sSfL --max-time 300 -o "$package" "$url"
# A .nupkg is a zip; the one file wanted is the winmd.
python3 -c "
import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    names = [n for n in z.namelist() if n.endswith('Windows.Win32.winmd')]
    if not names: sys.exit('no Windows.Win32.winmd in the package')
    with z.open(names[0]) as src, open(sys.argv[2], 'wb') as out: out.write(src.read())
" "$package" "$winmd"
rm -f "$package"
echo "$winmd"
