/* The checkpoint's ordering, against what node actually does.
 *
 * The expected sequences here are not reasoned to. They are transcribed from
 * node, and the program that produced them is in the comment above each one so
 * that a disagreement can be re-run rather than argued about.
 */
#include <stdio.h>
#include <string.h>

#include "nts_test_host.h"

static char trace[512];

static void note(const char *what) {
  if (trace[0]) {
    strncat(trace, " -> ", sizeof(trace) - strlen(trace) - 1);
  }
  strncat(trace, what, sizeof(trace) - strlen(trace) - 1);
}

static int failures;

static void expect(const char *what, const char *want) {
  if (strcmp(trace, want) != 0) {
    printf("FAIL %s\n  got  %s\n  want %s\n", what, trace, want);
    failures++;
  } else {
    printf("ok   %s\n", what);
  }
}

static void reset(void) {
  trace[0] = '\0';
  nts_test_host_install();
}

static NtsTask task_of(void (*run)(void *), void *state) {
  NtsTask task;
  task.run = run;
  task.drop = 0;
  task.state = state;
  return task;
}

static void say(void *state) { note((const char *)state); }

/* A microtask that enqueues a tick, which is the case the second pass of the
 * checkpoint exists for. */
static void microtask_then_tick(void *state) {
  (void)state;
  note("microtask");
  nts_enqueue_tick(task_of(say, (void *)"tick-from-microtask"));
}

/* node, as CommonJS or from inside an fs.readFile callback:
 *
 *   setTimeout(() => order.push("timer"), 0);
 *   setImmediate(() => order.push("immediate"));
 *   process.nextTick(() => order.push("tick"));
 *   Promise.resolve().then(() => {
 *     order.push("microtask");
 *     process.nextTick(() => order.push("tick-from-microtask"));
 *   });
 *
 *   tick -> microtask -> tick-from-microtask -> immediate -> timer
 */
static void ordering(void) {
  reset();
  nts_post_delayed(task_of(say, (void *)"timer"), 0.0, false);
  nts_post_task(task_of(say, (void *)"immediate"));
  nts_enqueue_tick(task_of(say, (void *)"tick"));
  nts_enqueue_microtask(task_of(microtask_then_tick, 0));
  nts_test_host_run(64);
  expect("ticks, then microtasks, then a second pass, then macrotasks",
         "tick -> microtask -> tick-from-microtask -> immediate -> timer");
}

/* A tick enqueued by a tick is still the same drain, not the next one. */
static void tick_from_tick(void *state) {
  (void)state;
  note("tick");
  nts_enqueue_tick(task_of(say, (void *)"nested-tick"));
}

static void ticks_are_a_fixpoint(void) {
  reset();
  nts_post_task(task_of(say, (void *)"immediate"));
  nts_enqueue_tick(task_of(tick_from_tick, 0));
  nts_test_host_run(64);
  expect("a tick enqueued by a tick precedes the next macrotask",
         "tick -> nested-tick -> immediate");
}

/* A microtask enqueued by a microtask, likewise. */
static void microtask_from_microtask(void *state) {
  (void)state;
  note("microtask");
  nts_enqueue_microtask(task_of(say, (void *)"nested-microtask"));
}

static void microtasks_are_a_fixpoint(void) {
  reset();
  nts_post_task(task_of(say, (void *)"immediate"));
  nts_enqueue_microtask(task_of(microtask_from_microtask, 0));
  nts_test_host_run(64);
  expect("a microtask enqueued by a microtask precedes the next macrotask",
         "microtask -> nested-microtask -> immediate");
}

/* Every task gets a full checkpoint, not just the first. */
static void immediate_then_tick(void *state) {
  (void)state;
  note("immediate");
  nts_enqueue_tick(task_of(say, (void *)"tick-after-immediate"));
}

static void every_task_checkpoints(void) {
  reset();
  nts_post_task(task_of(immediate_then_tick, 0));
  nts_post_task(task_of(say, (void *)"second-immediate"));
  nts_test_host_run(64);
  expect("a tick queued by one macrotask runs before the next",
         "immediate -> tick-after-immediate -> second-immediate");
}

/* Timers fire in deadline order, and virtual time advances to reach them. */
static void timers_advance_the_clock(void) {
  reset();
  nts_post_delayed(task_of(say, (void *)"late"), 50.0, false);
  nts_post_delayed(task_of(say, (void *)"early"), 5.0, false);
  nts_test_host_run(64);
  expect("timers run in deadline order", "early -> late");
  if (nts_test_host_now() < 50.0) {
    printf("FAIL the clock did not reach the last deadline (%g)\n",
           nts_test_host_now());
    failures++;
  } else {
    printf("ok   the clock advanced to the last deadline\n");
  }
}

/* Cancelling gives the task back rather than dropping it on the floor. */
static void dropped(void *state) {
  (void)state;
  note("SHOULD NOT RUN");
}
static void counted_drop(void *state) {
  (void)state;
  note("dropped");
}

static void cancel_returns_the_task(void) {
  reset();
  NtsTask task;
  task.run = dropped;
  task.drop = counted_drop;
  task.state = 0;
  NtsTimerId id = nts_post_delayed(task, 10.0, false);
  nts_post_delayed(task_of(say, (void *)"survivor"), 20.0, false);
  nts_cancel_delayed(id);
  nts_test_host_run(64);
  expect("a cancelled task is dropped, not run", "dropped -> survivor");
  if (nts_test_host_dropped() != 1) {
    printf("FAIL expected one dropped task, saw %u\n", nts_test_host_dropped());
    failures++;
  } else {
    printf("ok   the drop was accounted for\n");
  }
}

/* One task running two callbacks, with a checkpoint between them: node's timer
 * batch. `nts_checkpoint` is what a capability calls to get that ordering. */
static void batch_with_a_checkpoint(void *state) {
  (void)state;
  note("A");
  nts_enqueue_tick(task_of(say, (void *)"tick-A"));
  nts_enqueue_microtask(task_of(say, (void *)"micro-A"));
  nts_checkpoint();
  note("B");
}

/* The same batch without it, which is what the runtime did before: the
 * checkpoint waits for the task to end, so both callbacks run first. */
static void batch_without_a_checkpoint(void *state) {
  (void)state;
  note("A");
  nts_enqueue_tick(task_of(say, (void *)"tick-A"));
  nts_enqueue_microtask(task_of(say, (void *)"micro-A"));
  note("B");
}

/* Transcribed from node v24, and it is the *whole* checkpoint rather than a
 * tick drain -- `micro-A` lands before `B`:
 *
 *   setTimeout(() => { push("A"); nextTick(() => push("tick-A"));
 *                                 queueMicrotask(() => push("micro-A")); }, 5);
 *   setTimeout(() => push("B"), 5);
 *   -> A -> tick-A -> micro-A -> B
 *
 * Node decides a batch at wakeup and runs it to completion, calling
 * `runNextTicks` between callbacks, so this cannot be had by ending the task
 * and letting the drain do it. The pair is the assertion: the same batch
 * without the call gives the other order. */
static void a_checkpoint_runs_between_two_callbacks_of_one_task(void) {
  reset();
  nts_post_task(task_of(batch_with_a_checkpoint, 0));
  nts_test_host_run(64);
  expect("a checkpoint inside a task runs ticks and microtasks before the next "
         "callback",
         "A -> tick-A -> micro-A -> B");

  reset();
  nts_post_task(task_of(batch_without_a_checkpoint, 0));
  nts_test_host_run(64);
  expect("without it, both callbacks run before either queue drains",
         "A -> B -> tick-A -> micro-A");
}

int main(void) {
  ordering();
  a_checkpoint_runs_between_two_callbacks_of_one_task();
  ticks_are_a_fixpoint();
  microtasks_are_a_fixpoint();
  every_task_checkpoints();
  timers_advance_the_clock();
  cancel_returns_the_task();
  if (failures) {
    printf("%d failure(s)\n", failures);
    return 1;
  }
  printf("all ordering checks agree with node\n");
  return 0;
}
