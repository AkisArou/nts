// A table keyed by an address, which is what a symbol is.
//
// Not a string map. A symbol's identity is the address of its cell, so the C++
// analogue hashes a pointer and compares with `==` — and a string-keyed
// reference would be measuring exactly the hashing this case exists to say is
// not happening.
//
// Five distinct cells, four inserted and one never, so the loop takes the miss
// path as often as the hit path.
#include <cstdint>
#include <unordered_map>
#include "harness.h"

namespace {
// `char` so the cells are one byte apart: distinct addresses with no structure
// for the hash to find that the real ones would not have.
char cells[5];
const void *const a = &cells[0];
const void *const b = &cells[1];
const void *const c = &cells[2];
const void *const d = &cells[3];
const void *const absent = &cells[4];
}  // namespace

static std::int32_t work(std::int32_t seed) {
    const std::int32_t step = seed;
    std::unordered_map<const void *, std::int32_t> events;
    events[a] = 1;
    events[b] = 2;
    events[c] = 3;
    events[d] = 4;
    std::int32_t total = 0;
    for (std::int32_t i = 0; i < 4096; i++) {
        const std::int32_t which = (i ^ step) & 3;
        const void *key = which == 0 ? a : which == 1 ? b : which == 2 ? c : d;
        const auto found = events.find(key);
        total = total + (found == events.end() ? 0 : found->second);
        const auto missing = events.find(absent);
        total = total + (missing == events.end() ? 0 : missing->second);
    }
    return total;
}

double bench_run(void) {
    volatile std::int32_t seed = 5;
    return static_cast<double>(work(seed));
}
