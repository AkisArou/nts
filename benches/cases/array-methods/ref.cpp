// What a C++ programmer writes: a `std::array` and the algorithms from the
// library. `find` and `rfind` have no direct equivalent returning an index, so
// this is `std::find` with the subtraction spelled out, which is the idiom.
#include <algorithm>
#include <array>
#include <cstdint>
#include "harness.h"

static std::int32_t work(std::int32_t step) {
    std::array<std::int32_t, 16> xs = {3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8, 9, 7, 9, 3};
    std::int32_t total = 0;
    for (std::int32_t round = 0; round < 256; round++) {
        const auto first = std::find(xs.begin(), xs.end(), step);
        const auto last = std::find(xs.rbegin(), xs.rend(), step);
        total = total + static_cast<std::int32_t>(
                            first == xs.end() ? -1 : first - xs.begin());
        total = total + static_cast<std::int32_t>(
                            last == xs.rend() ? -1
                                              : static_cast<std::int32_t>(xs.size()) - 1
                                                    - (last - xs.rbegin()));
        if (first != xs.end()) {
            total = total + 1;
        }
        total = total + xs.back();
        std::reverse(xs.begin(), xs.end());
    }
    return total;
}

double bench_run(void) {
    volatile std::int32_t seed = 5;
    return static_cast<double>(work(seed));
}
