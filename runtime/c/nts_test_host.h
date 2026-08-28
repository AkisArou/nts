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

/* Virtual milliseconds since the host was installed. */
double nts_test_host_now(void);

/* How many tasks were dropped rather than run -- cancelled timers, and
 * anything still queued when the host was reset. The ownership contract says
 * a task is eventually run *or* dropped, and this is how a test checks that
 * nothing was silently discarded. */
uint32_t nts_test_host_dropped(void);

#endif /* NTS_TEST_HOST_H */
