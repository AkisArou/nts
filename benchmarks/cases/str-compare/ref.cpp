// What a C++ programmer writes for this program: the same insertion sort, with
// `std::string::operator>` (a `memcmp` of the common length, then the sizes)
// and moves rather than copies.
//
// **The same algorithm, not `std::sort`.** The row prices the comparison;
// introsort would make about a quarter as many of them and the ratio would be
// about the algorithm instead.
//
// The same generator and strings as `case.ts`; ASCII, so bytes order as UTF-16
// code units do.
#include <cstdint>
#include <string>
#include <utility>
#include <vector>
#include "harness.h"

static std::uint32_t next(std::uint32_t x) { return x * 1664525u + 1013904223u; }

static std::vector<std::string> keys(int count, std::uint32_t x) {
    std::string stem;
    for (int k = 0; k < 16; k++) {
        x = next(x);
        stem += static_cast<char>('a' + (x >> 24) % 26);
    }
    static constexpr std::size_t prefixes[4] = {0, 4, 8, 16};
    std::vector<std::string> out;
    for (int i = 0; i < count; i++) {
        x = next(x);
        std::string key = stem.substr(0, prefixes[(x >> 24) & 3]);
        x = next(x);
        const std::uint32_t tail = 2 + (x >> 24) % 9;
        for (std::uint32_t k = 0; k < tail; k++) {
            x = next(x);
            key += static_cast<char>('a' + (x >> 24) % 26);
        }
        out.push_back(std::move(key));
    }
    return out;
}

static const std::vector<std::string> all_keys = keys(64, 37);

static std::int32_t work(std::int32_t seed) {
    const std::uint32_t s = static_cast<std::uint32_t>(seed) & 63;
    std::vector<std::string> sorted;
    for (std::uint32_t i = 0; i < 64; i++) {
        sorted.push_back(all_keys[(i + s) & 63]);
    }
    for (std::size_t i = 1; i < sorted.size(); i++) {
        std::string key = std::move(sorted[i]);
        std::size_t j = i;
        while (j > 0 && sorted[j - 1] > key) {
            sorted[j] = std::move(sorted[j - 1]);
            j--;
        }
        sorted[j] = std::move(key);
    }
    std::uint32_t h = 0;
    for (const std::string &key : sorted) {
        for (const char c : key) {
            h = h * 31 + static_cast<unsigned char>(c);
        }
    }
    return static_cast<std::int32_t>(h);
}

double bench_run(void) {
    volatile std::int32_t seed = 3;
    return static_cast<double>(work(seed));
}
