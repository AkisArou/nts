"""Check the literal header-name manifest with clang's declaration AST.

Both native and Windows-conditional declarations are read on every host. The
runtime header's Windows declarations use portable types and require no SDK.
Writing a fresh manifest is explicit; a check never invents support decisions.
"""
import argparse
import json
from pathlib import Path
import subprocess


def declared(root, windows):
    flags = ["-D_WIN32"] if windows else []
    result = subprocess.run([
        "clang", "-x", "c", "-fsyntax-only", "-Xclang", "-ast-dump=json",
        "-I", str(root / "runtime/c"), *flags, "-",
    ], input='#include "nts_runtime.h"\n#include "nts_unicode.h"\n',
        text=True, capture_output=True, check=True)
    names = set()
    pending = [json.loads(result.stdout)]
    while pending:
        node = pending.pop()
        if (node.get("kind") == "FunctionDecl" and node.get("storageClass") != "static"
                and node.get("name", "").startswith("nts_")):
            names.add(node["name"])
        pending.extend(node.get("inner", []))
    return names


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--write-header-manifest", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    native, windows = declared(root, False), declared(root, True)
    assert native <= windows, "Windows declarations unexpectedly remove native names"
    fresh = {"headers": ["runtime/c/nts_runtime.h", "runtime/c/nts_unicode.h"],
             "native": sorted(native), "windows_only": sorted(windows - native)}
    manifest = root / "tooling/wasm/header-helpers.json"
    if args.write_header_manifest:
        manifest.write_text(json.dumps(fresh, indent=2) + "\n")
    else:
        saved = json.loads(manifest.read_text())
        for family in ["native", "windows_only"]:
            old, new = set(saved[family]), set(fresh[family])
            if old != new:
                raise SystemExit(f"{family} header helpers drifted: added={sorted(new-old)}, removed={sorted(old-new)}")
        if saved != fresh:
            raise SystemExit("header manifest order or provenance drifted")
    print(json.dumps({"native": len(native), "windows_only": len(windows - native)}))


if __name__ == "__main__":
    main()
