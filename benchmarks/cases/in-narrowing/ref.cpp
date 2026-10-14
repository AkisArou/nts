// What a C++ programmer writes: a tag the program maintains, and a switch.
//
// The fair bar, and it is a *lower* one than the TypeScript in one respect --
// the tag is a field this struct spends and the TypeScript spends nothing,
// because the shape is already distinguishable by its descriptor. It is also a
// higher one in another: the switch is a jump clang compiles to a table, where
// a descriptor test is a comparison chain.
#include <cstdint>
#include "harness.h"

enum Kind { CIRCLE, SQUARE, WIDE };

struct Shape {
    Kind kind;
    std::int32_t radius;
    std::int32_t side;
    std::int32_t both;
};

static std::int32_t work(std::int32_t seed) {
    const std::int32_t step = seed;
    std::int32_t total = 0;
    for (std::int32_t i = 0; i < 4096; i++) {
        const std::int32_t which = i & 3;
        Shape shape{};
        if (which == 0) {
            shape.kind = CIRCLE;
            shape.radius = (i ^ step) & 0xffff;
        } else if (which == 1) {
            shape.kind = SQUARE;
            shape.side = (i + step) & 0xffff;
        } else {
            shape.kind = WIDE;
            shape.radius = i & 0xff;
            shape.side = step & 0xff;
            shape.both = (i ^ step) & 0xff;
        }
        if (shape.kind == WIDE) {
            total = total ^ (shape.both * 3);
        } else if (shape.kind == CIRCLE) {
            total = total ^ (shape.radius * 5);
        } else {
            total = total ^ (shape.side * 7);
        }
    }
    return total;
}

double bench_run(void) {
    volatile std::int32_t seed = 5;
    return static_cast<double>(work(seed));
}
