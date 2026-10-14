// What a C++ programmer writes: a `std::vector` copy for the contiguous source,
// and a loop for the one that is not contiguous.
//
// The `unordered_set` is the fair counterpart of a `Set`: a hash table whose
// elements are not in one run of memory, so listing them is a walk whatever the
// language. The vector copy is the counterpart of the `slice` this compiler
// used to emit for an array source, which is the comparison the row exists for.
#include <vector>
#include <unordered_set>
#include "harness.h"

double bench_run(void) {
    volatile double seed_in = 5;
    double seed = seed_in;

    std::vector<double> xs;
    for (int i = 0; i < 256; i++) {
        xs.push_back(i + seed);
    }
    std::unordered_set<double> marks;
    for (int i = 0; i < 256; i++) {
        marks.insert(i * 3 + seed);
    }

    double total = 0;
    for (int round = 0; round < 2000; round++) {
        std::vector<double> copied(xs);
        total = total + copied[round % 256];
        std::vector<double> listed;
        listed.reserve(marks.size());
        for (double m : marks) {
            listed.push_back(m);
        }
        total = total + static_cast<double>(listed.size());
    }
    return total;
}
