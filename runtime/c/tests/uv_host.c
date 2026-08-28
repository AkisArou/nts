/* The libuv host, against the same orderings the deterministic host keeps.
 *
 * That is the claim the seam makes: a host is a configuration, not a fork. If
 * the two hosts disagree about anything a program can observe, the disagreement
 * is a contract bug rather than a host quirk -- so these assert the *runtime's*
 * rules (a checkpoint between tasks, timers in delay order) on a real loop,
 * rather than testing libuv.
 */
#if defined(__linux__) && !defined(_GNU_SOURCE)
#define _GNU_SOURCE
#endif

#include <stdio.h>
#include <string.h>

#include "nts_uv_host.h"

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

static void say(void *state) { note((const char *)state); }

static NtsTask reaction(const char *label) {
    NtsTask task;
    task.run = say;
    task.drop = 0;
    task.state = (void *)label;
    return task;
}

/* A loop per check rather than the default one, so a check that left something
 * behind fails the next `uv_loop_close` instead of quietly affecting whatever
 * ran after it. */
static uv_loop_t loop;

/* A deadline, so that a broken check fails rather than hangs.
 *
 * Not decoration: sabotaging the delay clamp -- passing a negative delay
 * through to `uv_timer_start`, where it becomes an enormous unsigned one --
 * left the loop blocked forever rather than failing, and a suite that hangs on
 * a regression is worse than one that misses it. Unreferenced, so it cannot
 * itself keep the loop alive or change any ordering. */
static uv_timer_t watchdog;

static void give_up(uv_timer_t *handle) {
    (void)handle;
    printf("FAIL a check did not finish within two seconds\n");
    failures++;
    uv_stop(&loop);
}

static void start(void) {
    trace[0] = '\0';
    uv_loop_init(&loop);
    nts_uv_host_install(&loop);
    uv_timer_init(&loop, &watchdog);
    uv_unref((uv_handle_t *)&watchdog);
    uv_timer_start(&watchdog, give_up, 2000, 0);
}

static void finish(void) {
    uv_close((uv_handle_t *)&watchdog, 0);
    nts_uv_host_shutdown();
    int left = uv_loop_close(&loop);
    if (left != 0) {
        printf("FAIL the loop still had handles after shutdown (%s)\n",
               uv_err_name(left));
        failures++;
    }
}

/* A task that queues a microtask, so the checkpoint is observable: the
 * microtask has to run before the *next* task, not after both. */
static void task_then_microtask(void *state) {
    note((const char *)state);
    nts_enqueue_microtask(reaction("micro"));
}

static void a_microtask_runs_before_the_next_task(void) {
    start();
    NtsTask first = {task_then_microtask, 0, (void *)"first"};
    nts_post_task(first);
    nts_post_task(reaction("second"));
    nts_uv_host_run();
    expect("a microtask runs before the next posted task",
           "first -> micro -> second");
    finish();
}

static void tasks_run_in_the_order_they_were_posted(void) {
    start();
    nts_post_task(reaction("a"));
    nts_post_task(reaction("b"));
    nts_post_task(reaction("c"));
    nts_uv_host_run();
    expect("posted tasks run in order", "a -> b -> c");
    finish();
}

static void timers_fire_in_delay_order(void) {
    start();
    nts_post_delayed(reaction("late"), 20.0, false);
    nts_post_delayed(reaction("early"), 1.0, false);
    nts_post_delayed(reaction("middle"), 10.0, false);
    nts_uv_host_run();
    expect("timers fire in delay order", "early -> middle -> late");
    finish();
}

/* Equal deadlines are creation order, which is what `setTimeout` guarantees
 * and what a heap does not give for free. */
static void equal_delays_fire_in_creation_order(void) {
    start();
    nts_post_delayed(reaction("one"), 1.0, false);
    nts_post_delayed(reaction("two"), 1.0, false);
    nts_post_delayed(reaction("three"), 1.0, false);
    nts_uv_host_run();
    expect("equal delays fire in creation order", "one -> two -> three");
    finish();
}

static void a_negative_delay_is_zero(void) {
    start();
    nts_post_delayed(reaction("negative"), -5.0, false);
    nts_post_delayed(reaction("later"), 15.0, false);
    nts_uv_host_run();
    expect("a negative delay is zero rather than never", "negative -> later");
    finish();
}

static void cancelling_a_pending_timer_drops_it(void) {
    start();
    NtsTimerId cancelled = nts_post_delayed(reaction("cancelled"), 5.0, false);
    nts_post_delayed(reaction("kept"), 10.0, false);
    nts_cancel_delayed(cancelled);
    nts_uv_host_run();
    expect("a cancelled timer does not run", "kept");
    if (nts_uv_host_dropped() != 1) {
        printf("FAIL a cancelled timer was not counted as dropped (%u)\n",
               nts_uv_host_dropped());
        failures++;
    } else {
        printf("ok   a cancelled timer is counted as dropped\n");
    }
    finish();
}

/* The case the generation counter exists for.
 *
 * `clearTimeout` of a timer that already fired is legal and common. Without a
 * generation the slot would have been reused by then, and the stale id would
 * cancel whichever timer took its place -- a bug that needs two timers and a
 * fire in between to reach, which is to say one no ordinary test produces. */
static void clearing_a_fired_timer_does_not_cancel_its_successor(void) {
    start();
    NtsTimerId first = nts_post_delayed(reaction("first"), 1.0, false);
    nts_uv_host_run();

    NtsTimerId second = nts_post_delayed(reaction("second"), 1.0, false);
    if (first == second) {
        printf("FAIL a reused slot handed out the same id twice\n");
        failures++;
    }
    nts_cancel_delayed(first);
    nts_uv_host_run();
    expect("clearing a fired timer leaves its successor alone",
           "first -> second");
    finish();
}

static int rounds;
static NtsTimerId repeating;

static void repeat_tick(void *state) {
    (void)state;
    note("tick");
    rounds++;
    if (rounds == 3) {
        /* Cancelling from inside the callback, which is the only way a
         * repeating timer ever stops. */
        nts_cancel_delayed(repeating);
    }
}

static void a_repeating_timer_repeats_until_cancelled(void) {
    start();
    rounds = 0;
    NtsTask task = {repeat_tick, 0, 0};
    repeating = nts_post_delayed(task, 1.0, true);
    nts_uv_host_run();
    expect("a repeating timer repeats until cancelled", "tick -> tick -> tick");
    finish();
}

/* Posted from a thread the runtime does not own. Every foreign completion goes
 * through this, because settling a promise is a heap mutation and the heap has
 * one owner. */
static bool foreign_ran_on_owner;
static uv_thread_t owner_thread;

static void from_foreign(void *state) {
    (void)state;
    uv_thread_t self = uv_thread_self();
    foreign_ran_on_owner = uv_thread_equal(&owner_thread, &self);
    note("foreign");
}

static void foreign_thread(void *arg) {
    (void)arg;
    NtsTask task = {from_foreign, 0, 0};
    nts_post_from_any_thread(task);
}

static void a_foreign_post_runs_on_the_owner_thread(void) {
    start();
    owner_thread = uv_thread_self();
    foreign_ran_on_owner = false;
    /* A keep-alive, because the cross-thread handle is unreferenced: without
     * something else pending, `uv_run` would return before the other thread
     * had posted anything. */
    nts_post_delayed(reaction("keepalive"), 30.0, false);
    uv_thread_t worker;
    uv_thread_create(&worker, foreign_thread, 0);
    uv_thread_join(&worker);
    nts_uv_host_run();
    if (!strstr(trace, "foreign")) {
        printf("FAIL a foreign post never ran (%s)\n", trace);
        failures++;
    } else if (!foreign_ran_on_owner) {
        printf("FAIL a foreign post ran on the wrong thread\n");
        failures++;
    } else {
        printf("ok   a foreign post runs on the owner thread\n");
    }
    finish();
}

static void shutdown_drops_what_is_left(void) {
    start();
    nts_post_task(reaction("never"));
    nts_post_delayed(reaction("never either"), 10000.0, false);
    uint32_t before = nts_uv_host_dropped();
    nts_uv_host_shutdown();
    uint32_t dropped = nts_uv_host_dropped() - before;
    if (dropped != 2) {
        printf("FAIL shutdown dropped %u of 2 pending tasks\n", dropped);
        failures++;
    } else {
        printf("ok   shutdown drops what is still queued\n");
    }
    uv_loop_close(&loop);
}

int main(void) {
    a_microtask_runs_before_the_next_task();
    tasks_run_in_the_order_they_were_posted();
    timers_fire_in_delay_order();
    equal_delays_fire_in_creation_order();
    a_negative_delay_is_zero();
    cancelling_a_pending_timer_drops_it();
    clearing_a_fired_timer_does_not_cancel_its_successor();
    a_repeating_timer_repeats_until_cancelled();
    a_foreign_post_runs_on_the_owner_thread();
    shutdown_drops_what_is_left();
    if (failures) {
        printf("%d failure(s)\n", failures);
        return 1;
    }
    printf("all libuv host checks agree with the contract\n");
    return 0;
}
