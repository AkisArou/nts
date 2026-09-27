#!/bin/sh
# Check where `nts build` took an Apple framework's binding from:
#
#   apple-binding.sh FIXTURE SOURCE OUT OS FRAMEWORK platform|imports
#
# - `platform`: the platform packages (`docs/nts-config.md` 3a), linked into
#   SOURCE/node_modules, with nothing generated for the program's imports.
# - `imports`: a binding generated from the program's imports under
#   SOURCE/.nts: the fallback, for a framework no platform package provides.
#
# The evidence is the config the build opened the program with: `nts build`
# writes it under SOURCE/.nts/objc on every build, listing the files it adds,
# while a generated binding is reused from its cache unchanged. So the config
# newer than OUT/.started -- a file made just before the build -- is this
# build's, and what it lists is where the framework came from. Checking for a
# binding file's mere presence, as each fixture did, passed on a stale file
# whatever the build did.
set -eu
fixture=$1 source=$2 out=$3 os=$4 framework=$5 from=$6

[ -f "$out/.started" ] ||
  { echo "$fixture: apple-binding.sh needs $out/.started, made before the build" >&2; exit 1; }
config=$(find "$source/.nts/objc" -name tsconfig.json -newer "$out/.started" 2>/dev/null)
[ -n "$config" ] && [ "$(printf '%s\n' "$config" | wc -l)" -eq 1 ] ||
  { echo "$fixture: expected the one config this build opened under .nts/objc, found: ${config:-none}" >&2; exit 1; }
case $from in
  platform)
    grep -q "@nts/platform-$os/index.d.ts" "$config" ||
      { echo "$fixture: nts build did not open the program with @nts/platform-$os ($config)" >&2; exit 1; }
    if grep -q "/$framework.d.ts\"" "$config"; then
      echo "$fixture: nts build added a $framework binding generated for the imports, though @nts/platform-$os provides it ($config)" >&2
      exit 1
    fi
    echo "binding: $framework from @nts/platform-$os"
    ;;
  imports)
    grep -q "/$framework.d.ts\"" "$config" ||
      { echo "$fixture: nts build did not open the program with a $framework binding generated from the imports ($config)" >&2; exit 1; }
    echo "binding: $framework generated from the program's imports"
    ;;
  *)
    echo "apple-binding.sh: the binding comes from \`platform\` or \`imports\`, not \`$from\`" >&2
    exit 2
    ;;
esac
