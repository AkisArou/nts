// A branch, not a C++ `throw`.
//
// This is the ceiling on purpose, and it is a harsh one. A C++ programmer does
// not put `throw`/`catch` in a loop like this -- the idiom is a status return
// or a branch, because a real C++ throw walks unwind tables and costs
// microseconds. Writing that here would make this row flattering and
// uninteresting: it would measure two mechanisms rather than one program.
//
// So the reference is the code the exception is *supposed to compile to*, and
// the row asks one question: does a `throw` caught in the same function cost
// more than the branch it should be? A handler here is a block, a `throw` is a
// jump carrying an erased value, and the thrown object lives in the frame --
// so the honest comparison is against the branch, and anything above 1.00 on
// this row is the erasure and the frame object, not the control flow.
#include <cstdint>
#include "harness.h"


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
        if ((i & 7) == 0) {
            total += 2;
        } else {
            total += 1;
        }
    }
    return static_cast<double>(total);
}

double bench_run(void) {
    volatile std::int64_t rounds = 100000;
    return run_loop(rounds);
}
