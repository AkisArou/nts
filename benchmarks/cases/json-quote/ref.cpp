// What a C++ programmer writes: a byte-at-a-time Table 78 escaper appending
// into one `std::string` -- the seven short escapes, `\u00xx` in lowercase hex
// for any other control character, everything else as it stands.
//
// It covers ASCII only, and so does the corpus: a lone surrogate is the one
// escape Table 78 has above U+007F, and UTF-8 bytes would not be the UTF-16
// units the TypeScript hashes. The same generator and corpus as `case.ts`.
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>
#include "harness.h"

static std::uint32_t next(std::uint32_t x) { return x * 1664525u + 1013904223u; }

static std::vector<std::string> make_corpus(int count, std::uint32_t x) {
    static constexpr char escaped[5] = {'"', '\\', '\n', '\t', '\x01'};
    std::vector<std::string> out;
    for (int i = 0; i < count; i++) {
        x = next(x);
        const std::uint32_t length = 8 + (x >> 24) % 57;
        std::string text;
        for (std::uint32_t k = 0; k < length; k++) {
            x = next(x);
            const std::uint32_t r = x >> 24;
            if (r < 5) text += escaped[r];
            else if (r < 40) text += ' ';
            else text += static_cast<char>('a' + r % 26);
        }
        out.push_back(std::move(text));
    }
    return out;
}

static const std::vector<std::string> corpus = make_corpus(64, 71);

static void quote(std::string &out, std::string_view text) {
    static constexpr char hex[] = "0123456789abcdef";
    out += '"';
    for (const char c : text) {
        const unsigned char unit = static_cast<unsigned char>(c);
        switch (c) {
        case '"': out += "\\\""; break;
        case '\\': out += "\\\\"; break;
        case '\n': out += "\\n"; break;
        case '\r': out += "\\r"; break;
        case '\t': out += "\\t"; break;
        case '\b': out += "\\b"; break;
        case '\f': out += "\\f"; break;
        default:
            if (unit < 0x20) {
                out += "\\u00";
                out += hex[unit >> 4];
                out += hex[unit & 15];
            } else {
                out += c;
            }
        }
    }
    out += '"';
}

static std::int32_t work(std::int32_t seed) {
    const std::uint32_t s = static_cast<std::uint32_t>(seed) & 63;
    std::string out = "[";
    for (std::uint32_t i = 0; i < 64; i++) {
        if (i > 0) out += ',';
        quote(out, corpus[(i + s) & 63]);
    }
    out += ']';
    std::uint32_t h = 0;
    for (const char c : out) {
        h = h * 31 + static_cast<unsigned char>(c);
    }
    return static_cast<std::int32_t>(h * 31 + static_cast<std::uint32_t>(out.size()));
}

double bench_run(void) {
    volatile std::int32_t seed = 3;
    return static_cast<double>(work(seed));
}
