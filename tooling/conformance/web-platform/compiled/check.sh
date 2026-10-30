#!/bin/sh
# Compile and execute the shared Web-platform source that currently compiles.
#
# Separate from the host gate on purpose: that one needs only node, and this one needs
# a compiler. Keeping them apart means the host corpus stays runnable by anyone while
# this step stays honest about its prerequisite.
#
# `NTS_BIN` selects the compiler. Pin a private copy rather than using whatever is in
# `target/release`: three sessions share this checkout and that binary moves several
# times an hour, so a result taken across it names no compiler at all.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../../.." && pwd)
exec node "$root/tooling/differential/check-consumers.ts" compiled-web
