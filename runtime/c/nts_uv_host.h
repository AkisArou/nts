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

/* libuv's Unix header names `pthread_rwlock_t`, which a strict `-std=c11`
 * translation unit cannot see: the POSIX names sit behind a feature-test
 * macro. Set here rather than in each includer, so anything that includes this
 * compiles however it is driven. */
/* The name is reserved *to the implementation*, and defining it is how the
 * implementation is asked for the declarations libuv needs. There is no other
 * spelling. */
#if defined(__linux__) && !defined(_GNU_SOURCE)
/* NOLINTNEXTLINE(bugprone-reserved-identifier) */
#define _GNU_SOURCE
#endif

#include <uv.h>

#include "nts_runtime.h"

/* Install the host on `loop`, and take the calling thread as the owner.
 *
 * `loop` outlives the host and is not owned by it: an embedder with its own
 * loop passes that one, and the standalone runner passes `uv_default_loop`.
 */
void nts_uv_host_install(uv_loop_t *loop);

/* Run until no registered work remains. Foreign completions already queued
 * are run; a worker that may post later must have registered live work on the
 * loop to keep it running. Returns what `uv_run` returned, which is non-zero
 * if handles are still alive -- an embedder that stopped the loop itself.
 * Use this entry point when driving the installed loop. An embedder driving
 * it directly must bracket callbacks into compiled code with nts_enter/leave,
 * including calls to nts_promise_join, so recursive entry is refused. */
int nts_uv_host_run(void);

/* Driving this host's loop from someone else's.
 *
 * A GUI toolkit owns the thread's loop -- GLib's `GMainContext`, a
 * `CFRunLoop` -- and runs it from inside the program: `g_application_run`
 * blocks inside module evaluation until the application quits. libuv then
 * never runs, and neither does any timer, promise job posted as a task, or
 * I/O completion the program started.
 *
 * So the foreign loop drives this one rather than replacing it: it watches the
 * backend descriptor for readiness, sleeps no longer than the backend timeout,
 * and pumps when either comes due. Nothing about posting changes; the host is
 * the same host, run from a different place. The adapters are thin, one per
 * foreign loop (`nts_glib_host.c`, and a CFRunLoop one), and all three calls
 * are for them.
 *
 * `backend_fd` is libuv's own polling descriptor: epoll on Linux, kqueue on
 * Darwin. Readable means the loop has something to do. */
int nts_uv_host_backend_fd(void);
/* Milliseconds until the loop next has something to do: -1 for nothing
 * scheduled, 0 while a task is queued (the idle handle is started). */
int nts_uv_host_backend_timeout(void);
/* Run whatever is due, without blocking. Does nothing when called from
 * inside the loop -- a task that iterated the foreign loop, as a modal dialog
 * does -- since libuv's loop is not re-entrant. */
void nts_uv_host_pump(void);

/* The installed loop, for an adapter that watches its backend itself: libuv
 * on Windows is IOCP and has no descriptor (`backend_fd` is -1 there), so
 * `nts_win_host` waits on the loop's completion port. */
uv_loop_t *nts_uv_host_loop(void);

/* Called on the owner thread whenever it schedules work -- a task posted, a
 * timer started -- so an adapter whose foreign loop has no before-waiting hook
 * can shorten a wait it already armed. GLib's `prepare` and CoreFoundation's
 * observer re-read `backend_timeout` each time their loop goes idle; a Win32
 * `GetMessage` loop offers nothing of the kind, and a timer started from a
 * window procedure posts no completion for the watcher to see. I/O and
 * `post_from_any_thread` do post one, so they need no call. At most one
 * adapter; NULL unregisters. */
void nts_uv_host_on_schedule(void (*scheduled)(void));

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
