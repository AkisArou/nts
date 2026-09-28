#!/bin/sh
# Start a port of a Workbench demo: its directory under examples/gjs-corpus,
# the config and tsconfig every port shares, the original's name, and its
# Blueprint compiled to main.ui. The program and the driver are written by
# hand.
#
#   NTS_WORKBENCH_DEMOS=<clone>/src BLUEPRINT=<blueprint-compiler.py> \
#     sh tooling/gjs-corpus/new-port.sh "Toggle Button" toggle-button
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root=$(CDPATH= cd -- "$here/../.." && pwd)
upstream=$1
slug=$2
port="$root/examples/gjs-corpus/$slug"
mkdir -p "$port/src"
printf '%s\n' "$upstream" > "$port/upstream"
# Button's config and tsconfig are every port's; a port run again keeps its own.
[ -f "$port/nts.config.ts" ] || cp "$root/examples/gjs-corpus/button/nts.config.ts" "$port/nts.config.ts"
[ -f "$port/tsconfig.json" ] || cp "$root/examples/gjs-corpus/button/tsconfig.json" "$port/tsconfig.json"
python3 "$BLUEPRINT" compile "$NTS_WORKBENCH_DEMOS/$upstream/main.blp" > "$port/main.ui"
# The UI's first object is what Workbench previews, inside its window; the
# hosts find it by id, so one Blueprint leaves unnamed is named here.
python3 - "$port/main.ui" <<'PY'
import re, sys
path = sys.argv[1]
with open(path) as f:
    ui = f.read()
root = re.search(r"<object [^>]*>", ui)
if root and " id=" not in root.group(0):
    tag = root.group(0)
    ui = ui.replace(tag, tag[:-1] + ' id="workbench_root">', 1)
    with open(path, "w") as f:
        f.write(ui)
PY
[ -f "$port/driver.txt" ] || : > "$port/driver.txt"
# Enrolled where the config audit typechecks every port's nts.config.ts.
python3 - "$root/examples/gjs-corpus/tsconfig.configs.json" "$slug/nts.config.ts" <<'PY'
import json, sys
path, entry = sys.argv[1], sys.argv[2]
with open(path) as f:
    config = json.load(f)
config["files"] = sorted(set(config["files"]) | {entry})
with open(path, "w") as f:
    json.dump(config, f, indent=2)
    f.write("\n")
PY
echo "$port"
