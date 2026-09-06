// What a C++ programmer writes: `std::unordered_map` and `std::unordered_set`.
//
// A fair reference and a demanding one -- both are real hash tables, so unlike
// `bigint` this row is not measuring a representation that gave something up.
// It is measuring whether ours is a good table.
//
// **`double` keys and values, not `int32_t`, and that is a correction.** The
// TypeScript is `Map<number, number>` and `Set<number>`; nts holds both in an
// erased `f64` payload. An `int32_t` table hashes with `std::hash<int32_t>`,
// which is the identity, where a `double` key hashes its bit pattern -- so the
// narrow version was a discount on exactly the operation this row exists to
// measure, and the comment above was claiming fairness the types did not
// deliver.
//
// `ref.java` took the same correction on the same day and it moved that column
// from 1.89x to 0.76x. Neither number was about the map: written by hand on
// both structures, our `NtsMap` runs 253 rounds in 76,784 cycles against
// `HashMap<Double, Double>`'s 128,540.
#include <cstdint>
#include <unordered_map>
#include <unordered_set>
#include "harness.h"

static std::int32_t table(std::int32_t seed) {
    std::unordered_map<double, double> seen;
    std::unordered_set<double> marks;
    const std::int32_t rounds = 253 + seed;

    for (std::int32_t i = 0; i < rounds; i++) {
        seen[static_cast<double>(i * 7)] = static_cast<double>(i);
        marks.insert(static_cast<double>(i * 3));
    }
    std::int32_t total = 0;
    for (std::int32_t i = 0; i < rounds; i++) {
        const auto found = seen.find(static_cast<double>(i * 7));
        total = total + (found == seen.end() ? 0 : static_cast<std::int32_t>(found->second));
        if (marks.count(static_cast<double>(i * 3)) != 0) {
            total = total + 1;
        }
        if (seen.count(static_cast<double>(i * 7 + 1)) != 0) {
            total = total + 100;
        }
    }
    for (std::int32_t i = 0; i < rounds; i++) {
        seen[static_cast<double>(i * 7)] = static_cast<double>(total);
    }
    return total + static_cast<std::int32_t>(seen.size()) +
           static_cast<std::int32_t>(marks.size());
}

double bench_run(void) {
    volatile std::int32_t seed = 3;
    return static_cast<double>(table(seed));
}
