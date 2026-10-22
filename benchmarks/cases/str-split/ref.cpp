// What a C++ programmer writes: split by hand into `std::string_view`s, one
// `std::vector` per line. Views own nothing, so a field costs no allocation;
// that is C++'s answer to this operation and the column is entitled to it.
//
// The same generator and lines as `case.ts`; ASCII, so one `char` is one UTF-16
// code unit.
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>
#include "harness.h"

static std::uint32_t next(std::uint32_t x) { return x * 1664525u + 1013904223u; }

static std::vector<std::string> make_lines(int count, std::uint32_t x) {
    std::vector<std::string> out;
    for (int i = 0; i < count; i++) {
        std::string line;
        for (int field = 0; field < 12; field++) {
            if (field > 0) line += ',';
            x = next(x);
            const std::uint32_t length = (x >> 24) % 11;
            for (std::uint32_t k = 0; k < length; k++) {
                x = next(x);
                line += static_cast<char>('a' + (x >> 24) % 26);
            }
        }
        out.push_back(std::move(line));
    }
    return out;
}

static const std::vector<std::string> lines = make_lines(64, 59);

static std::int32_t work(std::int32_t seed) {
    const std::uint32_t s = static_cast<std::uint32_t>(seed) & 63;
    std::uint32_t total = 0;
    for (std::uint32_t i = 0; i < 64; i++) {
        const std::string_view line = lines[(i + s) & 63];
        std::vector<std::string_view> fields;
        std::size_t start = 0;
        for (;;) {
            const std::size_t comma = line.find(',', start);
            fields.push_back(line.substr(start, comma - start));
            if (comma == std::string_view::npos) break;
            start = comma + 1;
        }
        for (const std::string_view field : fields) {
            total = total * 31 + static_cast<std::uint32_t>(field.size());
            if (!field.empty()) {
                total = total + static_cast<unsigned char>(field[0]);
            }
        }
    }
    return static_cast<std::int32_t>(total);
}

double bench_run(void) {
    volatile std::int32_t seed = 3;
    return static_cast<double>(work(seed));
}
