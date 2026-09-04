// A test and a conditional store, which is what `a ||= b` means.
//
// The C++ a programmer writes for "fill it if it is empty" is exactly this, so
// the row asks whether the operator costs more than the two instructions it
// stands for rather than comparing it against a different mechanism.
//
// Unsigned for the wrapping, as `accumulate`'s reference is and for the same
// reason: JavaScript's bitwise operators are defined modulo 2^32 and signed
// overflow is undefined in C++, so the wrapping is the semantics rather than an
// accident.
//
// The bound is a parameter and the `volatile` sits at the call site, which is
// the convention the rest of this suite uses and the structure `nts.cpp`
// already had. Spelling it `volatile` in the loop *condition* instead makes the
// reference reload it from memory every iteration and blocks vectorisation, so
// the C++ pays a cost the nts side does not.
#include <cstdint>
#include "harness.h"

static double run_loop(std::int64_t rounds) {
    // Unsigned, and not only for the bitwise step: `total` passes 2^31 well
    // before the bound, and signed overflow is undefined in C++ while
    // `(total + cached) | 0` is defined to wrap.
    std::uint32_t total = 0;
    std::uint32_t seed = 1;
    for (std::int64_t i = 0; i < rounds; i++) {
        seed = seed * 31u + static_cast<std::uint32_t>(i);
        std::int32_t cached = static_cast<std::int32_t>(seed & 3u);
        if (!cached) {
            cached = static_cast<std::int32_t>(i) + 1;
        }
        total = total + static_cast<std::uint32_t>(cached);
    }
    return static_cast<double>(static_cast<std::int32_t>(total));
}

double bench_run(void) {
    volatile std::int64_t rounds = 100000;
    return run_loop(rounds);
}
