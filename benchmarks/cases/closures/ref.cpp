// What a C++ programmer writes: a lambda, and a template for the function that
// takes one. The template is the hard bar on purpose -- it monomorphizes, so
// the call across the boundary is a direct call clang inlines, which is the
// best any language can do with this shape.
#include <cstdint>
#include "harness.h"

template <typename F>
static std::int32_t drive(F f, std::int32_t times) {
    std::int32_t total = 0;
    for (std::int32_t i = 0; i < times; i++) {
        total = total ^ f(i);
    }
    return total;
}

static std::int32_t work(std::int32_t seed) {
    const std::int32_t step = seed;
    const auto mix = [step](std::int32_t x) {
        const std::uint32_t ux = static_cast<std::uint32_t>(x);
        return static_cast<std::int32_t>(
            (ux * 2654435761u ^ (ux >> 3)) + static_cast<std::uint32_t>(step));
    };

    std::int32_t total = 0;
    for (std::int32_t i = 0; i < 4096; i++) {
        total = total ^ mix(i);
    }
    total = static_cast<std::int32_t>(static_cast<std::uint32_t>(total) +
                                      static_cast<std::uint32_t>(drive(mix, 4096)));
    return total;
}

double bench_run(void) {
    volatile std::int32_t seed = 5;
    return static_cast<double>(work(seed));
}
