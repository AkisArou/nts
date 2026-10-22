// What a C++ programmer writes: add up the size, `reserve` it, then append each
// part and separator. One allocation and one copy of every unit, which is what
// `join` can cost at best.
//
// The same generator and parts as `case.ts`; ASCII, so one `char` is one UTF-16
// code unit.
#include <cstdint>
#include <string>
#include <string_view>
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

static const std::vector<std::string> parts = words(256, 1, 16, 61);
static constexpr std::string_view separators[4] = {",", ";", ", ", " | "};

static std::int32_t work(std::int32_t seed) {
    const std::string_view separator = separators[static_cast<std::uint32_t>(seed) & 3];
    std::size_t size = 0;
    for (const std::string &part : parts) {
        size += part.size() + separator.size();
    }
    std::string joined;
    joined.reserve(size);
    for (std::size_t i = 0; i < parts.size(); i++) {
        if (i > 0) joined += separator;
        joined += parts[i];
    }
    std::uint32_t h = 0;
    for (std::size_t k = 0; k < joined.size(); k += 16) {
        h = h * 31 + static_cast<unsigned char>(joined[k]);
    }
    return static_cast<std::int32_t>(h * 31 + static_cast<std::uint32_t>(joined.size()));
}

double bench_run(void) {
    volatile std::int32_t seed = 3;
    return static_cast<double>(work(seed));
}
