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
NtsChromiumBenchmarkStats nts_chromium_benchmark_run(
    NtsChromiumBenchmark* benchmark,
    uint32_t iterations,
    bool prepared,
    bool scoped);
void nts_chromium_benchmark_destroy(NtsChromiumBenchmark* benchmark);
/* Prepared-input calls with a fresh native entry for each short callback. */
NtsChromiumBenchmarkStats nts_chromium_benchmark_entries(
    NtsChromiumBenchmark* benchmark,
    uint32_t operations_per_entry,
    uint32_t entries,
    bool scoped);

#ifdef __cplusplus
}
#endif
#endif
