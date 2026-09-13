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

# **A compile is the loudest thing that happens on this box and this could not
# see it.** Two executable names is the right shape for the self-match trap and
# the wrong scope for the question: `rustc` forks to the core count, and a
# `cargo build` in one session put three of them at 674%, 566% and 469% with a
# load average of 8.47 while another session was measuring. Both of its arms
# came back about 12% slow, and the only reason anyone noticed is that its base
# arm failed to reproduce a figure already in the file -- 46,523 against an
# established 40,874.
#
# So the set is what a *measurement* is disturbed by rather than what this
# project happens to run: the compiler, the harness, and the toolchain that
# builds them. `cargo` is here as well as `rustc` because a build spends real
# time resolving and linking under the cargo process itself.
#
# And a load-average floor beside the names, because the names are a list and a
# list is never complete. `wait-idle` is used before taking a number, so the
# honest test is "is this machine quiet", not "is it running something I
# thought of". `uptime`'s one-minute figure is a decaying average, so it lags a
# burst by tens of seconds -- which is the right direction for this: it keeps
# waiting after the last `rustc` exits, which is when the caches are still cold.
#
# The threshold is 2.0 on a machine with far more cores than that, so it is a
# floor against *other work* rather than a claim about capacity.
busy() {
  pgrep -x nts > /dev/null 2>&1 && return 0
  pgrep -x nts-bench > /dev/null 2>&1 && return 0
  pgrep -x rustc > /dev/null 2>&1 && return 0
  pgrep -x cargo > /dev/null 2>&1 && return 0
  # `cut` rather than `awk $1`: the field is `load average: 8.47, 6.12, 4.03`
  # and the comma has to go before the comparison, or every load reads as zero
  # and the check silently never fires.
  load=$(uptime | sed 's/.*load average: *//' | cut -d, -f1 | tr -d ' ')
  # Integer compare, because `sh` has no floats: 2.0 becomes 2.
  [ "${load%%.*}" -ge 2 ] 2>/dev/null && return 0
  return 1
}

# **Order matters at the caller, and the fix above makes the wrong order more
# tempting rather than less.**
#
#     wait for quiet  ->  with-lock --wait  ->  measure       WRONG
#     with-lock --wait  ->  wait for quiet  ->  measure       RIGHT
#
# Waiting for quiet *before* taking the lock passes the check, then blocks
# behind whoever holds it, and starts measuring the instant their gate finishes
# -- which is the hottest the machine gets and the coldest the caches are. The
# wait is not merely wasted, it makes the run look disciplined while
# guaranteeing the worst moment. The lagging load average this script relies on
# is exactly why: it is still decaying when the lock is handed over.
#
# So the quiet-wait goes *inside* the lock. Reported by the JVM lane, who walked
# into it within ten minutes of this script learning to see compiles.
quiet_for=${1:-45}
waited=0
interval=5

while :; do
  if busy; then
    waited=0
  else
    waited=$((waited + interval))
    [ "$waited" -ge "$quiet_for" ] && break
  fi
  sleep "$interval"
done
