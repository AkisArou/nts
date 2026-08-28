/* The `timers` capability: `setTimeout`, `setInterval`, `clearTimeout`.
 *
 * A capability over the host's `post_delayed` rather than part of the host
 * contract, so it is tested here rather than per host -- both hosts run this
 * same code, which is the point of putting it in the runtime.
 *
 * The callback is a closure, which the compiler emits as an object with a
 * method table. This file builds one by hand: the same descriptor a generated
 * program would have, with a C function in the slot. That is what makes the
 * capability testable at all, because nothing this compiler can express today
 * observes a timer -- a timer's effect reaches a program only through a
 * promise its callback settles, and `new Promise` is not implemented.
 */
#include <stdio.h>
#include <string.h>

#include "nts_test_host.h"

static char trace[512];
static int failures;

static void note(const char *what) {
    if (trace[0]) {
        strncat(trace, " -> ", sizeof(trace) - strlen(trace) - 1);
    }
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

/* A closure, in the shape the compiler emits: an object whose descriptor
 * carries a method table, called through a slot. `label` is what a captured
 * variable would be. */
typedef struct {
    NtsHeader header;
    const char *label;
} Closure;

static void closure_call(Closure *self) { note(self->label); }

/* Slot zero, which is the slot every closure's call occupies. */
static void *const closure_methods[] = {(void *)closure_call};

static const NtsDescriptor desc_closure = {
    NTS_KIND_OBJECT, (uint32_t)sizeof(Closure), 0u, 0u, 0,
    closure_methods, "Closure",
};

static Closure *closure(const char *label) {
    Closure *made = (Closure *)nts_object_new(&desc_closure);
    made->label = label;
    return made;
}

static void reset(void) {
    trace[0] = '\0';
    nts_test_host_install();
}

static void timers_fire_in_delay_order(void) {
    reset();
    Closure *late = closure("late");
    Closure *early = closure("early");
    nts_set_timeout((NtsHeader *)late, 0, 20.0, false);
    nts_set_timeout((NtsHeader *)early, 0, 1.0, false);
    nts_test_host_run(64);
    expect("timers fire in delay order", "early -> late");
    nts_release((NtsHeader *)late);
    nts_release((NtsHeader *)early);
}

static void a_cleared_timer_does_not_fire(void) {
    reset();
    Closure *gone = closure("gone");
    Closure *kept = closure("kept");
    double id = nts_set_timeout((NtsHeader *)gone, 0, 5.0, false);
    nts_set_timeout((NtsHeader *)kept, 0, 10.0, false);
    nts_clear_timeout(id);
    nts_test_host_run(64);
    expect("a cleared timer does not fire", "kept");
    nts_release((NtsHeader *)gone);
    nts_release((NtsHeader *)kept);
}

/* An interval runs the *same* task again and again, which is the reason the
 * capability has two run functions. A one-shot gives its reference back by
 * running; an interval cannot, because the host still holds it -- releasing on
 * each run would free the callback under the timer that is about to call it
 * again. */
static int rounds;
static double repeating;
static size_t live_at_first;

static void tick(Closure *self) {
    note(self->label);
    rounds++;
    if (rounds == 1) {
        live_at_first = nts_live_bytes();
    } else if (nts_live_bytes() != live_at_first) {
        /* The check that a trace cannot make.
         *
         * Running an interval through the one-shot path releases its callback
         * after every round, and the round after that calls through freed
         * memory. The trace still comes out right and the totals still
         * balance -- the allocator pools, so neither the values nor
         * AddressSanitizer notice. What does notice is that the live set
         * shrank while the timer was still holding the callback. */
        printf("FAIL an interval released its callback while it still ran\n");
        failures++;
    }
    if (rounds == 3) {
        nts_clear_timeout(repeating);
    }
}

static void *const tick_methods[] = {(void *)tick};

static const NtsDescriptor desc_tick = {
    NTS_KIND_OBJECT, (uint32_t)sizeof(Closure), 0u, 0u, 0, tick_methods, "Tick",
};

static void an_interval_repeats_until_cleared(void) {
    reset();
    rounds = 0;
    Closure *every = (Closure *)nts_object_new(&desc_tick);
    every->label = "tick";
    repeating = nts_set_timeout((NtsHeader *)every, 0, 2.0, true);
    /* Dropped *before* the run, so the timer's is the only reference left: a
     * callback released on every round is then one called after it was
     * freed, rather than one the caller happens to be holding up. */
    nts_release((NtsHeader *)every);
    nts_test_host_run(64);
    expect("an interval repeats until cleared", "tick -> tick -> tick");
}

/* The reference discipline, which is the part that would silently corrupt
 * rather than fail: a one-shot released twice, or an interval released on
 * every round, both free a live callback. */
static void timers_give_their_callbacks_back(void) {
    reset();
    nts_collect_cycles();
    size_t before = nts_live_bytes();
    for (int round = 0; round < 100; round++) {
        Closure *once = closure("once");
        nts_set_timeout((NtsHeader *)once, 0, 1.0, false);
        nts_release((NtsHeader *)once);

        Closure *cancelled = closure("cancelled");
        double id = nts_set_timeout((NtsHeader *)cancelled, 0, 1.0, false);
        nts_clear_timeout(id);
        nts_release((NtsHeader *)cancelled);

        rounds = 0;
        Closure *every = (Closure *)nts_object_new(&desc_tick);
        every->label = "tick";
        repeating = nts_set_timeout((NtsHeader *)every, 0, 1.0, true);
        nts_release((NtsHeader *)every);

        nts_test_host_run(64);
    }
    nts_collect_cycles();
    size_t after = nts_live_bytes();
    if (after != before) {
        printf("FAIL timers leaked %zu bytes over 100 rounds\n", after - before);
        failures++;
    } else {
        printf("ok   timers give their callbacks back\n");
    }
}

/* Every platform treats a negative or absent delay as zero, and `setTimeout`
 * specifies it. Written so that NaN takes the same branch. */
static void a_negative_delay_is_zero(void) {
    reset();
    Closure *negative = closure("negative");
    Closure *later = closure("later");
    nts_set_timeout((NtsHeader *)negative, 0, -100.0, false);
    nts_set_timeout((NtsHeader *)later, 0, 5.0, false);
    nts_test_host_run(64);
    expect("a negative delay is zero rather than never", "negative -> later");
    nts_release((NtsHeader *)negative);
    nts_release((NtsHeader *)later);
}

/* An id that was never issued, one that was already cleared, and one that
 * already fired. All three are no-ops -- node's `clearTimeout` is -- and none
 * may disturb a live timer.
 *
 * Asked for by the Node profile rather than invented here: a program that
 * clears a timer it is not sure about is ordinary, and "undefined behaviour,
 * guard on your side" would be a worse contract than a lookup that already
 * knows the answer. */
static void clearing_an_unknown_id_is_a_no_op(void) {
    reset();
    Closure *kept = closure("kept");
    double live = nts_set_timeout((NtsHeader *)kept, 0, 5.0, false);

    nts_clear_timeout(0);          /* never a live id */
    nts_clear_timeout(999999.0);   /* never issued */
    nts_clear_timeout(-1.0);       /* not even a plausible one */
    nts_clear_timeout(live);
    nts_clear_timeout(live);       /* the same one twice */

    Closure *after = closure("after");
    nts_set_timeout((NtsHeader *)after, 0, 5.0, false);
    nts_clear_timeout(live);       /* stale, and the slot has been reused */

    nts_test_host_run(64);
    expect("clearing an unknown or stale id disturbs nothing", "after");
    nts_release((NtsHeader *)kept);
    nts_release((NtsHeader *)after);
}

/* A delay is whole milliseconds, and the runtime is what says so.
 *
 * The expected sequence here is the same one `uv_host.c` asserts, which is the
 * point of it: a host is a configuration, not a fork. Leaving the conversion
 * to each host gave two hosts that ordered this program *oppositely* -- the
 * deterministic one by delay, because its clock is a `double`, and libuv by
 * creation order, because both delays became one millisecond there. `nts_delay`
 * is the one place that decides now.
 *
 * `a` is asked for with the longer delay and posted first, so an
 * implementation that kept the fraction runs `b` first. */
static void a_fractional_delay_truncates(void) {
    reset();
    Closure *a = closure("a@1.5");
    Closure *b = closure("b@1.0");
    nts_set_timeout((NtsHeader *)a, 0, 1.5, false);
    nts_set_timeout((NtsHeader *)b, 0, 1.0, false);
    nts_test_host_run(64);
    expect("a fractional delay truncates to whole milliseconds",
           "a@1.5 -> b@1.0");
    nts_release((NtsHeader *)a);
    nts_release((NtsHeader *)b);
}

/* `nts_callback_task` with `nts_post_task`, which is the shape a profile's
 * `setImmediate` takes. Exported for exactly that, so the rule has a case on
 * this side rather than only in a profile. */
static void a_callback_can_be_posted_as_a_task(void) {
    reset();
    Closure *soon = closure("soon");
    nts_post_task(nts_callback_task((NtsHeader *)soon, 0, false));
    Closure *later = closure("later");
    nts_set_timeout((NtsHeader *)later, 0, 1.0, false);
    nts_test_host_run(64);
    expect("a callback posted as a task runs before a timer", "soon -> later");
    nts_release((NtsHeader *)soon);
    nts_release((NtsHeader *)later);
}

int main(void) {
    timers_fire_in_delay_order();
    a_fractional_delay_truncates();
    a_callback_can_be_posted_as_a_task();
    clearing_an_unknown_id_is_a_no_op();
    a_cleared_timer_does_not_fire();
    an_interval_repeats_until_cleared();
    a_negative_delay_is_zero();
    timers_give_their_callbacks_back();
    if (failures) {
        printf("%d failure(s)\n", failures);
        return 1;
    }
    printf("all timer checks agree with the contract\n");
    return 0;
}
