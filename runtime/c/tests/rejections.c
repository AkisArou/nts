/* An unhandled rejection ends the process; a handled one does not.
 *
 * `nts_process_ticks_and_rejections` is named after node's own
 * `processTicksAndRejections` and, until 2026-09-25, only ever drained the
 * queues: a rejected promise nobody listened to was forgotten, so an `async`
 * entry point that threw printed nothing and exited **0**. Every failing async
 * program read as a clean run.
 *
 * The reporting arms `fork`, because the report is `exit(1)` by design -- node
 * ends an unhandled rejection exactly as it ends an uncaught throw -- and a
 * suite that called it directly would end with it. The parent asserts the
 * child's status, which is the thing under test.
 */
#include <stdio.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

#include "nts_test_host.h"

static int failures;

static void ok(const char *what) { printf("ok   %s\n", what); }

static void fail(const char *what, const char *saw) {
  printf("FAIL %s\n  %s\n", what, saw);
  failures++;
}

static void expect(const char *what, bool holds, const char *saw) {
  if (holds) {
    ok(what);
  } else {
    fail(what, saw);
  }
}

static unsigned reactions_run;

static void note_reaction(void *state) {
  (void)state;
  reactions_run++;
}

static NtsTask reaction(void) {
  NtsTask task;
  task.run = note_reaction;
  task.drop = 0;
  task.state = 0;
  return task;
}

static NtsHeader *reason(void) {
  return (NtsHeader *)nts_string_from_utf8("boom", 4);
}

/* The status a child leaves after `body` runs and a checkpoint follows.
 *
 * 1 is the report: `nts_uncaught` exits with node's status. 0 means the
 * checkpoint came and went without reporting, which is what every handled arm
 * must produce. */
static int status_after(void (*body)(void)) {
  fflush(stdout);
  pid_t child = fork();
  if (child == 0) {
    /* The child's own environment: a suite-wide one would carry whatever the
       arms before it left in the queues. */
    nts_test_host_install();
    body();
    nts_checkpoint();
    _exit(0);
  }
  int status = 0;
  waitpid(child, &status, 0);
  return WIFEXITED(status) ? WEXITSTATUS(status) : -1;
}

/* Rejected, with nothing ever subscribed: the subject. */
static void nobody_listens(void) {
  NtsPromise *promise = nts_promise_new();
  nts_promise_reject(promise, reason());
}

/* **Control.** A reaction subscribed before the rejection -- an `await` that
   got there first, which is what every ordinary program does. */
static void listened_first(void) {
  NtsPromise *promise = nts_promise_new();
  nts_promise_subscribe(promise, reaction());
  nts_promise_reject(promise, reason());
}

/* **Control.** Subscribed *after* the rejection and before the checkpoint,
   which is `p.catch(...)` on the next line. Handled: node's check is per turn,
   and this is inside the turn. */
static void listened_after(void) {
  NtsPromise *promise = nts_promise_new();
  nts_promise_reject(promise, reason());
  nts_promise_subscribe(promise, reaction());
}

/* **Control.** Fulfilled rather than rejected, with nothing listening. A check
   that recorded every settled promise would report this one. */
static void fulfilled_alone(void) {
  NtsPromise *promise = nts_promise_new();
  nts_promise_fulfill_number(promise, 1.0);
}

/* The rule, not just the feature: a reaction subscribed **after** the
   checkpoint is too late, and node reports such a rejection too (measured:
   `node --experimental-strip-types` on a `catch` attached from a `setTimeout`
   exits 1). This arm cannot be written as a body above, because the subscribe
   has to happen after the checkpoint the body is followed by. */
static void too_late(void) {
  nts_test_host_install();
  NtsPromise *promise = nts_promise_new();
  nts_promise_reject(promise, reason());
  nts_checkpoint();
  /* Unreachable: the checkpoint reported and exited. If it did not, the
     subscribe below runs and the child exits 0, which the parent reads as the
     failure it is. */
  nts_promise_subscribe(promise, reaction());
  _exit(0);
}

static int status_of_too_late(void) {
  fflush(stdout);
  pid_t child = fork();
  if (child == 0) {
    too_late();
    _exit(0);
  }
  int status = 0;
  waitpid(child, &status, 0);
  return WIFEXITED(status) ? WEXITSTATUS(status) : -1;
}

int main(void) {
  char saw[64];

  int status = status_after(nobody_listens);
  snprintf(saw, sizeof saw, "status %d, wanted 1", status);
  expect("a rejection nobody listened to ends the process", status == 1, saw);

  status = status_after(listened_first);
  snprintf(saw, sizeof saw, "status %d, wanted 0", status);
  expect("a rejection subscribed to first is handled", status == 0, saw);

  status = status_after(listened_after);
  snprintf(saw, sizeof saw, "status %d, wanted 0", status);
  expect("a rejection subscribed to within the turn is handled", status == 0,
         saw);

  status = status_after(fulfilled_alone);
  snprintf(saw, sizeof saw, "status %d, wanted 0", status);
  expect("a fulfilment nobody listened to is not a rejection", status == 0,
         saw);

  status = status_of_too_late();
  snprintf(saw, sizeof saw, "status %d, wanted 1", status);
  expect("a reaction subscribed after the checkpoint is too late", status == 1,
         saw);

  /* The reactions of the handled arms ran in their own children, so this
     process saw none -- which is the check that the arms above were measuring a
     child and not this process. */
  snprintf(saw, sizeof saw, "%u reactions ran here", reactions_run);
  expect("every arm ran in a child of its own", reactions_run == 0, saw);

  printf(failures == 0 ? "rejections: all checks passed\n"
                       : "rejections: %d check(s) failed\n",
         failures);
  return failures == 0 ? 0 : 1;
}
