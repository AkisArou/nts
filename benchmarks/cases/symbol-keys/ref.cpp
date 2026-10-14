// What a symbol key compiles to if the claim holds: a struct field. Four of
// them, two written through each spelling in the TypeScript, and one struct
// here because there is only one thing to write.
#include <cstdint>
#include "harness.h"

struct Cell {
    std::int32_t count;
    std::int32_t plain_count;
    bool flag;
    bool plain_flag;
};

static std::int32_t keys(std::int32_t seed) {
    Cell cell{seed, seed, false, false};
    std::int32_t total = 0;
    const std::int32_t rounds = 509 + seed;
    for (std::int32_t round = 0; round < rounds; round++) {
        cell.count = (cell.count * 31) ^ round;
        cell.flag = !cell.flag;
        cell.plain_count = (cell.plain_count * 31) ^ round;
        cell.plain_flag = !cell.plain_flag;
        total = total ^ cell.count ^ cell.plain_count;
    }
    return total + (cell.flag ? 1 : 0) + (cell.plain_flag ? 2 : 0);
}

double bench_run(void) {
    volatile std::int32_t seed = 3;
    return static_cast<double>(keys(seed));
}
