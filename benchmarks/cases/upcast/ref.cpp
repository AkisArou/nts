// What a C++ programmer writes: a base with a pure virtual, and a pointer.
//
// The objects are on the stack and the pointer is to one of them, which is what
// nts does too -- neither of them escapes the iteration, so neither reaches an
// allocator. Putting them on the heap here would measure `new` rather than
// dispatch, and would measure it in only one of the two lanes.
#include <cstdint>
#include "harness.h"

struct Shape {
    virtual std::int32_t area() const = 0;
    std::int32_t describe() const { return area() * 2; }
};

struct Circle : Shape {
    std::int32_t r;
    explicit Circle(std::int32_t r) : r(r) {}
    std::int32_t area() const override { return r * 3; }
};

struct Square : Shape {
    std::int32_t s;
    explicit Square(std::int32_t s) : s(s) {}
    std::int32_t area() const override { return s * 5; }
};

struct Tri : Shape {
    std::int32_t t;
    explicit Tri(std::int32_t t) : t(t) {}
    std::int32_t area() const override { return t * 7; }
};

static std::int32_t work(std::int32_t seed) {
    const std::int32_t step = seed;
    std::int32_t total = 0;
    for (std::int32_t i = 0; i < 4096; i++) {
        const std::int32_t which = i & 3;
        const std::int32_t size = (i ^ step) & 0xffff;
        Circle circle(size);
        Square square(size);
        Tri tri(size);
        const Shape *shape = which == 0   ? static_cast<const Shape *>(&circle)
                             : which == 1 ? static_cast<const Shape *>(&square)
                                          : static_cast<const Shape *>(&tri);
        total = total ^ shape->describe();
    }
    return total;
}

double bench_run(void) {
    volatile std::int32_t seed = 5;
    return static_cast<double>(work(seed));
}
