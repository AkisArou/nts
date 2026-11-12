#!/bin/sh
# A measurement joins the CPU queue without reserving memory. admit.ts asks
# for memory only while this ticket can take the CPU mutex, and claims both
# under the ledger's flock. A wait for either holds neither. Priority then
# arrival orders tickets, just as it orders memory requests.
#
#   sh tooling/gate/with-lock.sh --wait --key bench-session target/release/nts-bench
#   sh tooling/gate/with-lock.sh --wait --key perf-<what> taskset -c 4 <command>
#
# --no-quiet-wait skips only quiet-core admission, retaining joint admission
# and the mutex. --wait queues for another measurement; without it, busy
# CPUs/queue are exit75. Quiet admission watches without owning either resource.
# Inside an ancestor's reservation the command shares it; an outer admit.ts
# for this same measurement is refused, because it would reserve while waiting.
set -eu
# FIXTURE_ENVIRONMENT (cache-capabilities.ts) is a presence marker, even empty.
# A fixture must name its own mutex before any path can select the machine lock.
if [ "${NTS_TEST_ENVIRONMENT+x}" = x ] && [ -z "${NTS_MEASUREMENT_LOCK:-}" ]; then
    echo "with-lock: fixture environment requires an owned NTS_MEASUREMENT_LOCK" >&2
    exit 2
fi
lock=${NTS_MEASUREMENT_LOCK:-/tmp/nts-gate/gate.lock.d}
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

if [ "${1-}" = "--admitted" ]; then
    shift
    # admit.ts execs this shell: pid/start identity and the reservation survive.
    if [ -z "${NTS_MEMORY_RESERVATION-}" ] || [ "$(cat "$lock/pid" 2>/dev/null || true)" != "$$" ]; then
        echo "with-lock: no joint admission belongs to this process" >&2
        exit 75
    fi
else
    key=
    wait_arg=
    quiet_arg=
    while :; do
        case "${1-}" in
            --wait) wait_arg=--measurement-wait; shift ;;
            --no-quiet-wait) quiet_arg=--measurement-no-quiet; shift ;;
            --key) key=${2-}; shift; if [ $# -gt 0 ]; then shift; fi ;;
            --key=*) key=${1#--key=}; shift ;;
            *) break ;;
        esac
    done
    if [ $# -eq 0 ]; then
        echo "usage: tooling/gate/with-lock.sh [--wait] [--no-quiet-wait] --key <name> <command> [args...]" >&2
        exit 2
    fi
    if [ -z "$key" ] && [ -z "${NTS_MEMORY_RESERVATION-}" ]; then
        cat >&2 <<'REFUSAL'
with-lock: a measurement needs a key for joint memory and CPU admission:
  sh tooling/gate/with-lock.sh --wait --key bench-session target/release/nts-bench ...
  sh tooling/gate/with-lock.sh --wait --key perf-<what> taskset -c 4 <command>
The key's earlier sessions size its reservation; waiting holds neither resource.
REFUSAL
        exit 2
    fi
    key=${key:-bench-session}
    exec node "$(dirname -- "$0")/admit.ts" --key "$key" --what "measurement $key: $*" \
        --measurement-lock "$lock" ${wait_arg:+"$wait_arg"} ${quiet_arg:+"$quiet_arg"} -- sh "$0" --admitted "$@"
fi

# Only the successful joint acquisition reaches here. The shell keeps that
# mutex and reservation for the whole payload; signals stop its owned group.
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

NTS_BENCH_CPUS=4
export NTS_BENCH_CPUS
run "$@"
