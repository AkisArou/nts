/* Runs the rows workload (native-bootstrap/src/rows.ts) over mini_dom with
 * the case table of rows_benchmark.cc, and prints JSON: per-sample times,
 * NTS allocation counts, the final serialized rows and the live leases. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <sys/resource.h>

#include "mini_dom.h"
#include "program.h"

enum { kReplace, kAppend, kUpdate, kSelect, kSwap, kRemove, kClear, kNone };
typedef struct Case {
  const char* name;
  uint32_t setup, setup_count;
  int once;
  uint32_t operation, count, batch, warm, measured;
} Case;
/* rows_benchmark.cc's table; +layout cases run with no layout here. */
static const Case kCases[] = {
    {"create1k", kClear, 0, 0, kReplace, 1000, 1, 3, 15},
    {"replace1k", kReplace, 1000, 0, kReplace, 1000, 1, 3, 15},
    {"update10th", kReplace, 1000, 0, kUpdate, 0, 10, 3, 15},
    {"select", kReplace, 1000, 1, kSelect, 0, 1000, 3, 15},
    {"swap", kReplace, 1000, 1, kSwap, 0, 1000, 3, 15},
    {"remove", kReplace, 1000, 0, kRemove, 4, 200, 3, 15},
    {"append1k", kReplace, 1000, 0, kAppend, 1000, 1, 3, 15},
    {"clear1k", kReplace, 1000, 0, kClear, 0, 1, 3, 15},
    {"create10k", kClear, 0, 0, kReplace, 10000, 1, 1, 6},
    {"clear10k", kReplace, 10000, 0, kClear, 0, 1, 1, 6},
    {"create1k+layout", kClear, 0, 0, kReplace, 1000, 1, 3, 15},
    {"update10th+layout", kReplace, 1000, 0, kUpdate, 0, 10, 3, 15},
    {"select+layout", kReplace, 1000, 1, kSelect, 0, 100, 3, 15},
    {"swap+layout", kReplace, 1000, 1, kSwap, 0, 100, 3, 15},
};

static NtsDomContext* dom;
static ntsRowsCreate_return_t* app;
/* Live NTS objects before the app existed; destroying it must return here. */
static size_t live_before_app;
static uint32_t tbody;

/* The collection policy under test. "checkpoint" is the runtime default: every
   outermost nts_leave drains and runs nts_collect_cycles if any candidate
   exists. "idle" installs a host that owns checkpoints, as Blink does, and
   collects between batches -- where a renderer would use idle time -- with
   that cost measured and reported, not hidden. The rows app queues no
   microtasks; a host enqueue would be a defect here. */
static void no_microtasks(void* state, NtsTask task) {
  (void)state;
  (void)task;
  fputs("rows: unexpected microtask\n", stderr);
  abort();
}
static bool owner_thread(void* state) {
  (void)state;
  return true;
}

/* One native callback: an NTS environment entry and a DOM entry. */
static double operate(NtsEnvironment* environment, uint32_t operation,
                      uint32_t count) {
  NtsEnvironmentScope scope = nts_environment_enter(environment);
  nts_callback_enter();
  nts_enter();
  mini_dom_enter(dom);
  const double rows = ntsRowsOperate(app, operation, count);
  mini_dom_leave(dom);
  if (nts_raising() || rows < 0)
    abort();
  nts_leave();
  nts_callback_leave();
  nts_environment_leave(&scope);
  return rows;
}
static double now_ns(void) {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return t.tv_sec * 1e9 + t.tv_nsec;
}

int main(int argc, char** argv) {
  const bool idle = argc > 1 && !strcmp(argv[1], "idle");
  NtsEnvironment* environment = nts_environment_create();
  dom = mini_dom_create();
  {
    NtsEnvironmentScope scope = nts_environment_enter(environment);
    if (idle) {
      const NtsHost host = {.enqueue_microtask = no_microtasks,
                            .is_owner_thread = owner_thread};
      nts_host_install(&host);
    }
    nts_callback_enter();
    nts_enter();
    mini_dom_enter(dom);
    const uint32_t document = nts_dom_document(dom);
    tbody = nts_dom_query_atom(dom, document, mini_dom_intern(dom, "#tbody"));
    nts_dom_release(dom, document);
    live_before_app = nts_live_count();
    app = ntsRowsCreate(dom, tbody);
    mini_dom_leave(dom);
    if (nts_raising() || !app)
      abort();
    nts_leave();
    nts_callback_leave();
    nts_environment_leave(&scope);
  }
  printf("{\"samples\":[");
  uint32_t selection = 0;
  int first = 1;
  for (size_t k = 0; k < sizeof(kCases) / sizeof(*kCases); ++k) {
    const Case* c = &kCases[k];
    for (uint32_t round = 0; round < c->warm + c->measured; ++round) {
      if (c->setup != kNone && (!c->once || round == 0))
        operate(environment, c->setup, c->setup_count);
      NtsEnvironmentScope scope = nts_environment_enter(environment);
      nts_counting_reset();
      nts_environment_leave(&scope);
      const double start = now_ns();
      for (uint32_t i = 0; i < c->batch; ++i)
        operate(environment, c->operation,
                c->operation == kSelect ? selection++ % 1000 : c->count);
      const double elapsed = now_ns() - start;
      scope = nts_environment_enter(environment);
      const size_t allocations = nts_counted_allocations();
      double collect = 0;
      if (idle) {
        const double before = now_ns();
        nts_collect_cycles();
        collect = now_ns() - before;
      }
      nts_environment_leave(&scope);
      if (round < c->warm)
        continue;
      printf("%s{\"case\":\"%s\",\"round\":%u,\"batch\":%u,"
             "\"nsPerOperation\":%.1f,\"ntsAllocations\":%zu,"
             "\"idleCollectNs\":%.1f}",
             first ? "" : ",", c->name, round - c->warm, c->batch,
             elapsed / c->batch, allocations, collect);
      first = 0;
    }
  }
  operate(environment, kReplace, 1000);
  operate(environment, kUpdate, 0);
  operate(environment, kSelect, 5);
  operate(environment, kSwap, 0);
  const double final_rows = operate(environment, kRemove, 4);
  char* rows = mini_dom_serialize_rows(dom);
  const uint32_t leases = mini_dom_live_leases(dom);
  /* The renderer harness destroys the app and checks this; so does this. */
  size_t live_after_destroy;
  uint32_t leases_after_destroy;
  {
    NtsEnvironmentScope scope = nts_environment_enter(environment);
    nts_callback_enter();
    nts_enter();
    mini_dom_enter(dom);
    ntsRowsDestroy(app);
    /* The app borrowed the table's handle; the lease is the query's. */
    nts_dom_release(dom, tbody);
    mini_dom_leave(dom);
    nts_release((NtsHeader*)app);
    nts_leave();
    nts_callback_leave();
    nts_collect_cycles();
    live_after_destroy = nts_live_count();
    leases_after_destroy = mini_dom_live_leases(dom);
    nts_environment_leave(&scope);
  }
  struct rusage usage;
  getrusage(RUSAGE_SELF, &usage);
  printf("],\"finalRows\":%.0f,\"liveLeases\":%u,\"leasesAfterDestroy\":%u,\"maxRssKb\":%ld,\"liveBeforeApp\":%zu,\"liveAfterDestroy\":%zu,\"dom\":\"",
         final_rows, leases, leases_after_destroy, usage.ru_maxrss,
         live_before_app, live_after_destroy);
  for (const char* p = rows; *p; ++p) {
    if (*p == '\n')
      fputs("\\n", stdout);
    else if (*p == '"' || *p == '\\')
      printf("\\%c", *p);
    else
      putchar(*p);
  }
  printf("\"}\n");
  free(rows);
  return 0;
}
