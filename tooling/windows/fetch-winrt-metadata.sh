#!/usr/bin/env bash
# Fetches the WinRT metadata `nts bind-winmd` reads for `Windows.*`, into
# ${NTS_WINDOWS_ROOT:-~/.cache/nts/windows}/metadata/winrt-<version>/, one
# `.winmd` per API contract.
#
# The version is `WINRT_METADATA_VERSION` in tooling/cli/src/bind_winmd/winrt.rs,
# read from there so the two cannot disagree. The package is
# `Microsoft.Windows.SDK.Contracts`; the same files are under
# C:\Windows\System32\WinMetadata on a Windows machine, split differently,
# and this is the copy that does not depend on one. Fetched once, never
# committed.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
version=$(sed -n 's/.*WINRT_METADATA_VERSION: &str = "\([^"]*\)".*/\1/p' "$repo/tooling/cli/src/bind_winmd/winrt.rs")
[[ -n "$version" ]] || { echo "could not read WINRT_METADATA_VERSION" >&2; exit 1; }
root="${NTS_WINDOWS_ROOT:-$HOME/.cache/nts/windows}"
dest="$root/metadata/winrt-$version"
marker="$dest/Windows.Foundation.UniversalApiContract.winmd"
if [[ -f "$marker" ]]; then
  echo "$dest"
  exit 0
fi
mkdir -p "$dest"
package="$dest/package.nupkg"
url="https://api.nuget.org/v3-flatcontainer/microsoft.windows.sdk.contracts/$version/microsoft.windows.sdk.contracts.$version.nupkg"
curl -sSfL --max-time 300 -o "$package" "$url"
# A .nupkg is a zip; every contract's winmd, flattened into one directory.
python3 -c "
import os, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    names = [n for n in z.namelist() if n.endswith('.winmd')]
    if not names: sys.exit('no .winmd in the package')
    for name in names:
        with z.open(name) as src, open(os.path.join(sys.argv[2], os.path.basename(name)), 'wb') as out:
            out.write(src.read())
" "$package" "$dest"
rm -f "$package"
[[ -f "$marker" ]] || { echo "the package has no UniversalApiContract" >&2; exit 1; }
echo "$dest"
