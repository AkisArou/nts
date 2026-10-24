// UTF-16 keys, matched to TypeScript code units (including the astral pair).
#include <cstdint>
#include <string>
#include <unordered_map>
#include "harness.h"

namespace {
const std::u16string keys[] = {
    u"event:connection:opened:success",
    u"event:connection:closed:normal",
    u"世界:event:message:received",
    u"😀:event:message:delivered",
};
const std::u16string absent = u"event:connection:never:registered";
}

static std::int32_t work(std::int32_t seed) {
    std::unordered_map<std::u16string, double> events;
    for (std::int32_t i = 0; i < 4; i++) events[keys[i]] = i + 1;
    std::int32_t total = 0;
    for (std::int32_t i = 0; i < 8192; i++) {
        const auto hit = events.find(keys[(i ^ seed) & 3]);
        total += hit == events.end() ? 0 : static_cast<std::int32_t>(hit->second);
        const auto miss = events.find(absent);
        total += miss == events.end() ? 0 : static_cast<std::int32_t>(miss->second);
    }
    return total;
}

double bench_run(void) {
    volatile std::int32_t seed = 5;
    return work(seed);
}
