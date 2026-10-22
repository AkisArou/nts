// What a C++ programmer writes: `std::from_chars` into a `double`, which is
// locale-free, allocation-free and correctly rounded, over a `string_view`.
//
// Every input here is in both grammars: no leading `+`, no whitespace, no
// `Infinity` and no hex, which `Number` accepts and `from_chars` does not. So
// the two parse the same values and the sum, in the same order, has the same
// bits.
//
// The same generator and texts as `case.ts`.
#include <charconv>
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>
#include "harness.h"

static std::uint32_t next(std::uint32_t x) { return x * 1664525u + 1013904223u; }

static std::vector<std::string> numbers(int count, std::uint32_t x) {
    std::vector<std::string> out;
    for (int i = 0; i < count; i++) {
        x = next(x);
        std::string text = ((x >> 24) & 3) == 0 ? "-" : "";
        const bool decimal = (i & 1) == 1;
        x = next(x);
        const std::uint32_t whole = decimal ? 1 + (x >> 24) % 4 : 1 + (x >> 24) % 7;
        for (std::uint32_t k = 0; k < whole; k++) {
            x = next(x);
            const std::uint32_t digit = k == 0 ? 1 + (x >> 24) % 9 : (x >> 24) % 10;
            text += static_cast<char>('0' + digit);
        }
        if (decimal) {
            text += '.';
            x = next(x);
            const std::uint32_t fraction = 1 + (x >> 24) % 6;
            for (std::uint32_t k = 0; k < fraction; k++) {
                x = next(x);
                text += static_cast<char>('0' + (x >> 24) % 10);
            }
            x = next(x);
            text += ((x >> 24) & 1) == 0 ? 'e' : 'E';
            x = next(x);
            text += ((x >> 24) & 1) == 0 ? '-' : '+';
            x = next(x);
            text += std::to_string((x >> 24) % 21);
        }
        out.push_back(std::move(text));
    }
    return out;
}

static const std::vector<std::string> texts = numbers(256, 67);

static double work(std::int32_t seed) {
    const std::uint32_t s = static_cast<std::uint32_t>(seed) & 255;
    double total = 0;
    for (std::uint32_t i = 0; i < 256; i++) {
        const std::string_view text = texts[(i + s) & 255];
        double value = 0;
        std::from_chars(text.data(), text.data() + text.size(), value);
        total += value;
    }
    return total;
}

double bench_run(void) {
    volatile std::int32_t seed = 3;
    return work(seed);
}
