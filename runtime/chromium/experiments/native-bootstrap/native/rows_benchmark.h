#ifndef NTS_CHROMIUM_ROWS_BENCHMARK_H_
#define NTS_CHROMIUM_ROWS_BENCHMARK_H_
#include <string>

#include "base/functional/callback.h"
#include "nts/dom_bridge_bindings.h"
#include "nts/probe.h"

namespace nts_chromium {
// The js-framework-benchmark-shaped workload; see src/rows.ts. Runs as a
// chain of posted tasks and hands its JSON result to `done` from the last.
void StartRowsBenchmark(const blink::WebDocument& document,
                        NtsDomContext* context,
                        NtsChromiumProbe* probe,
                        base::OnceCallback<void(std::string)> done);
}
#endif
