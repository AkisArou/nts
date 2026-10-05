#ifndef NTS_CHROMIUM_EXPERIMENT_PROBE_H_
#define NTS_CHROMIUM_EXPERIMENT_PROBE_H_

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Only this header crosses into C++; runtime/generated headers stay in C. */
typedef struct NtsChromiumProbe NtsChromiumProbe;
typedef struct NtsDomContext NtsDomContext;
typedef struct NtsChromiumBenchmark NtsChromiumBenchmark;
typedef struct NtsChromiumBenchmarkStats {
  size_t allocations;
  size_t retains;
  size_t releases;
  size_t live_objects;
} NtsChromiumBenchmarkStats;
typedef struct NtsChromiumProbeResult {
  double scalar;
  bool text_matches;
  size_t live_objects_before;
  size_t live_objects_after;
} NtsChromiumProbeResult;

typedef struct NtsChromiumCounterResult {
  double count;
  size_t live_objects_before;
  size_t live_objects_after;
} NtsChromiumCounterResult;

NtsChromiumProbe* nts_chromium_probe_create(void);
NtsChromiumProbeResult nts_chromium_probe_run(NtsChromiumProbe* probe);
void nts_chromium_probe_counter_initialize(NtsChromiumProbe* probe);
NtsChromiumCounterResult nts_chromium_probe_counter_increment(
    NtsChromiumProbe* probe);
void nts_chromium_probe_destroy(NtsChromiumProbe* probe);
void nts_chromium_probe_install_microtasks(NtsChromiumProbe* probe,
                                           NtsDomContext* context);
/* Blink-owned checkpoints and idle-time cycle collection; see probe.c. */
void nts_chromium_probe_install_host(NtsChromiumProbe* probe,
                                     NtsDomContext* context);
/* The idle collection, callable directly where idle time cannot occur. */
void nts_chromium_probe_collect_idle(NtsChromiumProbe* probe);
void nts_chromium_probe_await_counter(NtsChromiumProbe* probe);
void nts_chromium_probe_teardown_witness(NtsChromiumProbe* probe);
double nts_chromium_probe_dom_run(NtsChromiumProbe* probe,
                                  NtsDomContext* context);
void nts_chromium_probe_dom_counter(NtsChromiumProbe* probe,
                                    NtsDomContext* context,
                                    double count);
NtsChromiumBenchmark* nts_chromium_benchmark_create(NtsChromiumProbe* probe,
                                                    NtsDomContext* context,
                                                    uint32_t node,
                                                    const char* a,
                                                    const char* b,
                                                    size_t bytes);
/* How a measured callback reaches Blink: no DOM entry (the original bridge
   sets up each operation), the original lexical scope, or a native entry. */
typedef enum NtsChromiumEntry {
  kNtsChromiumNoEntry,
  kNtsChromiumLegacyScope,
  kNtsChromiumEntered,
} NtsChromiumEntry;
/* `mode` selects the compiled loop; see ntsChromiumBenchmarkLoop. */
NtsChromiumBenchmarkStats nts_chromium_benchmark_run(
    NtsChromiumBenchmark* benchmark,
    uint32_t iterations,
    uint32_t mode,
    NtsChromiumEntry entry);
void nts_chromium_benchmark_destroy(NtsChromiumBenchmark* benchmark);
/* Prepared-input calls with a fresh native entry for each short callback. */
NtsChromiumBenchmarkStats nts_chromium_benchmark_entries(
    NtsChromiumBenchmark* benchmark,
    uint32_t operations_per_entry,
    uint32_t entries,
    uint32_t mode,
    NtsChromiumEntry entry);

/* The rows workload (src/rows.ts). Each operation is one native callback:
   an NTS environment entry and a DOM entry, as an event handler would be.
   Returns the row count after the operation; aborts on a raised error. */
typedef struct NtsChromiumRows NtsChromiumRows;
typedef struct NtsChromiumRowsResult {
  double rows;
  size_t allocations;
  size_t live_objects;
} NtsChromiumRowsResult;
NtsChromiumRows* nts_chromium_rows_create(NtsChromiumProbe* probe,
                                          NtsDomContext* context,
                                          uint32_t tbody);
NtsChromiumRowsResult nts_chromium_rows_operate(NtsChromiumRows* rows,
                                                uint32_t operation,
                                                uint32_t count);
void nts_chromium_rows_destroy(NtsChromiumRows* rows);

#ifdef __cplusplus
}
#endif
#endif
