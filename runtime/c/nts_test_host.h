/* A deterministic host: no I/O, no threads, and a clock that is a number.
 *
 * This is the reason the host seam is a vtable rather than a compile-time
 * choice (docs/async.md §7). Ordering is the one part of the async stack where
 * a wrong answer looks exactly like a right one, and against a real loop it is
 * only reproducible by luck. Against this one it is a unit test.
 *
 * Not part of the emitted runtime: nothing here is linked into a compiled
 * program.
 */
#ifndef NTS_TEST_HOST_H
#define NTS_TEST_HOST_H

#include "nts_runtime.h"

/* Install it, and reset every queue and the clock. */
void nts_test_host_install(void);

/* Run until nothing is runnable and no timer is pending.
 *
 * When the task queue empties and a timer is still waiting, virtual time jumps
 * to the earliest deadline rather than standing still: a clock that only moved
 * when told would strand every `setTimeout`, and both `setTimeout(f, 0)` and
 * `setImmediate(f)` have to actually run.
 *
 * `budget` bounds the number of tasks, so a program that starves the loop
 * fails the test rather than hanging it. Returns the number run. */
uint32_t nts_test_host_run(uint32_t budget);

/* Run a single task, and return whether there was one.
 *
 * `await` on node returns when its promise settles, not when the loop falls
 * quiet, and once timers exist the two differ: a program that leaves another
 * timer pending would have it fire on this side and not on node's. A caller
 * that wants "until this settles" steps. */
bool nts_test_host_step(void);

/* Virtual milliseconds since the host was installed. */
double nts_test_host_now(void);

/* How many tasks were dropped rather than run -- cancelled timers, and
 * anything still queued when the host was reset. The ownership contract says
 * a task is eventually run *or* dropped, and this is how a test checks that
 * nothing was silently discarded. */
uint32_t nts_test_host_dropped(void);

/* Drop every task the host is still holding, without reinstalling it.
 *
 * A pending timer holds its callback, which is the host's state and not the
 * program's -- and a check that measures "what the program still holds" at the
 * end of a run has to say which it is counting. It did not: `examples/timers`
 * reported 58 objects held, which is 29 cases times a timer and the closure it
 * had not run yet, and the `rc` gate carried it as a known failure with a note
 * explaining that it was not a leak. A note is not a separation. Draining first
 * makes the number mean what it claims, so anything left is the program's. */
void nts_test_host_drain(void);

#endif /* NTS_TEST_HOST_H */
