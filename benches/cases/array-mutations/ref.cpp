// What a C++ programmer writes: `std::vector`, and the standard library's names
// for the same six operations.
//
// `shift` is `erase(begin())` and `unshift` is `insert(begin(), v)` -- both move
// the rest of the elements, which is the same work the JavaScript pays and the
// reason this row is worth having. `splice` is a copy of the removed run and an
// `erase` of it; `concat` and the two copies are constructions.
#include <vector>
#include "harness.h"

static double mutations(double seed) {
    const int n = 128 + static_cast<int>(seed);
    std::vector<double> xs;
    for (int i = 0; i < n; i++) {
        xs.push_back(i * 3 + seed);
    }

    int total = 0;
    for (int round = 0; round < 8; round++) {
        xs.push_back(round + seed);
        total = total + static_cast<int>(xs.front());
        xs.erase(xs.begin());

        xs.insert(xs.begin(), round * 2 + seed);
        std::vector<double> gone(xs.begin() + 1, xs.begin() + 3);
        xs.erase(xs.begin() + 1, xs.begin() + 3);
        total = total + static_cast<int>(gone.size()) + static_cast<int>(gone[0]);

        std::vector<double> copy(xs);
        total = total + static_cast<int>(copy.size()) + static_cast<int>(copy[0]);

        std::vector<double> both(copy);
        both.insert(both.end(), gone.begin(), gone.end());
        total = total + static_cast<int>(both.size());
    }
    return total;
}

double bench_run(void) {
    volatile double seed = 3;
    return mutations(seed);
}
