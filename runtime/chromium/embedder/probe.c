#include "probe.h"

#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>

#include "dom_abi.h"
#include "dom_bridge.h"
#include "host.h"
#include "program.h"

#define PROBE_FAIL() NTS_CHROMIUM_HOST_FAIL()

/* The test fixtures' client of the host (host/host.h): what the witnesses,
   counters and benchmarks hold of the program, beside its environment. */
struct NtsChromiumProbe {
  NtsChromiumHost* host;
  ntsChromiumCreateCounter_return_t* counter;
  NtsDomContext* dom;
  NtsPromise* pending;
  pthread_t owner;
  bool collector_queued;
};

typedef NtsChromiumHostScope ProbeScope;
static ProbeScope enter(NtsChromiumProbe* probe) {
  return nts_chromium_host_enter(probe->host);
}
static void leave(ProbeScope* scope) { nts_chromium_host_leave(scope); }

NtsChromiumProbe* nts_chromium_probe_create(void) {
  NtsChromiumProbe* probe = calloc(1, sizeof(*probe));
  if (!probe)
    PROBE_FAIL();
  probe->host = nts_chromium_host_create();
  return probe;
}

NtsChromiumProbeResult nts_chromium_probe_run(NtsChromiumProbe* probe) {
  NtsChromiumProbeResult result = {0};
  ProbeScope scope = enter(probe);
  result.live_objects_before = nts_live_count();
  result.scalar = ntsChromiumProbe(7.0);
  NtsString* input = nts_string_from_utf8("probe", 5);
  NtsString* text = ntsChromiumText(input);
  if (nts_raising())
    PROBE_FAIL();
  static const char expected[] = "native:probe";
  result.text_matches = text && text->length == sizeof(expected) - 1;
  if (result.text_matches) {
    for (size_t i = 0; i < sizeof(expected) - 1; ++i) {
      if (nts_str_char_code_at(text, (double)i) != (unsigned char)expected[i]) {
        result.text_matches = false;
      }
    }
  }
  nts_release((NtsHeader*)text);
  nts_release((NtsHeader*)input);
  result.live_objects_after = nts_live_count();
  leave(&scope);
  return result;
}

void nts_chromium_probe_counter_initialize(NtsChromiumProbe* probe) {
  if (probe->counter)
    PROBE_FAIL();
  ProbeScope scope = enter(probe);
  probe->counter = ntsChromiumCreateCounter();
  if (nts_raising() || !probe->counter)
    PROBE_FAIL();
  leave(&scope);
}

typedef struct DomInvocation {
  NtsDomContext* context;
  double count;
  double result;
} DomInvocation;
static void run_dom_program(void* state) {
  DomInvocation* call = state;
  call->result = ntsChromiumDomProgram();
}
static void run_dom_counter(void* state) {
  DomInvocation* call = state;
  ntsChromiumDomCounter(call->count);
}

double nts_chromium_probe_dom_run(NtsChromiumProbe* probe,
                                  NtsDomContext* context) {
  ProbeScope scope = enter(probe);
  const size_t before = nts_live_count();
  DomInvocation call = {.context = context, .result = -1};
  if (nts_blink_dom_entry(context, run_dom_program, &call) || nts_raising())
    PROBE_FAIL();
  /* Nothing the program made outlives the call, except a closure the DOM
     holds for later -- the frame callback the witness leaves pending, which
     gives its closure back when it runs. */
  const size_t uncollected = nts_live_count();
  /* Cycles wait for the collector (at idle, under the host); collect them
     now, so what is counted is what nothing will ever free. */
  nts_collect_cycles();
  const size_t after = nts_live_count();
  const size_t held = nts_blink_dom_held_closures(context);
  fprintf(stderr, "NTS_DOM_LIVE before=%zu uncollected=%zu after=%zu held=%zu\n",
          before, uncollected, after, held);
  if (after > before + held) {
    fprintf(stderr, "nts probe: %zu objects outlived the DOM program, %zu held\n",
            after - before, held);
    PROBE_FAIL();
  }
  leave(&scope);
  return call.result;
}

void nts_chromium_probe_dom_counter(NtsChromiumProbe* probe,
                                    NtsDomContext* context,
                                    double count) {
  ProbeScope scope = enter(probe);
  const size_t before = nts_live_count();
  DomInvocation call = {.context = context, .count = count};
  if (nts_blink_dom_entry(context, run_dom_counter, &call) || nts_raising() ||
      nts_live_count() != before)
    PROBE_FAIL();
  leave(&scope);
}

NtsChromiumCounterResult nts_chromium_probe_counter_increment(
    NtsChromiumProbe* probe) {
  if (!probe->counter)
    PROBE_FAIL();
  ProbeScope scope = enter(probe);
  NtsChromiumCounterResult result = {0};
  result.live_objects_before = nts_live_count();
  result.count = ntsChromiumIncrementCounter(probe->counter);
  if (nts_raising())
    PROBE_FAIL();
  result.live_objects_after = nts_live_count();
  leave(&scope);
  return result;
}

/* What the probe still holds goes back in the environment, before the host
   checks that nothing of the program remains. */
static void release_probe(void* state) {
  NtsChromiumProbe* probe = state;
  nts_release((NtsHeader*)probe->pending);
  nts_release((NtsHeader*)probe->counter);
  free(probe);
}
void nts_chromium_probe_destroy(NtsChromiumProbe* probe) {
  if (!probe)
    return;
  nts_chromium_host_destroy(probe->host, release_probe, probe);
}

/* The native task layout stays in C. Blink owns only these opaque envelopes. */
typedef struct QueuedTask {
  NtsChromiumProbe* probe;
  NtsTask task;
} QueuedTask;

static void run_native_task(void* state) {
  QueuedTask* queued = state;
  ProbeScope scope = enter(queued->probe);
  nts_task_run(queued->task);
  if (nts_raising())
    PROBE_FAIL();
  leave(&scope);
  free(queued);
}
static void drop_native_task(void* state) {
  QueuedTask* queued = state;
  ProbeScope scope = enter(queued->probe);
  if (queued->task.drop)
    queued->task.drop(queued->task.state);
  fprintf(stderr, "NTS_NATIVE_TASK drop live=%zu\n", nts_live_count());
  leave(&scope);
  free(queued);
}
static void end_checkpoint(void* state) {
  NtsChromiumProbe* probe = state;
  ProbeScope scope = enter(probe);
  probe->collector_queued = false;
  nts_collect_cycles();
  /* The counter's state, beside the closures Blink holds for the program
     (the witness's observers and listeners): nothing else survives. */
  const size_t held = nts_blink_dom_held_closures(probe->dom);
  if (probe->pending || nts_live_count() != 1 + held)
    PROBE_FAIL();
  fprintf(stderr, "NTS_CHECKPOINT live=%zu\n", nts_live_count() - held);
  leave(&scope);
}
static void drop_checkpoint(void* state) {
  NtsChromiumProbe* probe = state;
  probe->collector_queued = false;
}
static void enqueue_native(void* state, NtsTask task) {
  NtsChromiumProbe* probe = state;
  QueuedTask* queued = malloc(sizeof(*queued));
  if (!queued)
    PROBE_FAIL();
  *queued = (QueuedTask){probe, task};
  nts_blink_dom_enqueue(probe->dom, run_native_task, drop_native_task, queued);
  if (!probe->collector_queued) {
    probe->collector_queued = true;
    nts_blink_dom_end_checkpoint(probe->dom, end_checkpoint, drop_checkpoint,
                                 probe);
  }
}
static bool on_owner_thread(void* state) {
  return pthread_equal(((NtsChromiumProbe*)state)->owner, pthread_self());
}
void nts_chromium_probe_install_microtasks(NtsChromiumProbe* probe,
                                           NtsDomContext* context) {
  ProbeScope scope = enter(probe);
  probe->dom = context;
  probe->owner = pthread_self();
  /* Fulfilled-promise experiment only. Timers, task posting and synchronous
     pumping are outside this profile and deliberately have no callbacks. */
  const NtsHost host = {.enqueue_microtask = enqueue_native,
                        .is_owner_thread = on_owner_thread,
                        .state = probe};
  nts_host_install(&host);
  leave(&scope);
}
typedef struct Completion {
  NtsHeader header;
  NtsChromiumProbe* probe; /* C owner lives until its document drops this. */
} Completion;
static const NtsDescriptor completion_descriptor = {NTS_KIND_OBJECT,
                                                    sizeof(Completion),
                                                    0u,
                                                    0u,
                                                    NULL,
                                                    NULL,
                                                    "Chromium completion",
                                                    0u,
                                                    NULL,
                                                    NTS_ARRAY_UNKNOWN,
                                                    0u,
                                                    NULL};
static void finish_counter(void* state) {
  Completion* completion = state;
  NtsChromiumProbe* probe = completion->probe;
  if (nts_promise_state(probe->pending) != NTS_PROMISE_FULFILLED)
    PROBE_FAIL();
  double expected = nts_value_number(nts_promise_value(probe->pending));
  double count = ntsChromiumIncrementCounter(probe->counter);
  if (count != expected)
    PROBE_FAIL();
  DomInvocation call = {.context = probe->dom, .count = count};
  if (nts_blink_dom_entry(probe->dom, run_dom_counter, &call))
    PROBE_FAIL();
  nts_release((NtsHeader*)probe->pending);
  probe->pending = NULL;
  nts_release((NtsHeader*)completion);
  fprintf(stderr, "NTS_ASYNC count=%.0f live=%zu\n", count,
          nts_live_count() - nts_blink_dom_held_closures(probe->dom));
}
static void drop_finish(void* state) {
  nts_release((NtsHeader*)state);
}
void nts_chromium_probe_await_counter(NtsChromiumProbe* probe) {
  if (probe->pending || !probe->counter || !probe->dom)
    PROBE_FAIL();
  ProbeScope scope = enter(probe);
  probe->pending =
      ntsChromiumAwaitCounter(ntsChromiumCounterValue(probe->counter));
  if (nts_raising() || !probe->pending)
    PROBE_FAIL();
  Completion* completion = (Completion*)nts_object_new(&completion_descriptor);
  completion->probe = probe;
  nts_promise_subscribe(probe->pending,
                        (NtsTask){finish_counter, drop_finish, completion});
  if (nts_promise_state(probe->pending) != NTS_PROMISE_PENDING)
    PROBE_FAIL();
  leave(&scope);
}

/* The compiler's await tasks currently lack drop callbacks. Teardown here
   separately tests a managed host task, without guessing ownership for null
   drop. Suspended-await cancellation remains a compiler/runtime blocker. */
typedef struct CancellationTask {
  NtsHeader header;
  ntsChromiumCreateCounter_return_t* counter;
} CancellationTask;
static const uint32_t cancellation_offsets[] = {
    offsetof(CancellationTask, counter)};
static const NtsDescriptor cancellation_descriptor = {NTS_KIND_OBJECT,
                                                      sizeof(CancellationTask),
                                                      1u,
                                                      0u,
                                                      cancellation_offsets,
                                                      NULL,
                                                      "Chromium cancellation",
                                                      0u,
                                                      NULL,
                                                      NTS_ARRAY_UNKNOWN,
                                                      0u,
                                                      NULL};
static void canceled_run(void* state) {
  CancellationTask* task = state;
  ntsChromiumIncrementCounter(task->counter);
  fprintf(stderr, "NTS_TEARDOWN_TASK unexpectedly ran\n");
  nts_release((NtsHeader*)task);
  abort();
}
static void canceled_drop(void* state) {
  nts_release((NtsHeader*)state);
}
void nts_chromium_probe_teardown_witness(NtsChromiumProbe* probe) {
  ProbeScope scope = enter(probe);
  if (probe->pending) {
    fprintf(stderr, "NTS_TEARDOWN pending await: cancellation unsupported\n");
  } else {
    CancellationTask* task =
        (CancellationTask*)nts_object_new(&cancellation_descriptor);
    task->counter = probe->counter;
    nts_retain((NtsHeader*)task->counter);
    nts_enqueue_microtask((NtsTask){canceled_run, canceled_drop, task});
  }
  leave(&scope);
}

struct NtsChromiumBenchmark {
  NtsChromiumProbe* probe;
  NtsDomContext* context;
  NtsDomNode* node;
  ntsChromiumPrepareBenchmark_return_t* state;
  NtsString* first;
  NtsString* second;
  size_t live_before_setup;
  uint32_t iterations;
  uint32_t mode;
  double result;
};
static void prepare_benchmark(void* state) {
  NtsChromiumBenchmark* benchmark = state;
  benchmark->state =
      ntsChromiumPrepareBenchmark(benchmark->first, benchmark->second);
}
NtsChromiumBenchmark* nts_chromium_benchmark_create(NtsChromiumProbe* probe,
                                                    NtsDomContext* context,
                                                    NtsDomNode* node,
                                                    const char* a,
                                                    const char* b,
                                                    size_t bytes) {
  NtsChromiumBenchmark* benchmark = calloc(1, sizeof(*benchmark));
  if (!benchmark)
    PROBE_FAIL();
  ProbeScope scope = enter(probe);
  benchmark->live_before_setup = nts_live_count();
  benchmark->first = nts_string_from_utf8(a, bytes);
  benchmark->second = nts_string_from_utf8(b, bytes);
  /* Interning the two texts is a DOM call, so preparing is an entry. */
  if (nts_blink_dom_entry(context, prepare_benchmark, benchmark) ||
      nts_raising() || !benchmark->state)
    PROBE_FAIL();
  benchmark->probe = probe;
  benchmark->context = context;
  benchmark->node = node;
  leave(&scope);
  return benchmark;
}
static void run_benchmark(void* state) {
  NtsChromiumBenchmark* benchmark = state;
  benchmark->result = ntsChromiumBenchmarkLoop(
      benchmark->node, benchmark->state, benchmark->first,
      benchmark->second, (double)benchmark->iterations,
      (double)benchmark->mode);
}
static void run_entered(NtsChromiumBenchmark* benchmark) {
  if (nts_blink_dom_entry(benchmark->context, run_benchmark, benchmark))
    PROBE_FAIL();
}
NtsChromiumBenchmarkStats nts_chromium_benchmark_run(
    NtsChromiumBenchmark* benchmark,
    uint32_t iterations,
    uint32_t mode) {
  ProbeScope scope = enter(benchmark->probe);
  const size_t before = nts_live_count();
  benchmark->iterations = iterations;
  benchmark->mode = mode;
  benchmark->result = -1;
  nts_counting_reset();
  run_entered(benchmark);
  if (nts_raising() || benchmark->result != 0 || nts_live_count() != before)
    PROBE_FAIL();
  NtsChromiumBenchmarkStats stats = {nts_counted_allocations(),
                                     nts_counted_retains(),
                                     nts_counted_releases(), nts_live_count()};
  leave(&scope);
  return stats;
}
NtsChromiumBenchmarkStats nts_chromium_benchmark_entries(
    NtsChromiumBenchmark* benchmark,
    uint32_t operations_per_entry,
    uint32_t entries,
    uint32_t mode) {
  /* Selecting the environment for counters does not open a managed callback.
     Every measured callback below enters/leaves normally, including its empty
     runtime checkpoint; instrumentation is outside those repeated entries. */
  NtsEnvironmentScope environment =
      nts_chromium_host_select(benchmark->probe->host);
  const size_t before = nts_live_count();
  benchmark->iterations = operations_per_entry;
  benchmark->mode = mode;
  nts_counting_reset();
  for (uint32_t i = 0; i < entries; ++i) {
    ProbeScope scope = enter(benchmark->probe);
    benchmark->result = -1;
    run_entered(benchmark);
    if (nts_raising() || benchmark->result != 0)
      PROBE_FAIL();
    leave(&scope);
  }
  if (nts_live_count() != before)
    PROBE_FAIL();
  NtsChromiumBenchmarkStats stats = {nts_counted_allocations(),
                                     nts_counted_retains(),
                                     nts_counted_releases(), nts_live_count()};
  nts_environment_leave(&environment);
  return stats;
}
void nts_chromium_benchmark_destroy(NtsChromiumBenchmark* benchmark) {
  ProbeScope scope = enter(benchmark->probe);
  nts_release((NtsHeader*)benchmark->state);
  nts_release((NtsHeader*)benchmark->first);
  nts_release((NtsHeader*)benchmark->second);
  nts_collect_cycles();
  if (nts_live_count() != benchmark->live_before_setup)
    PROBE_FAIL();
  leave(&scope);
  free(benchmark);
}

struct NtsChromiumRows {
  NtsChromiumProbe* probe;
  NtsDomContext* context;
  ntsRowsCreate_return_t* app;
  size_t live_before_setup;
  uint32_t operation;
  uint32_t count;
  double result;
};
typedef struct RowsSetup {
  NtsChromiumRows* rows;
  NtsDomNode* tbody;
} RowsSetup;
static void create_rows(void* state) {
  RowsSetup* setup = state;
  setup->rows->app = ntsRowsCreate((struct NtsDomElement*)setup->tbody);
}
NtsChromiumRows* nts_chromium_rows_create(NtsChromiumProbe* probe,
                                          NtsDomContext* context,
                                          NtsDomNode* tbody) {
  NtsChromiumRows* rows = calloc(1, sizeof(*rows));
  if (!rows)
    PROBE_FAIL();
  rows->probe = probe;
  rows->context = context;
  ProbeScope scope = enter(probe);
  rows->live_before_setup = nts_live_count();
  /* Building the row template creates DOM nodes, so it is a native callback
     like any other: outside an entry every DOM call refuses. */
  RowsSetup setup = {rows, tbody};
  if (nts_blink_dom_entry(context, create_rows, &setup) || nts_raising() ||
      !rows->app)
    PROBE_FAIL();
  leave(&scope);
  return rows;
}
static void run_rows(void* state) {
  NtsChromiumRows* rows = state;
  rows->result =
      ntsRowsOperate(rows->app, (double)rows->operation, (double)rows->count);
}
NtsChromiumRowsResult nts_chromium_rows_operate(NtsChromiumRows* rows,
                                                uint32_t operation,
                                                uint32_t count) {
  ProbeScope scope = enter(rows->probe);
  nts_counting_reset();
  rows->operation = operation;
  rows->count = count;
  rows->result = -1;
  if (nts_blink_dom_entry(rows->context, run_rows, rows) || nts_raising() ||
      rows->result < 0)
    PROBE_FAIL();
  NtsChromiumRowsResult result = {rows->result, nts_counted_allocations(),
                                  nts_live_count()};
  leave(&scope);
  return result;
}
static void destroy_rows(void* state) {
  ntsRowsDestroy(((NtsChromiumRows*)state)->app);
}
void nts_chromium_rows_destroy(NtsChromiumRows* rows) {
  ProbeScope scope = enter(rows->probe);
  /* A disposed document refuses the entry; the app still drops its state,
     which makes no DOM call -- only releases, which need none. */
  if (nts_blink_dom_entry(rows->context, destroy_rows, rows))
    destroy_rows(rows);
  nts_release((NtsHeader*)rows->app);
  nts_collect_cycles();
  if (nts_raising() || nts_live_count() != rows->live_before_setup)
    PROBE_FAIL();
  leave(&scope);
  free(rows);
}

struct NtsChromiumTodo {
  NtsChromiumProbe* probe;
  NtsDomContext* context;
  ntsTodoCreate_return_t* app;
  NtsDomNode* root;
};
static void create_todo(void* state) {
  NtsChromiumTodo* todo = state;
  todo->app = ntsTodoCreate((struct NtsDomElement*)todo->root);
}
NtsChromiumTodo* nts_chromium_todo_create(NtsChromiumProbe* probe,
                                          NtsDomContext* context,
                                          NtsDomNode* root) {
  NtsChromiumTodo* todo = calloc(1, sizeof(*todo));
  if (!todo)
    PROBE_FAIL();
  todo->probe = probe;
  todo->context = context;
  todo->root = root;
  ProbeScope scope = enter(probe);
  if (nts_blink_dom_entry(context, create_todo, todo) || nts_raising() ||
      !todo->app)
    PROBE_FAIL();
  leave(&scope);
  return todo;
}
static void destroy_todo(void* state) {
  ntsTodoDestroy(((NtsChromiumTodo*)state)->app);
}
void nts_chromium_todo_destroy(NtsChromiumTodo* todo) {
  ProbeScope scope = enter(todo->probe);
  /* Removing a listener is a DOM call, so it needs the entry; a closed
     document refuses it, and its close gave every closure back already.
     Either way the app's own release below drops the listener handles. */
  nts_blink_dom_entry(todo->context, destroy_todo, todo);
  nts_release((NtsHeader*)todo->app);
  nts_collect_cycles();
  if (nts_raising())
    PROBE_FAIL();
  leave(&scope);
  free(todo);
}

typedef struct KernelRun {
  NtsDomContext* context;
  uint32_t kernel;
  double iterations;
  double result;
} KernelRun;
static void run_kernel(void* state) {
  KernelRun* run = state;
  run->result =
      run->kernel == 0   ? ntsKernelCreateElements(run->iterations)
      : run->kernel == 1 ? ntsKernelCounterTrees(run->iterations)
      : run->kernel == 2 ? ntsKernelEventRoundTrips(run->iterations)
                         : ntsKernelCanvasRects(run->iterations);
}
double nts_chromium_kernel_run(NtsChromiumProbe* probe,
                               NtsDomContext* context,
                               uint32_t kernel,
                               uint32_t iterations,
                               size_t* allocations) {
  ProbeScope scope = enter(probe);
  nts_counting_reset();
  KernelRun run = {context, kernel, iterations, -1};
  if (nts_blink_dom_entry(context, run_kernel, &run) || nts_raising() ||
      run.result < 0)
    PROBE_FAIL();
  *allocations = nts_counted_allocations();
  leave(&scope);
  return run.result;
}

void nts_chromium_probe_attach(NtsChromiumProbe* probe,
                               NtsDomContext* context) {
  probe->dom = context;
  nts_chromium_host_attach(probe->host, context);
}
void nts_chromium_probe_install_host(NtsChromiumProbe* probe,
                                     NtsDomContext* context) {
  probe->dom = context;
  nts_chromium_host_install(probe->host, context);
}
void nts_chromium_probe_collect_idle(NtsChromiumProbe* probe) {
  nts_chromium_host_collect_idle(probe->host);
}
