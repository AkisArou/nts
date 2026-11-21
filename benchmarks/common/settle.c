/* A promised workload's side of the native harness (tooling/bench's
 * `loop_host.rs`): the libuv host a standalone program installs, and the join
 * that waits for one call's promise on it.
 *
 * A workload answering `Promise<number>` has done its work only once that
 * promise settles: its timers, promise jobs and I/O completions run on the
 * loop after the call returns. So `bench_run` calls the workload and then
 * `nts_bench_settle`, and one timed call is one fixed amount of event-loop
 * work, as `await` makes it in node's and Bun's columns.
 *
 * C rather than the generated C++ driver: the runtime's header is C. */

/* Before any header, as in a standalone program's `main`: libuv's Unix header
 * names POSIX types a strict `-std=c11` unit cannot otherwise see. */
#if defined(__linux__) && !defined(_GNU_SOURCE)
/* NOLINTNEXTLINE(bugprone-reserved-identifier) */
#define _GNU_SOURCE
#endif

#include "nts_runtime.h"
#include "nts_uv_host.h"

#include <stdio.h>
#include <stdlib.h>

/* The libuv host, with the loop a standalone runner gets: deferred until work
 * needs it. Called once, before module evaluation. */
void nts_bench_host_start(void);
void nts_bench_host_start(void) { nts_uv_host_install(NULL); }

/* Module evaluation is itself a job, so what it queued is drained before the
 * first call, as a standalone program's `main` drains it. */
void nts_bench_drain(void);
void nts_bench_drain(void) {
  nts_enter();
  nts_leave();
}

static const char *join_failure(NtsPromiseJoinResult result) {
  switch (result) {
  case NTS_JOIN_PENDING:
    return "is still pending, and the loop has no registered work left";
  case NTS_JOIN_REJECTED:
    return "was rejected";
  case NTS_JOIN_UNSUPPORTED:
    return "needs a host that cannot be driven synchronously";
  case NTS_JOIN_WRONG_THREAD:
    return "belongs to another thread";
  case NTS_JOIN_REENTRANT:
    return "was joined from inside a task or checkpoint";
  case NTS_JOIN_FULFILLED:
    break;
  }
  return "settled in an unknown state";
}

/* Wait for one call's promise, and answer its number. A promise that does
 * not fulfil with one ends the run by name: a benchmark that timed a
 * rejection would be timing the wrong work. Takes the call's reference. */
double nts_bench_settle(NtsPromise *promise);
double nts_bench_settle(NtsPromise *promise) {
  const NtsPromiseJoinResult result = nts_promise_join(promise);
  if (result != NTS_JOIN_FULFILLED) {
    fprintf(stderr, "nts-bench: the workload's promise %s\n",
            join_failure(result));
    exit(1);
  }
  const NtsValue value = nts_promise_value(promise);
  if (nts_value_tag(value) != NTS_TAG_NUMBER) {
    fprintf(stderr, "nts-bench: the workload's promise fulfilled with a "
                    "value that is not a number\n");
    exit(1);
  }
  const double answer = nts_value_number(value);
  nts_release((NtsHeader *)promise);
  return answer;
}
