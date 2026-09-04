// A null check and an indirect call, which is what `f?.(x)` means.
//
// The C++ a programmer writes for "call it if there is one" is exactly this: a
// pointer that may be null, tested before it is used. So the row asks whether
// the optional call costs more than the test and the call it stands for --
// which is the only interesting question, since there is no other mechanism
// here to compare against.
//
// Neither side allocates. That is the point: an earlier version of this case
// built its holder through a factory, and the two heap allocations an iteration
// buried the thing being measured.
#include <cstdint>
#include "harness.h"

struct Held {
    std::int64_t (*fn)(std::int64_t);
};

static std::int64_t plus_one(std::int64_t x) {
    return x + 1;
}


// The bound is taken as a parameter and the `volatile` sits at the call site,
// which is the convention the rest of this suite uses and the structure
// `nts.cpp` already had. Spelling it `volatile std::int64_t rounds` in the loop
// *condition* instead makes the reference reload it from memory every
// iteration and blocks vectorisation, so the C++ pays a cost the nts side does
// not -- and the ratio flatters nts by whatever that costs. It cannot simply be
// made a constant either: the answer here depends on nothing but the iteration
// count, so clang folds the whole loop to a literal and the row reads 1.4 ns.
static double run_loop(std::int64_t rounds) {
    std::int64_t total = 0;
    for (std::int64_t i = 0; i < rounds; i++) {
        Held h{nullptr};
        if (i % 2 == 0) {
            h.fn = plus_one;
        }
        total += h.fn ? h.fn(1) : 1;
    }
    return static_cast<double>(total);
}

double bench_run(void) {
    volatile std::int64_t rounds = 100000;
    return run_loop(rounds);
}
