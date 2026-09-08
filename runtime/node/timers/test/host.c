/* The six primitives in `timers.c`, against the contract in `host.ts`.
 *
 * The first C test for anything under `runtime/node`. Every other node module's
 * C is exercised only *through* its module, and fifteen of twenty-two modules
 * do not compile -- so `fs.c`, `zlib.c` and this file are all verified by
 * nothing at all today. That is a poor place to leave 186 lines of reference
 * counting and libuv handle discipline, and it is the kind of gap the standing
 * rule is about: node's own tests cannot ask any of these questions, because
 * upstream there is no seam here to ask them of. `setImmediate` is one piece of
 * C++ inside node; here it is a handle policy, and a handle policy can be
 * wrong in ways that look exactly like a slow machine.
 *
 * Two of these deserve their own note, because they are the assertions the
 * oracle had no reason to write:
 *
 *   `an_immediate_does_not_leave_the_loop_asleep` is the whole reason `pump`
 *   exists. It asserts `uv_backend_timeout` rather than running the loop,
 *   deliberately: the failure it guards against is an *indefinite block*, and a
 *   test that reproduced it would hang rather than fail. A hanging test reports
 *   nothing, times out somewhere else, and gets blamed on the machine. Asking
 *   the loop what timeout it intends to use is the same fact, available without
 *   waiting for it.
 *
 *   `an_immediate_may_reschedule_itself` is why the check handle is stopped
 *   *before* the drain rather than after. Stopping afterwards disarms the
 *   arrangement the drain just made, and the symptom is a `setImmediate` loop
 *   that runs exactly once and then hangs -- again, not a failure, a silence.
 *
 * Build and run:
 *
 *   clang -std=c11 -D_GNU_SOURCE -I runtime/c -I runtime/node/timers \
 *     -I third_party/node/deps/uv/include \
 *     runtime/node/timers/test/host.c runtime/node/timers/timers.c \
 *     runtime/c/nts_runtime.c -luv -lm -o /tmp/timers-host && /tmp/timers-host
 */
#if defined(__linux__) && !defined(_GNU_SOURCE)
#define _GNU_SOURCE
#endif

#include <stdio.h>
#include <string.h>
#include <uv.h>

#include "nts_timers.h"

/* Normally emitted by the program -- `codegen/c::emit_closure_call_slot` --
 * because only the compiler knows where a closure's `call` sits. A test has no
 * program, so it picks the slot and builds a table to match. */
const uint32_t nts_closure_call_slot = 0;

static char trace[512];
static int failures;

static void note(const char *what) {
  if (trace[0]) strncat(trace, " -> ", sizeof(trace) - strlen(trace) - 1);
  strncat(trace, what, sizeof(trace) - strlen(trace) - 1);
}

static void expect(const char *what, const char *want) {
  if (strcmp(trace, want) != 0) {
    printf("FAIL %s\n  got  %s\n  want %s\n", what, trace, want);
    failures++;
  } else {
    printf("ok   %s\n", what);
  }
}

static void expect_true(const char *what, bool ok) {
  if (!ok) {
    printf("FAIL %s\n", what);
    failures++;
  } else {
    printf("ok   %s\n", what);
  }
}

/* How many times the immediate drain should re-arm itself before stopping.
 * Set by the one test that cares; zero everywhere else. */
static int reschedule_budget;
static double last_now;

static void on_timers_called(NtsHeader *self, double now) {
  (void)self;
  last_now = now;
  note("timers");
}

static void on_immediates_called(NtsHeader *self) {
  (void)self;
  note("immediate");
  if (reschedule_budget > 0) {
    reschedule_budget--;
    nts_timers_schedule_immediate();
  }
}

/* A closure is an object with a method table, so a fake one is a header whose
 * descriptor has a table with the call in the slot above. `NTS_IMMORTAL` in
 * `reserved` makes retain and release no-ops on it, which is what lets these
 * live in static storage rather than on the managed heap. */
static void *const timers_methods[] = {(void *)(void (*)(NtsHeader *, double))
                                           on_timers_called};
static void *const immediates_methods[] = {(void *)(void (*)(NtsHeader *))
                                               on_immediates_called};

static const NtsDescriptor timers_desc = {
    NTS_KIND_OBJECT, (uint32_t)sizeof(NtsHeader), 0u, 0u, NULL,
    timers_methods,  "OnTimers",                  0u, NULL,
};
static const NtsDescriptor immediates_desc = {
    NTS_KIND_OBJECT,    (uint32_t)sizeof(NtsHeader), 0u, 0u, NULL,
    immediates_methods, "OnImmediates",              0u, NULL,
};

static NtsHeader on_timers = {&timers_desc, NTS_IMMORTAL, 0u, 0u};
static NtsHeader on_immediates = {&immediates_desc, NTS_IMMORTAL, 0u, 0u};

static void reset(void) {
  trace[0] = '\0';
  reschedule_budget = 0;
  last_now = 0.0;
  nts_timers_cancel();
  nts_timers_toggle_ref(true);
  nts_timers_toggle_immediate_ref(true);
}

/* Drain whatever is armed, without ever blocking indefinitely: every test here
 * arms something that is due immediately, so a run that finds nothing to do is
 * a finished run rather than a reason to wait. */
static void drain(void) {
  uv_run(uv_default_loop(), UV_RUN_NOWAIT);
  uv_run(uv_default_loop(), UV_RUN_NOWAIT);
}

/* Runs first, and deliberately does not call `reset`.
 *
 * `ensure_handles` unreferences all three handles at install time, because a
 * handle that is merely initialised must not hold the process open. That makes
 * the re-apply inside `schedule` load-bearing rather than defensive: it is what
 * turns the timer back into a reason for the loop to stay alive the first time
 * anything is scheduled. Without it a plain `setTimeout(fn, 1000)` arms a timer
 * the process will not wait for, and node exits before it fires.
 *
 * Every other test here calls `reset`, which calls `toggle_ref(true)` and
 * references the handle by hand -- so all of them pass with the re-apply
 * deleted. That is exactly what the control found, and this is the assertion
 * that was missing rather than a line of code that was redundant. It has to run
 * before any `toggle_ref` to mean anything, so it runs first and is the only
 * test that may not reset. */
static void a_timer_holds_the_loop_open_before_any_toggle(void) {
  trace[0] = '\0';
  nts_timers_schedule(3600000.0);
  expect_true("a timer holds the loop open before any toggle",
              uv_loop_alive(uv_default_loop()) != 0);
  nts_timers_cancel();
}

/* The same for the check handle, and for the same reason. */
static void an_immediate_holds_the_loop_open_before_any_toggle(void) {
  trace[0] = '\0';
  nts_timers_schedule_immediate();
  expect_true("an immediate holds the loop open before any toggle",
              uv_loop_alive(uv_default_loop()) != 0);
  uv_run(uv_default_loop(), UV_RUN_NOWAIT);
}

static void a_scheduled_timer_fires(void) {
  reset();
  nts_timers_schedule(0.0);
  drain();
  expect("a scheduled timer fires", "timers");
}

static void the_drain_is_handed_the_time_the_loop_woke(void) {
  reset();
  nts_timers_schedule(0.0);
  drain();
  /* `uv_now` is the loop's cached time, so the value handed over must be the
   * loop's own clock rather than a fresh reading. Equality with `uv_now` after
   * the fact is the strongest thing available that does not assume how long
   * the assertion took. */
  expect_true("the drain is handed the time the loop woke",
              last_now == (double)uv_now(uv_default_loop()) && last_now > 0.0);
}

static void a_cancelled_timer_does_not_fire(void) {
  reset();
  nts_timers_schedule(0.0);
  nts_timers_cancel();
  drain();
  expect("a cancelled timer does not fire", "");
}

static void scheduling_twice_replaces_rather_than_adds(void) {
  reset();
  nts_timers_schedule(0.0);
  nts_timers_schedule(0.0);
  drain();
  /* One host timer, always set for the earliest expiry known. Two arrangements
   * that both came due would fire the drain twice and make the duration lists
   * in TypeScript run their queue twice. */
  expect("scheduling twice replaces rather than adds", "timers");
}

static void a_negative_delay_is_due_now(void) {
  reset();
  nts_timers_schedule(-1.0);
  drain();
  /* `(uint64_t)(-1.0)` is not a long wait, it is undefined and in practice
   * enormous. The symptom would be a hang, not a wrong answer. */
  expect("a negative delay is due now", "timers");
}

static void an_immediate_runs(void) {
  reset();
  nts_timers_schedule_immediate();
  drain();
  expect("an immediate runs", "immediate");
}

static void an_immediate_does_not_leave_the_loop_asleep(void) {
  reset();
  nts_timers_schedule_immediate();
  /* The property `pump` exists for. `uv_backend_timeout` does not consider
   * check handles, so without a started idle handle beside it this is -1 --
   * block until something else happens -- and a bare `setImmediate` never
   * runs. Asserted as a query rather than by running the loop, because the
   * failure mode is a block and a blocked test says nothing. */
  expect_true("an immediate does not leave the loop asleep",
              uv_backend_timeout(uv_default_loop()) == 0);
  drain();
}

static void an_immediate_may_reschedule_itself(void) {
  reset();
  reschedule_budget = 2;
  nts_timers_schedule_immediate();
  drain();
  drain();
  drain();
  /* Stopping the check handle after the drain instead of before would disarm
   * what the drain just armed: one immediate, then silence. */
  expect("an immediate may reschedule itself",
         "immediate -> immediate -> immediate");
}

static void an_unreferenced_timer_does_not_hold_the_loop_open(void) {
  reset();
  nts_timers_schedule(3600000.0);
  expect_true("an armed timer holds the loop open",
              uv_loop_alive(uv_default_loop()) != 0);
  nts_timers_toggle_ref(false);
  /* This is what `unref()` means and why it cannot be expressed by not arming:
   * the timer is still armed and will still fire if the loop runs for other
   * reasons. It just stops being a reason. */
  expect_true("an unreferenced timer does not hold the loop open",
              uv_loop_alive(uv_default_loop()) == 0);
  nts_timers_cancel();
}

static void a_reference_survives_rescheduling(void) {
  reset();
  nts_timers_toggle_ref(false);
  nts_timers_schedule(3600000.0);
  /* `uv_timer_start` does not restore ref state and a never-started handle
   * cannot carry it, so the flag is remembered and re-applied. Without that,
   * an unref'd timeout silently becomes referenced again the moment it is
   * rescheduled -- and node's `unref` tests reschedule constantly. */
  expect_true("a reference survives rescheduling",
              uv_loop_alive(uv_default_loop()) == 0);
  nts_timers_cancel();
  nts_timers_toggle_ref(true);
}

static void the_clock_is_the_loops_own(void) {
  expect_true("the clock is the loop's own",
              nts_timers_now() == (double)uv_now(uv_default_loop()));
}

int main(void) {
  nts_timers_install(&on_timers, &on_immediates);

  /* These two must come before anything that calls `reset`. */
  a_timer_holds_the_loop_open_before_any_toggle();
  an_immediate_holds_the_loop_open_before_any_toggle();

  a_scheduled_timer_fires();
  the_drain_is_handed_the_time_the_loop_woke();
  a_cancelled_timer_does_not_fire();
  scheduling_twice_replaces_rather_than_adds();
  a_negative_delay_is_due_now();
  an_immediate_runs();
  an_immediate_does_not_leave_the_loop_asleep();
  an_immediate_may_reschedule_itself();
  an_unreferenced_timer_does_not_hold_the_loop_open();
  a_reference_survives_rescheduling();
  the_clock_is_the_loops_own();

  if (failures) {
    printf("%d failure(s)\n", failures);
    return 1;
  }
  printf("all timer host checks agree with the contract\n");
  return 0;
}
