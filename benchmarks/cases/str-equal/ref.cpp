// What a C++ programmer writes: `std::string::operator==`, a size test and a
// `memcmp`, over separately built strings.
//
// The same generator, words and copies as `case.ts`; ASCII, so one `char` is
// one UTF-16 code unit.
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

static std::vector<std::string> copies(const std::vector<std::string> &from,
                                       bool last_changed) {
    std::vector<std::string> out;
    for (const std::string &word : from) {
        std::string copy;
        for (std::size_t k = 0; k < word.size(); k++) {
            char unit = word[k];
            if (last_changed && k == word.size() - 1) unit = unit == 'z' ? 'a' : unit + 1;
            copy += unit;
        }
        out.push_back(std::move(copy));
    }
    return out;
}

static const std::vector<std::string> first = words(256, 4, 64, 29);
static const std::vector<std::string> same = copies(first, false);
static const std::vector<std::string> other = copies(first, true);

static std::int32_t work(std::int32_t seed) {
    const std::uint32_t s = static_cast<std::uint32_t>(seed) & 255;
    std::uint32_t total = 0;
    for (std::uint32_t i = 0; i < 256; i++) {
        const std::uint32_t j = (i + s) & 255;
        const std::string &word = first[j];
        const std::uint32_t is_same = word == same[j] ? 1 : 0;
        const std::uint32_t is_other = word == other[j] ? 2 : 0;
        total = total * 31 + is_same + is_other + j;
    }
    return static_cast<std::int32_t>(total);
}

double bench_run(void) {
    volatile std::int32_t seed = 3;
    return static_cast<double>(work(seed));
}
