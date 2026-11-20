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
#include <stdlib.h>
#include <string.h>

#include "nts_uv_host.h"

/* The harness substitutes only these two libuv entries. The production host
 * remains a separate translation unit. Count the avoided default-loop call,
 * and force a foreign post to attempt the lock while activation holds it. */
#if defined(uv_default_loop) && defined(uv_mutex_lock)
#undef uv_default_loop
#undef uv_mutex_lock
uv_loop_t *uv_default_loop(void);
void uv_mutex_lock(uv_mutex_t *mutex);
static unsigned default_loop_requests;
static bool force_activation_race;
static uv_thread_t activation_owner;
static uv_sem_t activation_entered;
static uv_sem_t foreign_attempted;

uv_loop_t *nts_probe_default_loop(void) {
  default_loop_requests++;
  if (force_activation_race) {
    uv_sem_post(&activation_entered);
    uv_sem_wait(&foreign_attempted);
  }
  return uv_default_loop();
}

void nts_probe_mutex_lock(uv_mutex_t *mutex) {
  uv_thread_t self = uv_thread_self();
  if (force_activation_race && !uv_thread_equal(&activation_owner, &self)) {
    uv_sem_post(&foreign_attempted);
  }
  uv_mutex_lock(mutex);
}
#endif

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

/* An id this host never issued. The slot table is what knows -- an index past
 * its end, or one whose generation does not match -- so a program that clears a
 * timer it is unsure about needs no guard of its own. */
static void an_id_this_host_never_issued_is_a_no_op(void) {
  start();
  nts_post_delayed(reaction("kept"), 1.0, false);
  nts_cancel_delayed(0);
  nts_cancel_delayed(999999);
  nts_cancel_delayed(0xFFFFFFFFFFFFFFFFull);
  nts_uv_host_run();
  expect("an id this host never issued disturbs nothing", "kept");
  finish();
}

/* The same expected sequence `timers.c` asserts on the deterministic host.
 *
 * That it is the same sequence is the assertion. These two hosts used to order
 * this program oppositely, because each converted the delay itself -- one kept
 * the fraction in a `double` clock, the other truncated to libuv's whole
 * milliseconds. `nts_delay` decides once now, and both are handed the same
 * thing. */
static void a_fractional_delay_truncates(void) {
  start();
  nts_post_delayed(reaction("a@1.5"), 1.5, false);
  nts_post_delayed(reaction("b@1.0"), 1.0, false);
  nts_uv_host_run();
  expect("a fractional delay truncates to whole milliseconds",
         "a@1.5 -> b@1.0");
  finish();
}

#if !defined(NTS_HOST_COUNT_ONLY)
static void check(const char *what, bool agrees) {
  if (!agrees) {
    printf("FAIL %s\n", what);
    failures++;
  } else {
    printf("ok   %s\n", what);
  }
}

#if defined(__linux__)
/* The same descriptor census before and after also detects creating the
 * backend and leaving it open. It does not itself ask libuv for a loop. */
#include <dirent.h>
static unsigned descriptors(void) {
  DIR *directory = opendir("/proc/self/fd");
  if (!directory) {
    abort();
  }
  unsigned count = 0;
  while (readdir(directory)) {
    count++;
  }
  closedir(directory);
  return count;
}
#endif

static void an_unused_default_host_never_creates_a_loop(void) {
#if defined(__linux__)
  unsigned before = descriptors();
#endif
  nts_uv_host_install(NULL);
  check("an unused default host returns without work", nts_uv_host_run() == 0);
  nts_uv_host_pump();
  nts_cancel_delayed(0);
  nts_uv_host_shutdown();
#if defined(__linux__)
  check("an unused default host creates no descriptors",
        descriptors() == before);
#endif
  check("an unused default host never asks for the loop",
        default_loop_requests == 0);
}

static void a_lazy_task_activates_once_and_keeps_checkpoints(void) {
  trace[0] = '\0';
  unsigned before = default_loop_requests;
  nts_uv_host_install(NULL);
  nts_post_task((NtsTask){task_then_microtask, 0, (void *)"first"});
  nts_post_task(reaction("second"));
  nts_uv_host_run();
  expect("lazy tasks keep the checkpoint order", "first -> micro -> second");
  check("lazy tasks activate the default loop once",
        default_loop_requests == before + 1);
  nts_uv_host_shutdown();
  check("lazy task handles all close", uv_loop_close(uv_default_loop()) == 0);
}

static void a_lazy_timer_activates_once(void) {
  trace[0] = '\0';
  unsigned before = default_loop_requests;
  nts_uv_host_install(NULL);
  nts_post_delayed(reaction("timer"), 0, false);
  nts_uv_host_run();
  expect("a lazy timer fires", "timer");
  check("a timer activates once", default_loop_requests == before + 1);
  nts_uv_host_shutdown();
  check("lazy timer handles all close", uv_loop_close(uv_default_loop()) == 0);
}

static void a_foreign_post_before_activation_runs_without_a_loop(void) {
  trace[0] = '\0';
  unsigned before = default_loop_requests;
  nts_uv_host_install(NULL);
  owner_thread = uv_thread_self();
  foreign_ran_on_owner = false;
  uv_thread_t worker;
  uv_thread_create(&worker, foreign_thread, 0);
  uv_thread_join(&worker);
  nts_uv_host_run();
  expect("a preactivation foreign post runs exactly once", "foreign");
  check("a preactivation foreign post runs on the owner", foreign_ran_on_owner);
  check("a foreign post alone needs no backend",
        default_loop_requests == before);
  nts_uv_host_shutdown();
}

static void racing_foreign_thread(void *state) {
  (void)state;
  uv_sem_wait(&activation_entered);
  foreign_thread(NULL);
}

static void foreign_posts_race_activation_without_loss_or_duplication(void) {
  unsigned before = default_loop_requests;
  bool agrees = true;
  for (unsigned round = 0; round < 200; round++) {
    trace[0] = '\0';
    owner_thread = activation_owner = uv_thread_self();
    foreign_ran_on_owner = false;
    uv_sem_init(&activation_entered, 0);
    uv_sem_init(&foreign_attempted, 0);
    force_activation_race = true;
    nts_uv_host_install(NULL);
    uv_thread_t worker;
    uv_thread_create(&worker, racing_foreign_thread, NULL);
    /* The default-loop wrapper waits for the foreign thread to enter its
     * post while the owner holds the activation lock. */
    nts_post_task(reaction("task"));
    uv_thread_join(&worker);
    force_activation_race = false;
    nts_uv_host_run();
    agrees =
        agrees && strcmp(trace, "foreign -> task") == 0 && foreign_ran_on_owner;
    nts_uv_host_shutdown();
    agrees = agrees && uv_loop_close(uv_default_loop()) == 0;
    uv_sem_destroy(&activation_entered);
    uv_sem_destroy(&foreign_attempted);
  }
  check("200 forced activation/post interleavings run each task once", agrees);
  check("each racing host activates exactly once",
        default_loop_requests == before + 200);
}

static unsigned transitioned_tasks;
static unsigned preserved_foreign;
static unsigned preserved_microtasks;
static unsigned owner_checks;
static int transition_state;

static bool transition_owner(void *state) {
  owner_checks++;
  return state == &transition_state;
}
static void transition_post(void *state, NtsTask task) {
  if (state == &transition_state) {
    transitioned_tasks++;
  }
  nts_task_run(task);
}
static void transition_foreign(void *state, NtsTask task) {
  (void)task;
  if (state == &transition_state) {
    preserved_foreign++;
  }
}
static void transition_microtask(void *state, NtsTask task) {
  (void)task;
  if (state == &transition_state) {
    preserved_microtasks++;
  }
}

static void activation_keeps_the_foreign_contract_immutable(void) {
  NtsHost host = {.post_from_any_thread = transition_foreign,
                  .is_owner_thread = transition_owner,
                  .enqueue_microtask = transition_microtask,
                  .state = &transition_state};
  nts_host_install(&host);
  /* All immutable fields intentionally differ from the installed host. An
   * accidental full-vtable replacement fails this control. */
  NtsHost active = {.post_task = transition_post};
  nts_host_activate(&active);
  check("activation asserts the installed owner identity", owner_checks == 1);
  trace[0] = '\0';
  nts_post_task(reaction("active"));
  nts_post_from_any_thread(reaction("unused"));
  nts_enqueue_microtask(reaction("unused"));
  expect("activation replaces the owner task entry", "active");
  check("activation preserves the owner callback state",
        transitioned_tasks == 1);
  check("activation preserves owner identity", nts_is_owner_thread());
  check("activation preserves state and foreign entry", preserved_foreign == 1);
  check("activation preserves checkpoint policy", preserved_microtasks == 1);
}
#endif

/* A fixed-work count entry in the same harness. Count N minus count 0 to
 * exclude install/shutdown. Each iteration posts a task, schedules and fires
 * a timer, begins pending work and delivers its completion through the
 * foreign-post seam. Actual foreign-thread ordering is forced above. */
static unsigned counted_callbacks;
static void count_callback(void *state) {
  (void)state;
  counted_callbacks++;
}
static void count_completion(void *state) {
  count_callback(state);
  nts_pending_end();
}
static void count_iteration(void) {
  nts_post_task((NtsTask){count_callback, 0, 0});
  nts_post_delayed((NtsTask){count_callback, 0, 0}, 0, false);
  nts_pending_begin();
  nts_post_from_any_thread((NtsTask){count_completion, 0, 0});
  nts_uv_host_run();
}
static int count_work(unsigned count, bool lazy) {
  if (!lazy) {
    uv_loop_init(&loop);
  }
  nts_uv_host_install(lazy ? NULL : &loop);
  if (!lazy) {
    /* Warm the queue/table storage and lazy DSO bindings in both the empty
     * and work arms. --activate measures first work separately. */
    count_iteration();
    counted_callbacks = 0;
  }
  for (unsigned i = 0; i < count; i++) {
    count_iteration();
  }
  nts_uv_host_shutdown();
  int closed = lazy ? (count ? uv_loop_close(uv_default_loop()) : 0)
                    : uv_loop_close(&loop);
  printf("counted %u callbacks\n", counted_callbacks);
  return closed != 0 || counted_callbacks != count * 3;
}

int main(int argc, char **argv) {
  if (argc == 3 && strcmp(argv[1], "--count") == 0) {
    return count_work((unsigned)strtoul(argv[2], NULL, 10), false);
  }
  if (argc == 3 && strcmp(argv[1], "--activate") == 0) {
    return count_work((unsigned)strtoul(argv[2], NULL, 10), true);
  }
#if !defined(NTS_HOST_COUNT_ONLY)
  an_unused_default_host_never_creates_a_loop();
  a_lazy_task_activates_once_and_keeps_checkpoints();
  a_lazy_timer_activates_once();
  a_foreign_post_before_activation_runs_without_a_loop();
  foreign_posts_race_activation_without_loss_or_duplication();
  activation_keeps_the_foreign_contract_immutable();
#endif
  a_microtask_runs_before_the_next_task();
  a_fractional_delay_truncates();
  an_id_this_host_never_issued_is_a_no_op();
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
