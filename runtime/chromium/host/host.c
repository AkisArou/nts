#include "host.h"

#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>

#include "dom_bridge.h"

struct NtsChromiumHost {
  NtsEnvironment* environment;
  NtsDomContext* dom;
  pthread_t owner;
  size_t entries;
  /* A destroy that waits for the outermost entry to leave. */
  bool closing;
  void (*release)(void*);
  void* release_state;
  /* Idle-time cycle collection (nts_chromium_host_install). */
  bool idle_policy;
  bool idle_queued;
  bool idle_running;
};

_Noreturn void nts_chromium_host_fail(const char* function, int line) {
  if (nts_raising())
    nts_uncaught(nts_raise_take(), NULL);
  fprintf(stderr, "nts host: check failed in %s at line %d\n", function, line);
  abort();
}

NtsChromiumHost* nts_chromium_host_create(void) {
  NtsChromiumHost* host = calloc(1, sizeof(*host));
  if (!host)
    NTS_CHROMIUM_HOST_FAIL();
  host->environment = nts_environment_create();
  return host;
}

NtsChromiumHostScope nts_chromium_host_enter(NtsChromiumHost* host) {
  ++host->entries;
  NtsEnvironmentScope environment = nts_environment_enter(host->environment);
  /* This entry barrier prevents a legacy landing past the C++ caller. DOM
     errors return from Blink before the compiled program raises/catches. */
  nts_callback_enter();
  nts_enter();
  return (NtsChromiumHostScope){environment, host};
}

NtsEnvironmentScope nts_chromium_host_select(NtsChromiumHost* host) {
  return nts_environment_enter(host->environment);
}

static void finalize(NtsChromiumHost* host) {
  NtsChromiumHostScope scope = nts_chromium_host_enter(host);
  if (host->release)
    host->release(host->release_state);
  nts_collect_cycles();
  if (nts_live_count() != 0)
    NTS_CHROMIUM_HOST_FAIL();
  nts_leave();
  nts_callback_leave();
  nts_environment_leave(&scope.environment);
  nts_environment_destroy(host->environment);
  free(host);
}

static void idle_collect(void* state);
static void idle_drop(void* state);
void nts_chromium_host_leave(NtsChromiumHostScope* scope) {
  NtsChromiumHost* host = scope->host;
  nts_leave();
  nts_callback_leave();
  nts_environment_leave(&scope->environment);
  if (--host->entries)
    return;
  if (host->closing) {
    finalize(host);
    return;
  }
  /* One idle collection per busy period, never from the collection itself. */
  if (host->idle_policy && !host->idle_queued && !host->idle_running) {
    host->idle_queued = true;
    nts_blink_dom_post_idle(host->dom, idle_collect, idle_drop, host);
  }
}

void nts_chromium_host_destroy(NtsChromiumHost* host,
                               void (*release)(void*),
                               void* state) {
  if (!host)
    return;
  host->closing = true;
  host->release = release;
  host->release_state = state;
  /* A synchronous custom-element reaction can dispose the document while a
     compiled call is active; its outermost entry ends the environment. */
  if (host->entries == 0)
    finalize(host);
}

/* A callback's call into the program: the environment entered, as every
   native callback enters it. A throw cannot cross the C frames of an event
   dispatch; the closure bridge stops one, so none arrives here. */
static void invoke(void* state, void (*call)(void*), void* argument) {
  NtsChromiumHostScope scope = nts_chromium_host_enter(state);
  call(argument);
  if (nts_raising())
    NTS_CHROMIUM_HOST_FAIL();
  nts_chromium_host_leave(&scope);
}
void nts_chromium_host_attach(NtsChromiumHost* host, NtsDomContext* context) {
  host->dom = context;
  nts_blink_dom_set_invoker(context, invoke, host);
}

typedef struct QueuedTask {
  NtsChromiumHost* host;
  NtsTask task;
} QueuedTask;
static void run_task(void* state) {
  QueuedTask* queued = state;
  NtsChromiumHostScope scope = nts_chromium_host_enter(queued->host);
  nts_task_run(queued->task);
  if (nts_raising())
    NTS_CHROMIUM_HOST_FAIL();
  nts_chromium_host_leave(&scope);
  free(queued);
}
static void drop_task(void* state) {
  QueuedTask* queued = state;
  NtsChromiumHostScope scope = nts_chromium_host_enter(queued->host);
  if (queued->task.drop)
    queued->task.drop(queued->task.state);
  nts_chromium_host_leave(&scope);
  free(queued);
}
static void enqueue_microtask(void* state, NtsTask task) {
  NtsChromiumHost* host = state;
  QueuedTask* queued = malloc(sizeof(*queued));
  if (!queued)
    NTS_CHROMIUM_HOST_FAIL();
  *queued = (QueuedTask){host, task};
  nts_blink_dom_enqueue(host->dom, run_task, drop_task, queued);
}
static bool on_owner_thread(void* state) {
  return pthread_equal(((NtsChromiumHost*)state)->owner, pthread_self());
}
void nts_chromium_host_install(NtsChromiumHost* host, NtsDomContext* context) {
  NtsChromiumHostScope scope = nts_chromium_host_enter(host);
  host->dom = context;
  host->owner = pthread_self();
  const NtsHost runtime_host = {.enqueue_microtask = enqueue_microtask,
                                .is_owner_thread = on_owner_thread,
                                .state = host};
  nts_host_install(&runtime_host);
  host->idle_policy = true;
  nts_chromium_host_leave(&scope);
}

void nts_chromium_host_collect_idle(NtsChromiumHost* host) {
  host->idle_running = true;
  NtsChromiumHostScope scope = nts_chromium_host_enter(host);
  nts_collect_cycles();
  nts_chromium_host_leave(&scope);
  host->idle_running = false;
}
static void idle_collect(void* state) {
  NtsChromiumHost* host = state;
  host->idle_queued = false;
  nts_chromium_host_collect_idle(host);
}
static void idle_drop(void* state) {
  ((NtsChromiumHost*)state)->idle_queued = false;
}
