/* A libuv host: the five operations of `NtsHost` over a `uv_loop_t`.
 *
 * The first *real* host, and the one the Node work builds on. It implements
 * the same five operations the deterministic test host does, which is the
 * claim the seam makes: a host is a configuration, not a fork. Nothing in
 * `nts_runtime.c` knows this file exists, and nothing here knows about the
 * two queues -- posting is the whole interface, and the checkpoint runs
 * because `nts_task_run` is what invokes a task.
 *
 * Handle use, one per operation rather than one per task:
 *
 *   `post_task`            a `uv_idle_t`, started only while its queue has
 *                          something in it -- an idle handle that is always
 *                          started spins the loop at full speed.
 *   `post_delayed`         a `uv_timer_t` per timer, which is what libuv's
 *                          timer heap is for.
 *   `post_from_any_thread` a `uv_async_t`, unreferenced so it cannot by
 *                          itself keep the loop alive.
 *
 * Threading: every operation but `post_from_any_thread` asserts the owner
 * thread, which is whichever thread called `nts_uv_host_install`.
 */
#ifndef NTS_UV_HOST_H
#define NTS_UV_HOST_H

#include <uv.h>

#include "nts_runtime.h"

/* Install the host on `loop`, and take the calling thread as the owner.
 *
 * `loop` outlives the host and is not owned by it: an embedder with its own
 * loop passes that one, and the standalone runner passes `uv_default_loop`.
 */
void nts_uv_host_install(uv_loop_t *loop);

/* Run until nothing is left: no queued task, no live timer, no foreign
 * completion in flight. Returns what `uv_run` returned, which is non-zero if
 * handles are still alive -- an embedder that stopped the loop itself. */
int nts_uv_host_run(void);

/* Close every handle this host owns and drop whatever is still queued.
 *
 * Dropping matters: a task owns a reference to its state, and the contract is
 * that whoever holds it either runs it or drops it. A host that discarded
 * tasks at teardown without saying so would leak every frame they hold. */
void nts_uv_host_shutdown(void);

/* How many tasks were dropped rather than run: cancelled timers, and anything
 * still queued at shutdown. The same accounting the test host keeps, so a
 * program can assert nothing was silently discarded. */
uint32_t nts_uv_host_dropped(void);

#endif /* NTS_UV_HOST_H */
