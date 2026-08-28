// The same checksum a C++ programmer writes: bytes in a `uint8_t` buffer, the
// accumulators in `int32_t`.
//
// The shift is done in `uint32_t` and cast back. `b << 16` with `b` above 32767
// overflows a signed int, which is undefined behaviour in C++ and is *defined*
// in JavaScript -- `<<` is specified on ToInt32, which wraps. Doing it the
// UB way would be a faster program that computes something else.
#include <cstdint>
#include <array>
#include "harness.h"

static std::int32_t run(std::int32_t seed) {
    constexpr std::int32_t length = 4096;
    std::array<std::uint8_t, length> data{};

    std::int32_t state = seed;
    for (std::int32_t i = 0; i < length; i++) {
        state = (state * 1309 + 13849) & 65535;
        data[i] = static_cast<std::uint8_t>(state & 255);
    }

    std::int32_t total = 0;
    for (std::int32_t pass = 0; pass < 64; pass++) {
        std::int32_t a = 1;
        std::int32_t b = 0;
        for (std::int32_t i = 0; i < length; i++) {
            a = (a + data[i]) % 65521;
            b = (b + a) % 65521;
        }
        total = total + static_cast<std::int32_t>(
            (static_cast<std::uint32_t>(b) << 16) | static_cast<std::uint32_t>(a));
    }
    return total;
}

double bench_run(void) {
    volatile std::int32_t seed = 7;
    return static_cast<double>(run(seed));
}
