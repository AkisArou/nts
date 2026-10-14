// What a C++ programmer writes: `std::string_view::substr`, which returns
// another view of the same characters and allocates nothing.
//
// That is the whole point of this case. The C++ column here is not a target so
// much as a statement of what a representation that can alias its input costs
// -- which is nothing -- against one that must copy.
//
// The text is ASCII, so one `char` is one UTF-16 code unit and indexing agrees
// with `charCodeAt`.
#include <cstdint>
#include <string_view>
#include "harness.h"

static std::int32_t work(std::int32_t step) {
    constexpr std::string_view text =
        "the quick brown fox jumps over the lazy dog and then some more words follow here";
    std::int32_t total = 0;

    for (std::int32_t round = 0; round < 64; round++) {
        std::size_t start = 0;
        for (std::size_t i = 0; i <= text.size(); i++) {
            if (i == text.size() || text[i] == ' ') {
                const std::string_view word = text.substr(start, i - start);
                total = total + static_cast<std::int32_t>(word.size()) * step;
                if (!word.empty()) {
                    total = total + static_cast<std::int32_t>(
                                        static_cast<unsigned char>(word[0]));
                }
                start = i + 1;
            }
        }
    }
    return total;
}

double bench_run(void) {
    volatile std::int32_t seed = 3;
    return static_cast<double>(work(seed));
}
