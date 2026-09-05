// What a C++ programmer writes: a template, monomorphised by the compiler.
//
// This is the column that should agree with us rather than the one we are
// trying to beat -- `Box<int32_t>` and `Box<bool>` are two types with two
// layouts here for the same reason they are two classes in the emitted C. The
// objects are on the stack in both lanes; neither escapes the iteration, so
// neither reaches an allocator.
#include <cstdint>
#include "harness.h"

template <typename T>
struct Box {
    T v;
    explicit Box(T v) : v(v) {}
    T get() const { return v; }
};

static std::int32_t work(std::int32_t seed) {
    const std::int32_t step = seed;
    std::int32_t total = 0;
    for (std::int32_t i = 0; i < 4096; i++) {
        const std::int32_t size = (i ^ step) & 0xffff;
        Box<std::int32_t> counted(size);
        Box<bool> flagged((i & 1) == 0);
        total = total ^ counted.get() ^ (flagged.get() ? 1 : 0);
    }
    return total;
}

double bench_run(void) {
    volatile std::int32_t seed = 5;
    return static_cast<double>(work(seed));
}
