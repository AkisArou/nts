// The same interpreter loop a C++ programmer writes: a `switch` over an opcode,
// which every compiler worth using turns into a jump table.
//
// `int32_t` throughout, because that is what the TypeScript is after `| 0` --
// the masking in the source is what makes the two the same program rather than
// a fast one and a correct one.
#include <cstdint>
#include <array>
#include "harness.h"

static std::int32_t run(std::int32_t seed) {
    constexpr std::int32_t length = 512;
    std::array<std::int32_t, length> program{};
    std::int32_t state = seed;
    for (std::int32_t i = 0; i < length; i++) {
        state = (state * 1309 + 13849) & 65535;
        program[i] = state & 7;
    }

    std::int32_t acc = 0;
    std::int32_t count = 0;
    for (std::int32_t round = 0; round < 64; round++) {
        for (std::int32_t pc = 0; pc < length; pc++) {
            switch (program[pc]) {
                case 0: acc = acc + 1; break;
                case 1: acc = acc - 3; break;
                case 2: acc = static_cast<std::int32_t>(
                            static_cast<std::uint32_t>(acc) * 2u); break;
                case 3: acc = acc ^ 0x5a5a; break;
                case 4: acc = acc >> 1; break;
                case 5: count = count + 1;
                        [[fallthrough]];
                case 6: acc = acc + count; break;
                default: acc = acc | 1; break;
            }
        }
    }
    return acc + count;
}

double bench_run(void) {
    volatile std::int32_t seed = 7;
    return static_cast<double>(run(seed));
}
