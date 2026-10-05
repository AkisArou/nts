#ifndef NTS_CHROMIUM_ROWS_BENCHMARK_H_
#define NTS_CHROMIUM_ROWS_BENCHMARK_H_
#include <string>
#include "nts/dom_bridge_bindings.h"
#include "nts/probe.h"

namespace nts_chromium {
// The js-framework-benchmark-shaped workload; see src/rows.ts.
std::string RunRowsBenchmark(const blink::WebDocument& document,
                             NtsDomContext* context,
                             NtsChromiumProbe* probe);
}
#endif
