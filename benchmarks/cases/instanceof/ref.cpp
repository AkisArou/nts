// A tag compare, not `dynamic_cast`.
//
// This is the ceiling on purpose, and it is the harder one. `dynamic_cast` is
// the like-for-like mechanism -- it answers the same question through RTTI --
// and it loses by a wide margin, which would make this row flattering and
// uninteresting. A C++ programmer who cares writes a tag, and a tag compare is
// exactly what `instanceof` should compile to here: the set of classes that
// satisfy it is closed when the program is built, so there is no chain to walk.
//
// So the row asks one question: does `instanceof` cost more than the comparison
// it should be? It does not -- nts comes in *under* this ceiling, and the
// reason is not that the test is free. This reference returns a `Shape` by
// value on every iteration, which is a copy; nts places its shapes in the frame
// and the test folds against a descriptor it can see. The row is honest about
// the question and is not a like-for-like on the allocation.
#include <cstdint>
#include "harness.h"

enum Kind : std::int32_t { CIRCLE, SQUARE, SHAPE };

struct Shape {
    Kind kind;
    std::int32_t size;
};

static Shape shape(std::int32_t i) {
    if (i % 3 == 0) {
        return Shape{CIRCLE, i};
    }
    if (i % 3 == 1) {
        return Shape{SQUARE, i};
    }
    return Shape{SHAPE, i};
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
        const Shape s = shape(static_cast<std::int32_t>(i));
        if (s.kind == CIRCLE) {
            total += 1;
        } else if (s.kind == SQUARE) {
            total += 2;
        } else {
            total += 3;
        }
    }
    return static_cast<double>(total);
}

double bench_run(void) {
    volatile std::int64_t rounds = 100000;
    return run_loop(rounds);
}
