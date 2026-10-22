// What a C++ programmer writes when the pieces are known: `reserve` the
// result, then append each piece, with the integer written by `std::to_chars`
// straight into a stack buffer. One allocation and one copy of each piece.
//
// The same generator and order as `case.ts`; the pieces are ASCII, so one
// `char` is one UTF-16 code unit. `std::to_chars` on an `int32_t` writes exactly
// the digits `String(n)` does for an integer.
#include <charconv>
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

static const std::vector<std::string> names = words(8, 3, 16, 5);
static const std::vector<std::string> tags = words(8, 2, 10, 7);

static std::int32_t work(std::int32_t seed) {
    const std::uint32_t base = static_cast<std::uint32_t>(seed);
    const std::uint32_t s = base & 63;
    std::uint32_t total = 0;
    for (std::uint32_t i = 0; i < 256; i++) {
        const std::uint32_t j = (i + s) & 63;
        const std::int32_t id = static_cast<std::int32_t>(i * 7919 + base);
        const std::string &name = names[j & 7];
        const std::string &tag = tags[j >> 3];
        std::string text;
        text.reserve(name.size() + tag.size() + 13);
        text += name;
        text += ':';
        char digits[12];
        text.append(digits, std::to_chars(digits, digits + sizeof digits, id).ptr);
        text += ',';
        text += tag;
        std::uint32_t h = static_cast<std::uint32_t>(text.size());
        for (const char c : text) {
            h = h * 31 + static_cast<unsigned char>(c);
        }
        total = total * 31 + h;
    }
    return static_cast<std::int32_t>(total);
}

double bench_run(void) {
    volatile std::int32_t seed = 3;
    return static_cast<double>(work(seed));
}
