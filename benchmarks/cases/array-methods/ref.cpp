// What a C++ programmer writes: a `std::array` and the algorithms from the
// library. `find` and `rfind` have no direct equivalent returning an index, so
// this is `std::find` with the subtraction spelled out, which is the idiom.
//
// **`double`, not `int32_t`, and that is a correction.** The TypeScript is
// `number[]` and nts emits `nts_array_new(&nts_desc_double, ...)`, so an
// `int32_t` array here made the reference scan four bytes an element where the
// subject scans eight, and compare integers where the subject compares
// doubles. On this row that is not incidental: `indexOf` and `lastIndexOf`
// *are* the workload, so the narrowing was a discount on the one operation
// being measured.
//
// The same correction `ref.java` took, for the same reason and on the same day.
// `dispatch` keeps its `int32_t` and is the control: `hir::elements` narrows an
// array holding only 0 to 7, so both sides genuinely hold an int and widening
// it would make *that* reference wrong in the other direction.
#include <algorithm>
#include <array>
#include <cstdint>
#include "harness.h"

static std::int32_t work(std::int32_t step) {
    std::array<double, 16> xs = {3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8, 9, 7, 9, 3};
    std::int32_t total = 0;
    for (std::int32_t round = 0; round < 256; round++) {
        const double needle = static_cast<double>(step);
        const auto first = std::find(xs.begin(), xs.end(), needle);
        const auto last = std::find(xs.rbegin(), xs.rend(), needle);
        total = total + static_cast<std::int32_t>(
                            first == xs.end() ? -1 : first - xs.begin());
        total = total + static_cast<std::int32_t>(
                            last == xs.rend() ? -1
                                              : static_cast<std::int32_t>(xs.size()) - 1
                                                    - (last - xs.rbegin()));
        if (first != xs.end()) {
            total = total + 1;
        }
        total = total + static_cast<std::int32_t>(xs.back());
        std::reverse(xs.begin(), xs.end());
    }
    return total;
}

double bench_run(void) {
    volatile std::int32_t seed = 5;
    return static_cast<double>(work(seed));
}
