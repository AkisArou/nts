// What a C++ programmer writes: index a `std::string_view` and compare the
// `char` with `'x'`. One load per read and no bounds check, the floor for this
// loop.
//
// The same generator and text as `case.ts`; ASCII, so one `char` is one UTF-16
// code unit.
#include <cstdint>
#include <string>
#include <string_view>
#include "harness.h"

static std::uint32_t next(std::uint32_t x) { return x * 1664525u + 1013904223u; }

static std::string letters(int count, std::uint32_t x) {
    std::string out;
    for (int i = 0; i < count; i++) {
        x = next(x);
        out += static_cast<char>('a' + (x >> 24) % 26);
    }
    return out;
}

static const std::string text = letters(4096, 17);

static std::int32_t work(std::int32_t seed) {
    const std::uint32_t step = static_cast<std::uint32_t>(seed);
    const std::string_view view = text;
    std::uint32_t total = 0;
    for (std::size_t i = 0; i < view.size(); i++) {
        total = total + static_cast<unsigned char>(view[i]) * step;
        if (view[i] == 'x') {
            total = total + static_cast<std::uint32_t>(i);
        }
    }
    return static_cast<std::int32_t>(total);
}

double bench_run(void) {
    volatile std::int32_t seed = 3;
    return static_cast<double>(work(seed));
}
