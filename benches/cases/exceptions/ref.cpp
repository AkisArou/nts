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

double bench_run(void) {
    volatile std::int64_t rounds = 100000;
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
