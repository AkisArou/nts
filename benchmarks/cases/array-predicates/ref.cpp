// What a C++ programmer writes: a `std::vector` and the four algorithms that
// ask these four questions. `find_if` has no index-returning form, so the
// subtraction is spelled out, which is the idiom; `copy_if` needs somewhere to
// put its output, which is the allocation `filter` also pays.
#include <algorithm>
#include <vector>
#include "harness.h"

static double predicates(double seed) {
    const int n = 256 + static_cast<int>(seed);
    std::vector<double> xs;
    for (int i = 0; i < n; i++) {
        xs.push_back(i * 7 + seed);
    }

    int total = 0;
    for (int round = 0; round < 8; round++) {
        const double target = round * 13 + seed;
        if (std::any_of(xs.begin(), xs.end(),
                        [target](double v) { return v == target; })) {
            total = total + 1;
        }
        if (std::all_of(xs.begin(), xs.end(),
                        [](double v) { return v >= 0; })) {
            total = total + 2;
        }
        const auto found = std::find_if(xs.begin(), xs.end(),
                                        [target](double v) { return v > target; });
        total = total + static_cast<int>(
            found == xs.end() ? -1 : found - xs.begin());
        std::vector<double> kept;
        std::copy_if(xs.begin(), xs.end(), std::back_inserter(kept),
                     [target](double v) { return v > target; });
        total = total + static_cast<int>(kept.size());
    }
    return total;
}

double bench_run(void) {
    volatile double seed = 3;
    return predicates(seed);
}
