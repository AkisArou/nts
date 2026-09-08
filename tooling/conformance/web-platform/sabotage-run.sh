#!/bin/sh
# Run a test file against a sabotaged tree, refusing every way the run can be meaningless.
#
# A sabotage is a claim that a test can fail. Three separate times this lane has taken a
# reading that looked like "the sabotage survived" from a run that was not measuring the
# mutation at all, so this checks all three preconditions before it will run anything.
#
#   1. The mutation is actually in the tree. A patch script whose pattern did not match
#      raises, and a shell that only checks the compiler afterwards will happily run the
#      tests against unmodified source and report zero failures. That is worse than no
#      data: it is data of the wrong sign, since the honest response to a survivor is to
#      go and weaken a test that was fine.
#
#   2. The tree compiles. A mutation that does not type-check leaves the previous emit in
#      place, so the tests run against the code the mutation was meant to replace.
#
#   3. The whole output is read. This used to stop at fourteen lines, which is fine until
#      a suite has more tests than that and the sabotage breaks one near the end.
#
# usage: sabotage-run.sh <label> <test-file> [<mutated-source>[=<pristine-copy>] ...]
#
# With no <mutated-source>, any modification under this lane's source counts. Naming the
# file is better: it distinguishes "something changed" from "the thing I meant changed".
#
# **A file git does not track needs its pristine copy naming**, as `path=copy`. `git diff` is
# silent about an untracked file whether or not it was mutated, so the check that works for
# established source is vacuous for a new module — which is exactly where new work happens.
# Every sabotage loop already keeps a pristine copy to restore from; this is that copy.
set -eu
cd /home/akisarou/Projects/nts

label=$1
test_file=$2
shift 2

if [ "$#" -gt 0 ]; then
  for source in "$@"; do
    case "$source" in
      *=*)
        path=${source%%=*}
        pristine=${source#*=}
        if [ ! -f "$pristine" ]; then
          echo "sabotage-run: REFUSING -- no pristine copy at $pristine to compare against." >&2
          exit 1
        fi
        if cmp -s "$path" "$pristine"; then
          echo "sabotage-run: REFUSING -- $path is byte-identical to $pristine," >&2
          echo "  so the mutation did not apply." >&2
          exit 1
        fi
        ;;
      *)
        if ! git ls-files --error-unmatch -- "$source" >/dev/null 2>&1; then
          echo "sabotage-run: REFUSING -- $source is untracked, so \`git diff\` cannot see a" >&2
          echo "  mutation in it. Pass it as $source=<pristine-copy> instead." >&2
          exit 1
        fi
        if git diff --quiet -- "$source"; then
          echo "sabotage-run: REFUSING -- $source is unchanged, so the mutation did not apply." >&2
          echo "  A patch that failed to match reports a survivor against untouched source." >&2
          exit 1
        fi
        ;;
    esac
  done
elif git diff --quiet -- runtime/web-platform/src; then
  echo "sabotage-run: REFUSING -- no source under runtime/web-platform/src is modified." >&2
  echo "  Nothing is sabotaged, so whatever the tests say is about the unmutated tree." >&2
  exit 1
fi

out=$(pnpm exec tsc --project tooling/conformance/web-platform/tsconfig.json --pretty false 2>&1) || true
if [ -n "$out" ]; then
  echo "sabotage-run: REFUSING -- the mutation does not type-check, so the emit is stale:" >&2
  printf '%s\n' "$out" | head -6 >&2
  exit 1
fi

echo "--- $label ---"
shim=./tooling/conformance/web-platform/environment-shim.ts
node --expose-gc --import "$shim" --test "$test_file" 2>&1 | grep -E "^✖|ℹ (tests|pass|fail)"
