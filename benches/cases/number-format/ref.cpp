// What a C++ programmer writes: `std::to_string` on an `int`.
//
// A fair reference here and only here. For an integer it produces exactly the
// characters `String(n)` does, so the checksum -- a sum of lengths -- agrees
// without either side being bent to match. For a `double` it would not:
// `std::to_string` is six fixed decimals and JavaScript's is the shortest
// decimal that reads back as the same value, which is a different algorithm
// rather than a different format.
#include <cstdint>
#include <string>
#include "harness.h"

static std::int32_t format(std::int32_t seed) {
    std::int32_t total = 0;
    for (std::int32_t round = 0; round < 64; round++) {
        const std::int32_t small = round + seed;
        const std::int32_t wide = round * 7919 + seed;
        const std::int32_t negative = -wide;
        const std::string a = std::to_string(small);
        const std::string b = std::to_string(wide);
        const std::string c = std::to_string(negative);
        for (char ch : a) {
            total = total + static_cast<std::int32_t>(static_cast<unsigned char>(ch));
        }
        for (char ch : b) {
            total = total + static_cast<std::int32_t>(static_cast<unsigned char>(ch));
        }
        for (char ch : c) {
            total = total + static_cast<std::int32_t>(static_cast<unsigned char>(ch));
        }
    }
    return total;
}

double bench_run(void) {
    volatile std::int32_t seed = 3;
    return static_cast<double>(format(seed));
}
