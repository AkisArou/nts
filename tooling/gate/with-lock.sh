#!/bin/sh
# Run a command while holding the measurement lock, and release it only if we
# were the ones who took it.
#
#   tooling/gate/with-lock.sh cargo run --release -p nts-bench
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
# # Staleness
#
# Nothing releases the lock if its holder dies, so a directory with no live
# `gate/all.sh` or `nts-bench` behind it is reclaimed rather than waited on. The
# check is `pgrep` against the *processes*, never against a waiter's own command
# line -- `until ! pgrep -f "gate/all.sh"` matches the waiter and never exits.
set -eu

lock=/tmp/nts-gate/gate.lock.d
mkdir -p "$(dirname "$lock")"

if ! mkdir "$lock" 2>/dev/null; then
    if pgrep -af 'gate/all\.sh|nts-bench' > /dev/null 2>&1; then
        echo "with-lock: a measurement is running; not starting another" >&2
        exit 75
    fi
    echo "with-lock: the lock is stale -- no gate or bench process holds it" >&2
    rmdir "$lock" 2>/dev/null || true
    if ! mkdir "$lock" 2>/dev/null; then
        echo "with-lock: could not take the lock" >&2
        exit 75
    fi
fi

# Only reached when *this* shell created the directory, which is the whole point.
trap 'rmdir "$lock" 2>/dev/null || true' EXIT INT TERM

"$@"
