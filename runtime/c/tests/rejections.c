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
#include <signal.h>
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

/* --- A host that owns checkpointing ------------------------------------------
 *
 * A Blink renderer: it supplies `enqueue_microtask`, so our queues and our
 * drain stand aside and its checkpoint runs our microtasks. Until 2026-10-07
 * nothing ran the half of a checkpoint after the drain under such a host -- a
 * rejection was neither reported nor released -- and the Chromium lane found it
 * as four objects left live per rejected promise. `nts_host_checkpoint_end` is
 * the host's call at the end of its checkpoint. Only `enqueue_microtask` is
 * filled in, so an arm that reached for anything else would crash and read as
 * a failure. */

static NtsTask held[16];
static unsigned held_len;

static void hold(void *state, NtsTask task) {
  (void)state;
  held[held_len++] = task;
}

static void host_owned_install(void) {
  NtsHost host;
  memset(&host, 0, sizeof host);
  host.enqueue_microtask = hold;
  nts_host_install(&host);
}

/* The host's checkpoint: its queue to a fixpoint, then -- when `end` -- the
   call this section is about. */
static void host_checkpoint(bool end) {
  unsigned at = 0;
  while (at < held_len) {
    NtsTask task = held[at++];
    task.run(task.state);
  }
  held_len = 0;
  if (end) {
    nts_host_checkpoint_end();
  }
}

static int status_under_host(void (*body)(void), bool end) {
  fflush(stdout);
  pid_t child = fork();
  if (child == 0) {
    host_owned_install();
    body();
    host_checkpoint(end);
    _exit(0);
  }
  int status = 0;
  waitpid(child, &status, 0);
  return WIFEXITED(status) ? WEXITSTATUS(status) : -1;
}

static NtsPromise *later_subscriber;

static void subscribe_later(void *state) {
  (void)state;
  nts_promise_subscribe(later_subscriber, reaction());
}

/* Rejected with nobody listening, and handled by a microtask the host's
   checkpoint runs *after* the rejection: still the same checkpoint, so
   handled -- which is why the runtime cannot report from a microtask of its
   own and the host has to say when its checkpoint ends. */
static void handled_later_in_the_checkpoint(void) {
  later_subscriber = nts_promise_new();
  nts_promise_reject(later_subscriber, reason());
  NtsTask task;
  task.run = subscribe_later;
  task.drop = 0;
  task.state = 0;
  nts_enqueue_microtask(task);
}

/* The call from a host that does not own checkpointing, which would otherwise
   be told nothing was wrong: refused, loudly. */
static int status_of_the_wrong_host(void) {
  fflush(stdout);
  pid_t child = fork();
  if (child == 0) {
    /* Its message is the refusal, and not this suite's output. */
    freopen("/dev/null", "w", stderr);
    nts_test_host_install();
    nts_host_checkpoint_end();
    _exit(0);
  }
  int status = 0;
  waitpid(child, &status, 0);
  return WIFSIGNALED(status) && WTERMSIG(status) == SIGABRT ? -6
         : WIFEXITED(status) ? WEXITSTATUS(status)
                             : -1;
}

#ifdef NTS_PROVIDER_RC
/* The leak, measured: a rejection handled within the checkpoint, with the
   program's own reference dropped, leaves nothing live once the host's
   checkpoint ends -- 0 -- and without the call stays held (2). */
static int leak_under_host(bool end) {
  fflush(stdout);
  pid_t child = fork();
  if (child == 0) {
    host_owned_install();
    size_t before = nts_live_count();
    NtsPromise *promise = nts_promise_new();
    /* `reject` retains its reason, so the arm drops its own reference to it
       as it does the promise's: kept, it alone read as the leak, in both. */
    NtsHeader *why = reason();
    nts_promise_reject(promise, why);
    nts_release(why);
    nts_promise_subscribe(promise, reaction());
    nts_release((NtsHeader *)promise);
    host_checkpoint(end);
    _exit(nts_live_count() == before ? 0 : 2);
  }
  int status = 0;
  waitpid(child, &status, 0);
  return WIFEXITED(status) ? WEXITSTATUS(status) : -1;
}
#endif

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

  status = status_under_host(nobody_listens, true);
  snprintf(saw, sizeof saw, "status %d, wanted 1", status);
  expect("under a host that owns checkpointing, its checkpoint's end reports "
         "a rejection nobody listened to",
         status == 1, saw);

  status = status_under_host(nobody_listens, false);
  snprintf(saw, sizeof saw, "status %d, wanted 0", status);
  expect("control: without the call, nothing reports it -- the defect",
         status == 0, saw);

  status = status_under_host(handled_later_in_the_checkpoint, true);
  snprintf(saw, sizeof saw, "status %d, wanted 0", status);
  expect("a handler a later microtask of the host's checkpoint attaches is in "
         "time",
         status == 0, saw);

  status = status_of_the_wrong_host();
  snprintf(saw, sizeof saw, "status %d, wanted the abort", status);
  expect("a host that does not own checkpointing is refused the call",
         status == -6, saw);

#ifdef NTS_PROVIDER_RC
  status = leak_under_host(true);
  snprintf(saw, sizeof saw, "status %d, wanted 0 (nothing left live)", status);
  expect("a handled rejection is released at the host's checkpoint's end",
         status == 0, saw);

  status = leak_under_host(false);
  snprintf(saw, sizeof saw, "status %d, wanted 2 (still held)", status);
  expect("control: without the call, it stays live -- the leak", status == 2,
         saw);
#endif

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
