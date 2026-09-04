#!/bin/sh
# Wait until no other session is running the compiler, then exit 0.
#
# Three sessions share one machine. Correctness runs tolerate each other; a
# *measurement* does not, because cores share last-level cache and turbo
# headroom, so a benchmark wants the machine quiet even when it is pinned.
#
# The whole of this script is one line, and it exists because that line is easy
# to get wrong in a way that never fails loudly:
#
#     while pgrep -f 'target/release/nts check'; do sleep 15; done   # WRONG
#
# `pgrep -f` matches against the full command line, and the waiter's own command
# line *contains the pattern* -- so the loop sees itself, and waits forever. It
# does not error, it does not time out, it just never proceeds. That trap is
# written down in one session's notes in those exact words, was read, quoted,
# and then walked into anyway thirty seconds before being walked into a second
# time by `pgrep -f 'quiet=0'` in the command that was cleaning up the first.
#
# A note is retrieved by recognising the situation, and the situations where
# this matters are the ones where your attention is on something else. So:
#
# `pgrep -x` matches the **executable name**, not the command line. A shell
# running a script that mentions `nts` is not named `nts`, so it cannot match,
# and the failure is unavailable rather than merely documented.
set -eu

# `--self-test` demonstrates the property this script exists for, rather than
# asserting it in a comment. A comment that says `pgrep -x` cannot self-match is
# a claim; this is the claim being run.
#
# The name is twelve characters on purpose. The first version used a sixteen
# character one, and `pgrep -x` refused to match it *at all* -- process names are
# capped at fifteen -- so the test passed while demonstrating nothing, with a
# warning on stderr that the exit status did not carry. A self-test that passes
# for the wrong reason is the exact failure it was written to guard against, and
# it managed it within a minute of being written.
if [ "${1-}" = "--self-test" ]; then
  sh -c '
    pgrep -f zzz-nts-self > /dev/null && loose=yes || loose=no
    pgrep -x zzz-nts-self > /dev/null && exact=yes || exact=no
    [ "$loose" = yes ] || { echo "self-test: pgrep -f did NOT self-match -- this test proves nothing"; exit 1; }
    [ "$exact" = no ]  || { echo "self-test: pgrep -x self-matched -- the fix does not hold here"; exit 1; }
    echo "self-test: pgrep -f sees itself, pgrep -x does not"
  '
  exit $?
fi

quiet_for=${1:-45}
waited=0
interval=5

while :; do
  if pgrep -x nts > /dev/null 2>&1 || pgrep -x nts-bench > /dev/null 2>&1; then
    waited=0
  else
    waited=$((waited + interval))
    [ "$waited" -ge "$quiet_for" ] && break
  fi
  sleep "$interval"
done
