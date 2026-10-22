// What a C++ programmer writes: `std::string joined = a + b`, one exact-size
// allocation and two copies, which is the work `a + b` asks for.
//
// The inputs are drawn from the same generator as `case.ts`, in the same order,
// and are ASCII, so one `char` is one UTF-16 code unit and the checksum agrees.
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

static const std::vector<std::string> left = words(8, 3, 40, 11);
static const std::vector<std::string> right = words(8, 3, 40, 23);

static std::uint32_t unit(const std::string &s, std::size_t at) {
    return static_cast<unsigned char>(s[at]);
}

static std::int32_t work(std::int32_t seed) {
    const std::uint32_t s = static_cast<std::uint32_t>(seed) & 63;
    std::uint32_t total = 0;
    for (std::uint32_t i = 0; i < 256; i++) {
        const std::uint32_t j = (i + s) & 63;
        const std::string joined = left[j & 7] + right[j >> 3];
        const std::size_t n = joined.size();
        std::uint32_t h = static_cast<std::uint32_t>(n);
        h = h * 31 + unit(joined, 0);
        h = h * 31 + unit(joined, n >> 2);
        h = h * 31 + unit(joined, n >> 1);
        h = h * 31 + unit(joined, n - 1);
        total = total * 31 + h;
    }
    return static_cast<std::int32_t>(total);
}

double bench_run(void) {
    volatile std::int32_t seed = 3;
    return static_cast<double>(work(seed));
}
