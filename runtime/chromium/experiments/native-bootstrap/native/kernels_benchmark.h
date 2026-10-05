#ifndef NTS_CHROMIUM_KERNELS_BENCHMARK_H_
#define NTS_CHROMIUM_KERNELS_BENCHMARK_H_
#include <string>

#include "base/functional/callback.h"
#include "nts/dom_bridge_bindings.h"
#include "nts/probe.h"

namespace nts_chromium {
// native-typescript's create-element and detached-counter-tree kernels; see
// src/kernels.ts. Runs as a chain of posted tasks, one per sample, and hands
// its JSON result to `done` from the last.
void StartKernelsBenchmark(const blink::WebDocument& document,
                           NtsDomContext* context,
                           NtsChromiumProbe* probe,
                           base::OnceCallback<void(std::string)> done);
}  // namespace nts_chromium
#endif
