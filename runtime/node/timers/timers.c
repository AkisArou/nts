/* The timer and check slots `timers/src/host.ts` asks for.
 *
 * One host timer and one check slot for the whole module, which is node's
 * shape: `lib/internal/timers.js` keeps the duration lists and the priority
 * queue in JavaScript and arms exactly one libuv timer for the earliest
 * expiry. A host that armed one per `setTimeout` would make the lists
 * pointless, so the bookkeeping stays in TypeScript and this stays small.
 *
 * Three handles for two slots, and the third is the one worth explaining.
 *
 *   `timer`  a `uv_timer_t`, restarted rather than added to.
 *   `check`  a `uv_check_t`, because `setImmediate` *is* the check phase --
 *            running the drain from an idle handle would run it before poll
 *            rather than after, which is a different phase with a different
 *            answer for every immediate queued from an I/O callback.
 *   `pump`   a `uv_idle_t` that does nothing.
 *
 * `pump` exists because `uv_backend_timeout` does not consider check handles.
 * With only a check handle started, the loop blocks in poll until some other
 * event arrives, and a bare `setImmediate(fn)` never runs -- the handle is
 * active, the loop is alive, and it is asleep. Node does not hit this because
 * it overrides the backend timeout itself, returning 0 while
 * `env->immediate_info()->count()` is non-zero; an addon has no such hook. A
 * started idle handle *is* in the queue `uv_backend_timeout` checks, so
 * starting one alongside the check forces the iteration that runs it.
 *
 * `pump` is permanently unreferenced: it must force an iteration without
 * having an opinion about whether the process stays alive. That opinion
 * belongs to `check`, which is what `toggle_immediate_ref` moves -- an
 * unref'd-but-started idle handle is still in the idle queue, so it still
 * forces the timeout to 0. The two properties are independent, which is the
 * only reason one handle can be split off from the other this way.
 */
#include <stdint.h>
#include <uv.h>

#include "nts_timers.h"

/* Installed once, at module evaluation, and held for the life of the process.
 * Retained because a task holding a callback owns a reference to it, and these
 * two are held by the loop itself rather than by any one task. */
static NtsHeader *nts_timers_on_timers = NULL;
static NtsHeader *nts_timers_on_immediates = NULL;

static uv_timer_t nts_timers_timer;
static uv_check_t nts_timers_check;
static uv_idle_t nts_timers_pump;
static bool nts_timers_handles_ready = false;

/* Ref state is a property of the handle and survives stop/start, but
 * `uv_timer_start` does not restore it and a handle that has never been
 * started cannot carry it either. Both are remembered here and re-applied
 * after every start, so `unref()` on a timeout that is later rescheduled stays
 * unreferenced -- which is the case node's own `unref` tests turn on. */
static bool nts_timers_timer_refed = true;
static bool nts_timers_immediate_refed = true;

static uv_loop_t *nts_timers_loop(void) { return uv_default_loop(); }

/* The same cast the emitter makes at every closure call site, and the same one
 * `nts_callback_call` makes in the runtime -- the method table stores untyped
 * pointers and the caller spells the signature. Two signatures here rather
 * than one, because the timer drain is handed the instant the loop woke and
 * the immediate drain takes nothing. */
static void nts_timers_call(NtsHeader *callback) {
  if (callback == NULL) return;
  ((void (*)(NtsHeader *))
       callback->descriptor->methods[nts_closure_call_slot])(callback);
}

static void nts_timers_call_with(NtsHeader *callback, double argument) {
  if (callback == NULL) return;
  ((void (*)(NtsHeader *, double))
       callback->descriptor->methods[nts_closure_call_slot])(callback,
                                                             argument);
}

static void nts_timers_on_timeout(uv_timer_t *handle) {
  (void)handle;
  /* `uv_now` is the loop's cached time, set once at the top of the iteration.
   * That is exactly what the contract asks for: every timer in a batch is
   * judged against the instant the loop woke, so a long callback cannot push
   * a timer that was already due into the next batch. Reading the clock here
   * instead would reintroduce that. */
  nts_timers_call_with(nts_timers_on_timers,
                       (double)uv_now(nts_timers_loop()));
}

/* The pump does nothing on purpose: its whole contribution is being *in* the
 * idle queue, which is what `uv_backend_timeout` reads. */
static void nts_timers_pump_noop(uv_idle_t *handle) { (void)handle; }

static void nts_timers_on_check(uv_check_t *handle) {
  (void)handle;
  /* Stop before draining, not after. The drain is what queues the next round,
   * and a `setImmediate` scheduled from inside it must leave the handle
   * started -- stopping afterwards would disarm the arrangement the drain just
   * made and hang the process on a self-rescheduling immediate. */
  uv_check_stop(&nts_timers_check);
  uv_idle_stop(&nts_timers_pump);
  nts_timers_call(nts_timers_on_immediates);
}

static void nts_timers_ensure_handles(void) {
  if (nts_timers_handles_ready) return;
  uv_loop_t *loop = nts_timers_loop();
  uv_timer_init(loop, &nts_timers_timer);
  uv_check_init(loop, &nts_timers_check);
  uv_idle_init(loop, &nts_timers_pump);
  /* Started handles hold the loop open; these three are initialised at
   * install time and must not, so each is unreferenced until something is
   * actually scheduled. `pump` is never referenced again. */
  uv_unref((uv_handle_t *)&nts_timers_timer);
  uv_unref((uv_handle_t *)&nts_timers_check);
  uv_unref((uv_handle_t *)&nts_timers_pump);
  nts_timers_handles_ready = true;
}

static void nts_timers_apply_ref(uv_handle_t *handle, bool refed) {
  if (refed) {
    uv_ref(handle);
  } else {
    uv_unref(handle);
  }
}

void nts_timers_install(NtsHeader *on_timers, NtsHeader *on_immediates) {
  nts_timers_ensure_handles();
  /* Called once. Retaining without releasing a previous value would leak on a
   * second call, and releasing the old one is the correct thing whether or not
   * that ever happens. */
  if (on_timers != NULL) nts_retain(on_timers);
  if (nts_timers_on_timers != NULL) nts_release(nts_timers_on_timers);
  nts_timers_on_timers = on_timers;

  if (on_immediates != NULL) nts_retain(on_immediates);
  if (nts_timers_on_immediates != NULL) nts_release(nts_timers_on_immediates);
  nts_timers_on_immediates = on_immediates;
}

void nts_timers_schedule(double delay_ms) {
  nts_timers_ensure_handles();
  /* A negative or NaN delay is due now. `(uint64_t)(-1.0)` is not, and is the
   * shape of bug that reads as a hang rather than as a wrong answer. */
  double delay = delay_ms;
  if (!(delay >= 0.0)) delay = 0.0;
  if (delay > 9007199254740991.0) delay = 9007199254740991.0;
  /* Restarts rather than adds: there is one host timer and it is always set
   * for the earliest expiry known. */
  uv_timer_start(&nts_timers_timer, nts_timers_on_timeout, (uint64_t)delay, 0);
  nts_timers_apply_ref((uv_handle_t *)&nts_timers_timer,
                       nts_timers_timer_refed);
}

void nts_timers_cancel(void) {
  if (!nts_timers_handles_ready) return;
  /* Distinct from a very long delay: an armed timer holds the loop open, so a
   * process whose last timeout was cleared would not exit. */
  uv_timer_stop(&nts_timers_timer);
}

void nts_timers_schedule_immediate(void) {
  nts_timers_ensure_handles();
  /* `uv_check_start` on a started handle is a no-op that replaces the
   * callback, so this is safe to call once per `setImmediate` -- the drain
   * runs once per iteration however many were queued, which is node's shape.
   */
  uv_check_start(&nts_timers_check, nts_timers_on_check);
  uv_idle_start(&nts_timers_pump, nts_timers_pump_noop);
  nts_timers_apply_ref((uv_handle_t *)&nts_timers_check,
                       nts_timers_immediate_refed);
}

void nts_timers_toggle_ref(bool has_refs) {
  nts_timers_timer_refed = has_refs;
  if (!nts_timers_handles_ready) return;
  nts_timers_apply_ref((uv_handle_t *)&nts_timers_timer, has_refs);
}

void nts_timers_toggle_immediate_ref(bool has_refs) {
  nts_timers_immediate_refed = has_refs;
  if (!nts_timers_handles_ready) return;
  nts_timers_apply_ref((uv_handle_t *)&nts_timers_check, has_refs);
}

double nts_timers_now(void) { return (double)uv_now(nts_timers_loop()); }
