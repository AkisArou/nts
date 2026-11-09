#!/bin/sh
# Run a command while holding the measurement lock, and release it only if we
# were the ones who took it.
#
#   tooling/gate/with-lock.sh --wait --key bench-session target/release/nts-bench
#   tooling/gate/with-lock.sh --wait --key perf-<what> taskset -c 4 <command>
#   tooling/gate/with-lock.sh --no-quiet-wait --key bench-session target/release/nts-bench --count ...
#
# **A measurement reserves its memory before it takes the lock.** Outside a
# reservation, the wrapper becomes `node tooling/gate/admit.ts --key <key> --
# sh with-lock.sh <its own arguments>`: the session waits in the machine's
# memory ledger (memory-ledger.ts) without holding the lock, and takes the
# lock once admitted. admit.ts becomes this script, so the reservation lasts
# exactly as long as the session, and its peak goes to the key's history
# (the tree's target/gate-costs), which sizes the key's next session. What
# the command starts -- each case of an nts-bench session, and every tool in
# it that reserves memory (reserveJob) -- runs inside the reservation and asks
# the ledger for nothing, so no wait for memory ever holds CPUs 4-5. The key
# names a kind of session, so that its history is that kind's peaks:
# `bench-session` for nts-bench (the nightly's), `perf-<what>` for an agent's
# ad-hoc measurement. Without one, outside a reservation, the wrapper refuses
# (exit 2) and names this way. Inside one (NTS_MEMORY_RESERVATION) -- the
# nightly's `admit.ts --key bench-session -- with-lock.sh`, a gate step's, a
# recording's -- it measures inside that one and reserves nothing. Exit 125 is
# admit.ts's: the ledger, or a key it cannot size.
#
# After taking the lock, wait up to 180 seconds for the reserved physical
# core (CPUs 4-5) to be quiet. Other busy cores do not prevent measurement.
# nts-bench's timed children use CPU 4, leaving its sibling 5 idle.
# Gates never use this lock: the landing check and pinned.sh exclude CPUs 4-5
# instead.
#
# `--no-quiet-wait` keeps the mutex and skips that wait. It is for
# instruction counting (`nts-bench --count`), whose numbers do not move with
# load and which admits per cell itself (memory plus a swap window, recorded
# per cell). A counted run under it makes no quiet-core claim, and its wall
# ratios say so.
#
# Without `--wait` a held lock is exit 75 and no run, which suits a session that
# has other work. With it, the acquisition is retried until it succeeds, which
# suits a measurement that wants to queue rather than be skipped.
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

# The override isolates the wrapper's regression tests from live measurements.
lock=${NTS_MEASUREMENT_LOCK:-/tmp/nts-gate/gate.lock.d}

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
    echo "self-test: a live holder is held -- correct"
    exit 0
fi

# The leading flags, read without shifting this script's arguments: the
# reservation below is asked for with them as they came.
key=
leading() {
    while [ $# -gt 0 ]; do
        case $1 in
            --wait|--no-quiet-wait) shift ;;
            --key) key=${2-}; shift; if [ $# -gt 0 ]; then shift; fi ;;
            --key=*) key=${1#--key=}; shift ;;
            *) break ;;
        esac
    done
    command_count=$#
    command_words=$*
}
leading "$@"
if [ "$command_count" -eq 0 ]; then
    echo "usage: tooling/gate/with-lock.sh [--wait] [--no-quiet-wait] --key <name> <command> [args...]" >&2
    exit 2
fi

if [ -z "${NTS_MEMORY_RESERVATION-}" ]; then
    if [ -z "$key" ]; then
        cat >&2 <<'REFUSAL'
with-lock: a measurement reserves its memory under a key before it takes the measurement lock, so that a wait for memory never holds CPUs 4-5:
  sh tooling/gate/with-lock.sh --wait --key bench-session target/release/nts-bench ...
  sh tooling/gate/with-lock.sh --wait --key perf-<what> taskset -c 4 <command>
The key's earlier sessions size its reservation, and what the command starts runs inside it.
Started inside a reservation already (node tooling/gate/admit.ts --key <name> -- sh tooling/gate/with-lock.sh ...), it needs none.
REFUSAL
        exit 2
    fi
    exec node "$(dirname -- "$0")/admit.ts" --key "$key" --what "measurement $key: $command_words" -- sh "$0" "$@"
fi

wait_for_it=false
quiet_wait=true
while :; do
    case "${1-}" in
        --wait) wait_for_it=true; shift ;;
        --no-quiet-wait) quiet_wait=false; shift ;;
        --key) shift; if [ $# -gt 0 ]; then shift; fi ;;
        --key=*) shift ;;
        *) break ;;
    esac
done

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
# The lock goes with the shell, however it ends -- and a signal *ends* it. A
# trap on INT or TERM that only released the lock let the shell carry on from
# where the signal found it: a `kill` during the quiet wait released the lock
# and then ran the command anyway, unlocked. On 2026-10-21 that started a
# no-GC count driver the caller had just stopped, and it was OOM-killed at
# 21.9 GB. So a signal exits, with the shell's own status for it, and the exit
# releases.
#
# **And it ends now, with what it started.** A shell runs a trap only once its
# *foreground* command has finished, so a `kill` during the quiet wait took
# effect when the wait did, minutes later, holding the lock and the CPUs until
# then. Each child therefore runs in a session of its own and is waited for:
# `wait` returns at the signal, and the signal goes to the child's whole
# process group -- a count script's drivers, `perf`'s program -- rather than
# to the one process `$!` names. The command reads no standard input: an
# asynchronous command's is /dev/null, and nothing measured here reads one.
child=
stop() {
    if [ -n "$child" ]; then
        kill -TERM -- "-$child" 2>/dev/null || true
    fi
    exit "$1"
}
trap 'rm -f "$lock/pid"; rmdir "$lock" 2>/dev/null || true' EXIT
trap 'stop 130' INT
trap 'stop 143' TERM
run() {
    setsid "$@" &
    child=$!
    wait "$child"
}

if [ "$quiet_wait" = true ]; then
    run node "$(dirname -- "$0")/measurement.ts"
else
    echo "with-lock: --no-quiet-wait: lock held, reserved-core quiet wait skipped (instruction counting admits per cell; no quiet-core claim)" >&2
fi
NTS_BENCH_CPUS=4
export NTS_BENCH_CPUS
run "$@"
