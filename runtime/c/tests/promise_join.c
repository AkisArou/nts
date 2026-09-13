/* The same wait contract on a deterministic clock and on libuv. */
#if defined(NTS_JOIN_UV)
#include "nts_uv_host.h"
#else
#include "nts_test_host.h"
#endif
#include <stdio.h>

static int failures;
static void expect(const char *name, bool yes) {
  printf("%s %s\n", yes ? "ok" : "FAIL", name);
  failures += !yes;
}

static void fulfill(void *state) {
  nts_promise_fulfill_number((NtsPromise *)state, 42);
}
static NtsTask settlement(NtsPromise *promise) {
  return (NtsTask){fulfill, 0, promise};
}
static void release(NtsPromise *promise) { nts_release((NtsHeader *)promise); }
static bool wrong_owner(void *state) {
  (void)state;
  return false;
}
static bool checkpoint_finished;
static void finish_checkpoint(void *state) {
  (void)state;
  checkpoint_finished = true;
}
static NtsHostPumpResult idle_settlement(void *state) {
  fulfill(state);
  return NTS_HOST_PUMP_IDLE;
}

static void without_a_loop(void) {
  NtsPromise *promise = nts_promise_new();
  expect("no host reports unsupported",
         nts_promise_join(promise) == NTS_JOIN_UNSUPPORTED);
  nts_enqueue_microtask(settlement(promise));
  nts_enqueue_microtask((NtsTask){finish_checkpoint, 0, 0});
  expect("microtask alone settles",
         nts_promise_join(promise) == NTS_JOIN_FULFILLED);
  expect("settlement finishes the checkpoint", checkpoint_finished);
  expect("fulfilled payload survives wait", nts_promise_number(promise) == 42);
  release(promise);

  promise = nts_promise_new();
  NtsHost host = {0};
  nts_host_install(&host);
  expect("host without pump reports unsupported",
         nts_promise_join(promise) == NTS_JOIN_UNSUPPORTED);
  host.is_owner_thread = wrong_owner;
  nts_host_install(&host);
  // Invalid on purpose: the thread check must precede even the first read.
  expect("wrong thread refuses before reading",
         nts_promise_join((NtsPromise *)1) == NTS_JOIN_WRONG_THREAD);
  host.is_owner_thread = 0;
  host.pump_one = idle_settlement;
  host.state = promise;
  nts_host_install(&host);
  expect("idle result can still settle",
         nts_promise_join(promise) == NTS_JOIN_FULFILLED);
  release(promise);
}

static NtsPromiseJoinResult nested_result;
static void nested_join(void *state) {
  nested_result = nts_promise_join((NtsPromise *)state);
}
static int timer_runs;
static void count_timer(void *state) {
  (void)state;
  timer_runs++;
}

#if defined(NTS_JOIN_UV)
static uv_loop_t loop;
static void start(void) {
  if (uv_loop_init(&loop)) {
    failures++;
    return;
  }
  nts_uv_host_install(&loop);
}
static void finish(void) {
  nts_uv_host_shutdown();
  expect("all host handles close", uv_loop_close(&loop) == 0);
}
static NtsPromiseJoinResult worker_result;
static uv_sem_t worker_ready;
static void worker(void *state) {
  worker_result = nts_promise_join((NtsPromise *)1);
  nts_post_from_any_thread(settlement((NtsPromise *)state));
}
static void waiting_worker(void *state) {
  uv_sem_wait(&worker_ready);
  worker(state);
}
static void wake_worker(void *state) {
  (void)state;
  uv_sem_post(&worker_ready);
}
static void cross_thread(void) {
  start();
  NtsPromise *promise = nts_promise_new();
  uv_thread_t thread;
  uv_thread_create(&thread, worker, promise);
  uv_thread_join(&thread);
  expect("worker cannot join owner heap",
         worker_result == NTS_JOIN_WRONG_THREAD);
  expect("queued unreferenced async completion runs",
         nts_promise_join(promise) == NTS_JOIN_FULFILLED);
  release(promise);

  promise = nts_promise_new();
  // Registered liveness lets the owner block for a worker's future post.
  NtsTimerId live = nts_post_delayed((NtsTask){count_timer, 0, 0}, 100, true);
  uv_sem_init(&worker_ready, 0);
  uv_thread_create(&thread, waiting_worker, promise);
  // The worker cannot post until the join has driven this timer.
  nts_post_delayed((NtsTask){wake_worker, 0, 0}, 1, false);
  expect("live loop accepts worker completion",
         nts_promise_join(promise) == NTS_JOIN_FULFILLED);
  uv_thread_join(&thread);
  uv_sem_destroy(&worker_ready);
  nts_cancel_delayed(live);
  release(promise);
  finish();
}
#else
static void start(void) { nts_test_host_install(); }
static void finish(void) { nts_test_host_drain(); }
#endif

static void with_a_loop(void) {
  start();
  NtsPromise *promise = nts_promise_new();
  expect("idle host keeps pending distinct",
         nts_promise_join(promise) == NTS_JOIN_PENDING);
  expect("pending was not fulfilled",
         nts_promise_state(promise) == NTS_PROMISE_PENDING);

  nested_result = NTS_JOIN_PENDING;
  nts_enqueue_microtask((NtsTask){nested_join, 0, promise});
  nts_checkpoint();
  expect("checkpoint callback cannot join",
         nested_result == NTS_JOIN_REENTRANT);
  nts_post_task((NtsTask){nested_join, 0, promise});
  nts_post_delayed(settlement(promise), 10, false);
  timer_runs = 0;
  NtsTimerId repeating =
      nts_post_delayed((NtsTask){count_timer, 0, 0}, 1, true);
  expect("target settles with repeating timer live",
         nts_promise_join(promise) == NTS_JOIN_FULFILLED);
  expect("nested task cannot join", nested_result == NTS_JOIN_REENTRANT);
  expect("other timer actually ran", timer_runs > 0);
  nts_cancel_delayed(repeating);
  release(promise);

  promise = nts_promise_new();
  NtsString *reason = nts_string_from_utf8("failed", 6);
  nts_promise_reject(promise, (NtsHeader *)reason);
  expect("rejection stays rejection",
         nts_promise_join(promise) == NTS_JOIN_REJECTED);
  expect("rejection reason survives wait",
         nts_value_reference(nts_promise_reason(promise)) ==
             (NtsHeader *)reason);
  nts_release((NtsHeader *)reason);
  release(promise);
  finish();
}

int main(void) {
  size_t before = nts_live_count();
  without_a_loop();
  with_a_loop();
#if defined(NTS_JOIN_UV)
  cross_thread();
#endif
  nts_collect_cycles();
  expect("wait and teardown leave no managed allocations",
         nts_live_count() == before);
  return failures != 0;
}
