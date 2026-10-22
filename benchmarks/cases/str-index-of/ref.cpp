// What a C++ programmer writes: `std::string_view::find`, with `npos` read as
// -1, for both the 5-unit needle and the single character.
//
// The same generator, text and needle as `case.ts`; ASCII, so one `char` is one
// UTF-16 code unit and the positions agree.
#include <cstdint>
#include <string>
#include <string_view>
#include "harness.h"

static std::uint32_t next(std::uint32_t x) { return x * 1664525u + 1013904223u; }

static std::string make_needle(std::uint32_t x) {
    std::string out;
    for (int k = 0; k < 5; k++) {
        x = next(x);
        out += static_cast<char>('a' + (x >> 24) % 26);
    }
    return out;
}

static const std::string needle = make_needle(47);

static std::string make_text(std::uint32_t x) {
    std::string out;
    while (out.size() < 4096) {
        x = next(x);
        const std::uint32_t r = x >> 24;
        if (r < 2) out += needle;
        else if (r < 6) out += ',';
        else out += static_cast<char>('a' + r % 26);
    }
    return out;
}

static const std::string text = make_text(53);

static std::uint32_t position(std::size_t found) {
    return found == std::string_view::npos ? 0xffffffffu : static_cast<std::uint32_t>(found);
}

static std::int32_t work(std::int32_t seed) {
    const std::uint32_t s = static_cast<std::uint32_t>(seed) & 4095;
    const std::string_view view = text;
    std::uint32_t total = 0;
    for (std::uint32_t i = 0; i < 256; i++) {
        const std::size_t start = (i * 16 + s) & 4095;
        total = total + position(view.find(needle, start));
        total = total * 3 + position(view.find(',', start));
    }
    return static_cast<std::int32_t>(total);
}

double bench_run(void) {
    volatile std::int32_t seed = 3;
    return static_cast<double>(work(seed));
}
