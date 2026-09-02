// What a C++ programmer writes: `std::unordered_map` and `std::unordered_set`.
//
// A fair reference and a demanding one -- both are real hash tables, so unlike
// `bigint` this row is not measuring a representation that gave something up.
// It is measuring whether ours is a good table.
#include <cstdint>
#include <unordered_map>
#include <unordered_set>
#include "harness.h"

static std::int32_t table(std::int32_t seed) {
    std::unordered_map<std::int32_t, std::int32_t> seen;
    std::unordered_set<std::int32_t> marks;
    const std::int32_t rounds = 253 + seed;

    for (std::int32_t i = 0; i < rounds; i++) {
        seen[i * 7] = i;
        marks.insert(i * 3);
    }
    std::int32_t total = 0;
    for (std::int32_t i = 0; i < rounds; i++) {
        const auto found = seen.find(i * 7);
        total = total + (found == seen.end() ? 0 : found->second);
        if (marks.count(i * 3) != 0) {
            total = total + 1;
        }
        if (seen.count(i * 7 + 1) != 0) {
            total = total + 100;
        }
    }
    for (std::int32_t i = 0; i < rounds; i++) {
        seen[i * 7] = total;
    }
    return total + static_cast<std::int32_t>(seen.size()) +
           static_cast<std::int32_t>(marks.size());
}

double bench_run(void) {
    volatile std::int32_t seed = 3;
    return static_cast<double>(table(seed));
}
