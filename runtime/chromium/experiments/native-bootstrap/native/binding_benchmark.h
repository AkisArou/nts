#ifndef NTS_CHROMIUM_BINDING_BENCHMARK_H_
#define NTS_CHROMIUM_BINDING_BENCHMARK_H_
#include <string>
#include "nts/dom_bridge_bindings.h"
#include "nts/probe.h"

namespace nts_chromium {
std::string RunBindingBenchmark(const blink::WebDocument& document,
                                NtsDomContext* context,
                                NtsChromiumProbe* probe,
                                uint32_t order);
}
#endif
