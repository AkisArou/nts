#!/usr/bin/env python3
"""Consistency checks for @nts/sdk's interface package:
- every module file has a package export and a barrel entry (incl. the
  type-only standard modules clipboard/share)
- every module with a value export is exercised by at least one example
- every module that can be absent exposes availability(); the
  always-present exceptions are listed explicitly below and in DESIGN.md
Run alongside check-coverage.py and tsc.
"""
import json
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(__file__), "..")

# Always present by contract: facts/queries about the app realm itself,
# or pure standard re-exports (availability is the host's, e.g. feature
# detection on navigator). Compose splits it per channel on purpose.
NO_AVAILABILITY_OK = {
    "core", "app", "permissions", "appearance", "clipboard", "share",
    "storage", "linking", "compose", "locale", "ui",
}
# ui is a component kit: per-component host support is a rendering
# question (docs/ui/components.md), not availability().
# Type-only modules: no value for an example to call.
TYPE_ONLY = {"clipboard", "share", "core"}


def main():
    files = {}
    for g in ("shared", "mobile", "desktop"):
        d = os.path.join(ROOT, "src", g)
        for f in sorted(os.listdir(d)):
            if f.endswith(".d.ts"):
                files[f[:-5]] = open(os.path.join(d, f)).read()

    pkg = json.load(open(os.path.join(ROOT, "package.json")))["exports"]
    exports = {k[2:] for k in pkg if k.startswith("./")} - {"package.json", "lib.native-dom"}
    index = open(os.path.join(ROOT, "src/index.d.ts")).read()
    barrel = set(re.findall(r'from "\./(?:shared|mobile|desktop)/([a-z-]+)\.d\.ts"', index))
    examples = ""
    exdir = os.path.join(ROOT, "examples")
    for f in os.listdir(exdir):
        if f.endswith(".ts"):
            examples += open(os.path.join(exdir, f)).read()

    errors = []
    for mod, text in sorted(files.items()):
        if mod not in exports:
            errors.append(f"{mod}: no package export")
        if mod not in barrel:
            errors.append(f"{mod}: not in barrel")
        if mod not in TYPE_ONLY:
            consts = re.findall(r"export declare const (\w+)", text)
            if consts and not any(c in examples for c in consts):
                errors.append(f"{mod}: no example uses {consts}")
        if "availability(" not in text and mod not in NO_AVAILABILITY_OK:
            errors.append(f"{mod}: can be absent but exposes no availability()")
    for e in sorted(exports):
        if e and e not in files:
            errors.append(f"export {e}: no module file")

    print(f"modules={len(files)} exports={len(exports)}")
    if errors:
        print("\n".join(errors))
        return 1
    print("consistency OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
