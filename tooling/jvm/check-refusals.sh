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
#
# **The message is carried too, and asserted.** Until 2026-09-15 only the code
# was: a claim reading `TS2339: ... on type 'HashMap<string, Integer>'` passed
# while the compiler said `HashMap<string, number>`, because both are TS2339.
# That is the same failure this file exists to prevent, one level up -- the
# prose was authoritative-looking and nothing read it. A code identifies a
# *kind* of refusal; the message is the claim about this one.
claims=$(awk '
  /^[[:space:]]*\/\/ (TS|NTS)[0-9]+:/ {
    code = $2; sub(/:$/, "", code)
    text = $0; sub(/^[[:space:]]*\/\/ (TS|NTS)[0-9]+: /, "", text)
    next
  }
  code != "" && /^[[:space:]]*\/\/   [^ ]/ {
    line = $0; sub(/^[[:space:]]*\/\/   /, "", line)
    print code "\t" text "\t" line; code = ""
  }
' "$file")

[ -n "$claims" ] || { echo "check-refusals: $project documents no refusals"; exit 0; }

# Scratch output for `emit-jvm`, which this never reads: the diagnostics are on
# stdout and the class files are a side effect of the only command that reports
# a lowering refusal.
out="${TMPDIR:-/tmp}/nts-check-refusals.$$"
mkdir -p "$out"
trap 'rm -rf "$out"' EXIT

checked=0
printf '%s\n' "$claims" | while IFS="$(printf '\t')" read -r code text line; do
  [ -n "$code" ] || continue
  # Uncomment exactly this line, ask, then put the file back.
  awk -v want="$line" '
    { indented = $0; sub(/^[[:space:]]*\/\/   /, "  ", indented) }
    index($0, "//   " want) { print indented "  void 0;"; next }
    { print }
  ' "$file" > "$file.probing"
  mv -f "$file.probing" "$file"
  # **`emit-jvm`, not `check`, and this cost a wrong conclusion to find.**
  #
  # `check` stops after the frontend and reports what the *checker* refuses. A
  # lowering refusal -- every `NTS` code -- is produced further down, so a claim
  # about one could never be verified here: the probe ran, the refusal fired
  # somewhere `check` does not look, and the arm read as "not produced".
  #
  # Diagnosed three times before being measured, and one of the wrong answers
  # was written down and committed: that `refused` is exported and uncalled, so
  # lowering never reaches it. Calling it changed nothing. Nor did constructing
  # the receiver locally, nor the statement's shape. Running `emit-jvm` on the
  # same file fires the refusal first try, and the difference between the two
  # commands was the whole of it.
  #
  # `emit-jvm` reports the checker's errors too -- a `TS2365` arm produces
  # identically under both -- so this is strictly wider and nothing is lost.
  answer=$("$nts" emit-jvm "$project/tsconfig.json" --out "$out" 2>&1 || true)
  ( cd "$here" && git checkout -- "$file" )
  case $answer in
    *"$code"*) ;;
    *)
      printf '  %-8s NOT PRODUCED by: %s\n' "$code" "$line"
      printf '%s\n' "$answer" | sed 's/^/      /' | head -6
      exit 1 ;;
  esac
  # The code matched. Now the words, which are the actual claim. A message that
  # spans more than the first comment line is checked as far as that line goes.
  case $answer in
    *"$text"*) printf '  %-8s %s\n' "$code" "$line" ;;
    *)
      printf '  %-8s SAYS SOMETHING ELSE: %s\n' "$code" "$line"
      printf '    claimed: %s\n' "$text"
      printf '%s\n' "$answer" | grep -F "$code" | sed 's/^/    actual:  /' | head -3
      exit 1 ;;
  esac
  checked=$((checked + 1))
done

echo "check-refusals: $(printf '%s\n' "$claims" | wc -l | tr -d ' ') claim(s) produced"
