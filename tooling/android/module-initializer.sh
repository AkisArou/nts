#!/bin/sh
# Emit the actual optional module call shared by all on-device launchers.
set -eu
[ "$#" -eq 1 ] || { echo "usage: module-initializer.sh <classes>" >&2; exit 1; }
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
member=$(node "$root/tooling/jvm/member-name.ts" MODULE_INIT)
flags=$(sed 's/^/-J/' "$root/runtime/jvm/test-vm-flags.txt")
# A failed class inspection is an error, not evidence that initialization is absent.
declarations=$(javap $flags -p -cp "$1" nts.gen.Program)
if printf '%s\n' "$declarations" | grep -F " $member();" > /dev/null; then
  printf 'static { nts.gen.Program.%s(); }\n' "$member"
fi
