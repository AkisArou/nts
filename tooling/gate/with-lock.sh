#!/bin/sh
# Run a command while holding the measurement lock, and release it only if we
# were the ones who took it.
#
#   tooling/gate/with-lock.sh cargo run --release -p nts-bench
#   tooling/gate/with-lock.sh --wait bash tooling/gate/all.sh
#
# Without `--wait` a held lock is exit 75 and no run, which suits a session that
# has other work. With it, the acquisition is retried until it succeeds, which
# suits a gate that wants to queue rather than be skipped.
#
# # The bug this exists to prevent
#
# The obvious spelling is wrong in a way that is quiet and expensive:
#
#     mkdir "$LOCK" 2>/dev/null || echo "busy"
#     if [ -d "$LOCK" ]; then  ...measure...  rmdir "$LOCK"; fi
#
# `mkdir` correctly fails when somebody else holds it -- and then `[ -d ]` tests
# **existence**, which is true precisely because they do. So the run measures
# under their load and releases *their* lock on the way out. That happened, to a
# gate that was mid-certification.
#
# Acquisition is `mkdir` succeeding. It is not a property that can be re-derived
# afterwards by looking, because what you would be looking at is indistinguishable
# from somebody else's lock. So the release is bound to the acquisition by a
# `trap` installed only on the path where the `mkdir` returned zero, and there is
# no second test to get wrong.
#
# # Staleness, and the check that used to be here
#
# Nothing releases the lock if its holder dies, so a lock with no live holder is
# reclaimed rather than waited on. **The holder writes its pid into the lock**
# and staleness is `kill -0` against that pid. It is not a `pgrep`.
#
# It was a `pgrep -af 'gate/all\.sh|nts-bench'`, directly below a comment saying
# the check must never match a waiter's own command line. It matched this
# script's own command line: the normal invocation is
#
#     with-lock.sh tooling/gate/all.sh
#
# so this process's argv *contains* `gate/all.sh`, the pattern found it, and a
# stale lock was reported as a live measurement and never reclaimed. It only
# ever bit when the lock was already there -- when `mkdir` succeeds on the first
# try the loop body does not run at all -- so it survived every use until the
# first one that mattered.
#
# A pid is the thing the question is actually about. `pgrep` asks "does a
# process matching this text exist", which is a different question that happens
# to agree most of the time, and the disagreement is always self-inflicted.
#
# Run `with-lock.sh --self-test` to see both halves demonstrated.
set -eu

lock=/tmp/nts-gate/gate.lock.d

# `mkdir` then write the pid; a reader that finds no pid file has caught a
# holder between the two, so it waits a beat and looks again rather than
# reclaiming a lock somebody is in the middle of taking.
held_by() {
    holder=$(cat "$lock/pid" 2>/dev/null || true)
    [ -n "$holder" ] && kill -0 "$holder" 2>/dev/null
}

if [ "${1-}" = "--self-test" ]; then
    scratch=$(mktemp -d)
    trap 'rm -rf "$scratch"' EXIT
    lock="$scratch/lock.d"

    # A lock held by a process that is gone is stale, whatever is running.
    mkdir "$lock"
    sh -c 'echo $$ > "$1/pid"' _ "$lock"          # a pid that exits immediately
    if held_by; then
        echo "self-test FAILED: a dead holder read as live" >&2
        exit 1
    fi
    echo "self-test: a dead holder is stale -- correct"

    # And the case that broke: this very process's argv names gate/all.sh.
    echo $$ > "$lock/pid"
    if ! held_by; then
        echo "self-test FAILED: a live holder read as dead" >&2
        exit 1
    fi
    if pgrep -af 'gate/all\.sh|nts-bench' > /dev/null 2>&1; then
        echo "self-test: pgrep -af still matches something -- which is why it is gone"
    fi
    echo "self-test: a live holder is held -- correct"
    exit 0
fi

wait_for_it=false
if [ "${1-}" = "--wait" ]; then
    wait_for_it=true
    shift
fi

mkdir -p "$(dirname "$lock")"

while ! mkdir "$lock" 2>/dev/null; do
    if ! held_by; then
        # No pid, or a pid that is gone. The first can be a holder caught
        # mid-acquisition, so look once more before taking their lock away.
        sleep 1
        if ! held_by; then
            echo "with-lock: the lock is stale -- pid ${holder:-none} is not running" >&2
            rm -f "$lock/pid"
            if ! rmdir "$lock" 2>/dev/null; then
                echo "with-lock: could not reclaim the lock" >&2
                exit 75
            fi
            continue
        fi
    fi
    if [ "$wait_for_it" = true ]; then
        sleep 20
        continue
    fi
    echo "with-lock: pid $holder is measuring; not starting another" >&2
    exit 75
done

# Only reached when *this* shell created the directory, which is the whole point.
echo $$ > "$lock/pid"
trap 'rm -f "$lock/pid"; rmdir "$lock" 2>/dev/null || true' EXIT INT TERM

"$@"
