// What a C++ programmer writes for the same thing: a file-scope function, plus
// a template for the one that takes it as a value.
//
// A namespace-scope `constexpr auto` lambda is the closest literal transcription,
// but it is *not* the fair bar -- it is a constant, and the module-scope `const`
// this measures is storage the program writes to. `step` is the mutable part in
// both, so the arithmetic depends on a global either way and neither side can
// fold the loop away.
#include <cstdint>
#include "harness.h"

static std::int32_t step = 0;

static std::int32_t mix(std::int32_t x) {
    const std::uint32_t ux = static_cast<std::uint32_t>(x);
    return static_cast<std::int32_t>((ux * 2654435761u ^ (ux >> 3)) +
                                     static_cast<std::uint32_t>(step));
}

// `& 0xfff` mirrors the TypeScript, and the reason is on that side: a
// float64 multiply loses precision above 2^53, so the two lanes only compute
// one function while `mix` is fed small arguments.
static std::int32_t twice(std::int32_t x) { return mix(mix(x) & 0xfff); }

template <typename F>
static std::int32_t drive(F f, std::int32_t times) {
    std::int32_t total = 0;
    for (std::int32_t i = 0; i < times; i++) {
        total = total ^ f(i);
    }
    return total;
}

static std::int32_t work(std::int32_t seed) {
    step = seed;

    std::int32_t total = 0;
    for (std::int32_t i = 0; i < 4096; i++) {
        total = total ^ mix(i);
    }
    for (std::int32_t i = 0; i < 4096; i++) {
        total = total ^ twice(i);
    }
    total = static_cast<std::int32_t>(static_cast<std::uint32_t>(total) +
                                      static_cast<std::uint32_t>(drive(mix, 4096)));
    return total;
}

double bench_run(void) {
    volatile std::int32_t seed = 5;
    return static_cast<double>(work(seed));
}
