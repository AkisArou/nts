// What a C++ programmer writes: the same `operator+=` loop as
// `str-append-loop`, returning only the size. `std::string` has no rope, so
// every piece is copied whether or not anything reads it; this column is what
// that costs, against engines that skip the copies.
#include <cstdint>
#include <string>
#include <vector>
#include "harness.h"

static std::uint32_t next(std::uint32_t x) { return x * 1664525u + 1013904223u; }

static std::vector<std::string> words(int count, std::uint32_t shortest,
                                      std::uint32_t longest, std::uint32_t x) {
    std::vector<std::string> out;
    for (int i = 0; i < count; i++) {
        x = next(x);
        const std::uint32_t length = shortest + (x >> 24) % (longest - shortest + 1);
        std::string word;
        for (std::uint32_t k = 0; k < length; k++) {
            x = next(x);
            word += static_cast<char>('a' + (x >> 24) % 26);
        }
        out.push_back(std::move(word));
    }
    return out;
}

static const std::vector<std::string> pieces = words(64, 1, 24, 13);

static std::int32_t work(std::int32_t seed) {
    const std::uint32_t s = static_cast<std::uint32_t>(seed) & 63;
    std::string out;
    for (std::uint32_t i = 0; i < 4096; i++) {
        out += pieces[(i * 13 + s) & 63];
    }
    return static_cast<std::int32_t>(out.size());
}

double bench_run(void) {
    volatile std::int32_t seed = 3;
    return static_cast<double>(work(seed));
}
