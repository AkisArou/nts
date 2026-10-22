// What a C++ programmer writes to keep the pieces: `std::string` built from a
// `string_view::substr`, pushed into a `std::vector`. Owned copies, as the
// TypeScript's are; most pieces fit `std::string`'s inline buffer and allocate
// nothing, which is the small-string optimisation this column is entitled to.
//
// The same generator and line as `case.ts`; ASCII, so one `char` is one UTF-16
// code unit.
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>
#include "harness.h"

static std::uint32_t next(std::uint32_t x) { return x * 1664525u + 1013904223u; }

static std::string make_line(std::uint32_t x) {
    std::string out;
    while (out.size() < 2048) {
        if (!out.empty()) out += ' ';
        x = next(x);
        const std::uint32_t length = 1 + (x >> 24) % 12;
        for (std::uint32_t k = 0; k < length; k++) {
            x = next(x);
            out += static_cast<char>('a' + (x >> 24) % 26);
        }
    }
    return out;
}

static const std::string line = make_line(31);

static std::int32_t work(std::int32_t seed) {
    const std::uint32_t step = static_cast<std::uint32_t>(seed);
    const std::string_view text = line;
    std::vector<std::string> pieces;
    std::size_t start = 0;
    for (std::size_t i = 0; i < text.size(); i++) {
        if (text[i] == ' ') {
            pieces.emplace_back(text.substr(start, i - start));
            start = i + 1;
        }
    }
    pieces.emplace_back(text.substr(start));
    std::uint32_t total = 0;
    for (const std::string &piece : pieces) {
        total = total + static_cast<std::uint32_t>(piece.size()) * step +
                static_cast<unsigned char>(piece[0]);
    }
    return static_cast<std::int32_t>(total);
}

double bench_run(void) {
    volatile std::int32_t seed = 3;
    return static_cast<double>(work(seed));
}
