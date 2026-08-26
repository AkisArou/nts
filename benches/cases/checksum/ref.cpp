// What a C++ programmer writes. Unsigned throughout, for the same reason as
// `accumulate`: modulo 2^32 is what the operators mean.
#include <cstdint>
#include "harness.h"

static std::int32_t checksum(std::int32_t seed) {
    std::uint32_t h = static_cast<std::uint32_t>(seed);
    for (std::int32_t i = 0; i < 4096; i++) {
        h = h * 31u + static_cast<std::uint32_t>(i);
        h ^= h >> 7;
        h = (h << 5) - h;
    }
    return static_cast<std::int32_t>(h);
}

double bench_run(void) {
    volatile std::int32_t seed = 12345;
    return static_cast<double>(checksum(seed));
}
