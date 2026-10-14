// What a C++ programmer writes. `std::string_view` over a literal: no
// allocation, and `find` is the library's substring search.
//
// The text is ASCII, so one `char` is one UTF-16 code unit and indexing agrees
// with `charCodeAt`. That is the only reason a byte loop is a fair comparison
// here; over non-ASCII it would not be, and the nts side would be right.
#include <cstdint>
#include <string_view>
#include "harness.h"

static std::int32_t scan(std::int32_t step) {
    constexpr std::string_view text = "the quick brown fox jumps over the lazy dog";
    std::int32_t total = 0;
    for (std::int32_t round = 0; round < 128; round++) {
        for (std::size_t i = 0; i < text.size(); i++) {
            total = total + static_cast<std::int32_t>(
                                static_cast<unsigned char>(text[i])) * step;
        }
        total = total + static_cast<std::int32_t>(text.find("brown"));
        if (text.find("jumps") != std::string_view::npos) {
            total = total + 1;
        }
        if (text.starts_with("the")) {
            total = total + 2;
        }
    }
    return total;
}

double bench_run(void) {
    volatile std::int32_t seed = 3;
    return static_cast<double>(scan(seed));
}
