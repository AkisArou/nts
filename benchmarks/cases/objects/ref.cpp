// A C++ programmer does not heap-allocate a two-field vector per iteration, and
// this is the version that says so. `point` is a local; the compiler keeps it in
// registers and there is no allocator in the loop at all.
//
// That is the same conclusion nts reaches, by a different route: escape analysis
// proves the object never leaves the frame. The row is a check that the two
// agree.
#include <cstdint>
#include "harness.h"

struct Vec2 {
    double x;
    double y;

    double dot(const Vec2 &other) const { return x * other.x + y * other.y; }
};

static double simulate(double seed) {
    const Vec2 base{seed, seed + 1};
    double total = 0;
    for (std::int32_t i = 0; i < 4096; i++) {
        const Vec2 point{static_cast<double>(i), static_cast<double>(i + 1)};
        total = total + point.dot(base);
    }
    return total;
}

double bench_run(void) {
    volatile double seed = 3;
    return simulate(seed);
}
