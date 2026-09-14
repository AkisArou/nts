#!/bin/sh
# Every refusal an interop project documents, produced on demand.
#
# `src/refused.ts` carries lines like
#
#     // TS2365: Operator '+' cannot be applied to types 'bigint' and '1'.
#     //
#     //   const wrong = catalog.id() + 1;
#
# and its header says each was measured by writing the line and running `nts
# check`. That is a claim about one afternoon, not a check -- and the file's own
# history is the argument for this script: an earlier version quoted **nine
# `NTS41xx` codes that do not exist in the compiler**, invented while writing
# prose, in the one file whose whole job is to be believed about refusals.
#
# So each pair is produced: the commented line is uncommented, `nts check` runs,
# and the code beside it must appear. A claim that has stopped being true fails
# here rather than misleading a reader -- which matters most for the ones that
# *should* stop being true, because the lane is meant to support more over time.
#
# The file is edited in place and restored from git, so it refuses to start on a
# dirty one: restoring would discard whatever was being worked on.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
project=${1:?usage: check-refusals.sh <example-dir>}
nts=${NTS_BIN:-"$here/target/release/nts"}
file="$project/src/refused.ts"

[ -f "$file" ] || { echo "check-refusals: no $file"; exit 0; }
if [ -n "$(cd "$here" && git status --porcelain -- "$file")" ]; then
  echo "check-refusals: $file has uncommitted changes; restoring would discard them"
  exit 1
fi

# Each claim is a `// TSxxxx:` line and the nearest `//   <code>` under it.
claims=$(awk '
  /^[[:space:]]*\/\/ (TS|NTS)[0-9]+:/ { code = $2; sub(/:$/, "", code); next }
  code != "" && /^[[:space:]]*\/\/   [^ ]/ {
    line = $0; sub(/^[[:space:]]*\/\/   /, "", line)
    print code "\t" line; code = ""
  }
' "$file")

[ -n "$claims" ] || { echo "check-refusals: $project documents no refusals"; exit 0; }

checked=0
printf '%s\n' "$claims" | while IFS="$(printf '\t')" read -r code line; do
  [ -n "$code" ] || continue
  # Uncomment exactly this line, ask, then put the file back.
  awk -v want="$line" '
    { indented = $0; sub(/^[[:space:]]*\/\/   /, "  ", indented) }
    index($0, "//   " want) { print indented "  void 0;"; next }
    { print }
  ' "$file" > "$file.probing"
  mv -f "$file.probing" "$file"
  answer=$("$nts" check "$project/tsconfig.json" 2>&1 || true)
  ( cd "$here" && git checkout -- "$file" )
  case $answer in
    *"$code"*) printf '  %-8s %s\n' "$code" "$line" ;;
    *)
      printf '  %-8s NOT PRODUCED by: %s\n' "$code" "$line"
      printf '%s\n' "$answer" | sed 's/^/      /' | head -6
      exit 1 ;;
  esac
  checked=$((checked + 1))
done

echo "check-refusals: $(printf '%s\n' "$claims" | wc -l | tr -d ' ') claim(s) produced"
