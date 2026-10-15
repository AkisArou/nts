// What a C++ programmer writes for one shape three types have: a base of pure
// virtual accessors, and a pointer.
//
// The objects are on the stack, as in `upcast`: none escapes the call, so
// putting them on the heap would measure `new` in one lane only.
#include <cstdint>
#include "harness.h"

struct Point {
    virtual std::int32_t x() const = 0;
    virtual void x(std::int32_t value) = 0;
    virtual std::int32_t y() const = 0;
};

struct Flat : Point {
    std::int32_t x_, y_, z_ = 0;
    Flat(std::int32_t x, std::int32_t y) : x_(x), y_(y) {}
    std::int32_t x() const override { return x_; }
    void x(std::int32_t value) override { x_ = value; }
    std::int32_t y() const override { return y_; }
};

struct Swapped : Point {
    std::int32_t tag_ = 1, y_, x_;
    Swapped(std::int32_t x, std::int32_t y) : y_(y), x_(x) {}
    std::int32_t x() const override { return x_; }
    void x(std::int32_t value) override { x_ = value; }
    std::int32_t y() const override { return y_; }
};

struct Literal : Point {
    std::int32_t x_, y_;
    Literal(std::int32_t x, std::int32_t y) : x_(x), y_(y) {}
    std::int32_t x() const override { return x_; }
    void x(std::int32_t value) override { x_ = value; }
    std::int32_t y() const override { return y_; }
};

static std::int32_t weigh(const Point *p) { return p->x() * 3 + p->y(); }

static std::int32_t work(std::int32_t seed) {
    const std::int32_t step = seed;
    Flat flat(step, 1);
    Swapped swapped(2, step);
    Literal literal(3, step);
    Point *points[3] = {&flat, &swapped, &literal};
    std::int32_t total = 0;
    for (std::int32_t i = 0; i < 4096; i++) {
        Point *p = points[i % 3];
        p->x((p->x() + i) & 0xffff);
        total = total ^ weigh(p);
    }
    return total;
}

double bench_run(void) {
    volatile std::int32_t seed = 5;
    return static_cast<double>(work(seed));
}
