// What a C++ programmer writes without a library: a hand loop from UTF-16
// (`std::u16string`, the units the TypeScript holds) to UTF-8, into a fresh
// `std::string` reserved at three bytes a unit, as `encode` makes a fresh array.
// Surrogate pairs become four bytes; there are no lone ones.
//
// The same generator and strings as `case.ts`.
#include <cstdint>
#include <string>
#include <vector>
#include "harness.h"

static std::uint32_t next(std::uint32_t x) { return x * 1664525u + 1013904223u; }

static std::vector<std::u16string> make_texts(int count, std::uint32_t x) {
    std::vector<std::u16string> out;
    for (int i = 0; i < count; i++) {
        const int kind = i & 3;
        x = next(x);
        const std::uint32_t length = 16 + (x >> 24) % 33;
        std::u16string text;
        for (std::uint32_t k = 0; k < length; k++) {
            x = next(x);
            const std::uint32_t r = x >> 24;
            if (kind == 0 || r >= 64) {
                text += static_cast<char16_t>('a' + r % 26);
            } else if (kind == 1) {
                text += static_cast<char16_t>(0xe0 + r % 32);
            } else if (kind == 2) {
                text += static_cast<char16_t>(0x4e00 + r * 37);
            } else {
                const std::uint32_t point = 0x1f600 + r - 0x10000;
                text += static_cast<char16_t>(0xd800 + (point >> 10));
                text += static_cast<char16_t>(0xdc00 + (point & 0x3ff));
            }
        }
        out.push_back(std::move(text));
    }
    return out;
}

static const std::vector<std::u16string> texts = make_texts(64, 73);

static std::string encode(const std::u16string &text) {
    std::string out;
    out.reserve(text.size() * 3);
    for (std::size_t k = 0; k < text.size(); k++) {
        std::uint32_t point = text[k];
        if (point >= 0xd800 && point <= 0xdbff && k + 1 < text.size()) {
            point = 0x10000 + ((point - 0xd800) << 10) + (text[k + 1] - 0xdc00);
            k++;
        }
        if (point < 0x80) {
            out += static_cast<char>(point);
        } else if (point < 0x800) {
            out += static_cast<char>(0xc0 | (point >> 6));
            out += static_cast<char>(0x80 | (point & 0x3f));
        } else if (point < 0x10000) {
            out += static_cast<char>(0xe0 | (point >> 12));
            out += static_cast<char>(0x80 | ((point >> 6) & 0x3f));
            out += static_cast<char>(0x80 | (point & 0x3f));
        } else {
            out += static_cast<char>(0xf0 | (point >> 18));
            out += static_cast<char>(0x80 | ((point >> 12) & 0x3f));
            out += static_cast<char>(0x80 | ((point >> 6) & 0x3f));
            out += static_cast<char>(0x80 | (point & 0x3f));
        }
    }
    return out;
}

static std::int32_t work(std::int32_t seed) {
    const std::uint32_t s = static_cast<std::uint32_t>(seed) & 63;
    std::uint32_t total = 0;
    for (std::uint32_t i = 0; i < 64; i++) {
        const std::string bytes = encode(texts[(i + s) & 63]);
        std::uint32_t sum = static_cast<std::uint32_t>(bytes.size());
        for (const char c : bytes) {
            sum = sum + static_cast<unsigned char>(c);
        }
        total = total * 31 + sum;
    }
    return static_cast<std::int32_t>(total);
}

double bench_run(void) {
    volatile std::int32_t seed = 3;
    return static_cast<double>(work(seed));
}
