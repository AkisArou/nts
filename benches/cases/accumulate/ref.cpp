// What a C++ programmer writes. Unsigned for the wrapping: JavaScript's bitwise
// operators are defined modulo 2^32, and signed overflow is undefined in C++ --
// the wrapping is the semantics, not an accident.
#include <cstdint>
#include "harness.h"

static std::int32_t accumulate(std::int32_t seed) {
    std::uint32_t h = static_cast<std::uint32_t>(seed);
    std::int32_t total = 0;
    for (std::int32_t i = 0; i < 4096; i++) {
        h = h * 31u + static_cast<std::uint32_t>(i);
        total += static_cast<std::int32_t>(h & 255u);
    }
    return total;
}

double bench_run(void) {
    volatile std::int32_t seed = 12345;
    return static_cast<double>(accumulate(seed));
}
