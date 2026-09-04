// A custom iterator behind a range-`for`, which is what a C++ programmer writes
// for "walk this thing's own sequence".
//
// Unsigned for the wrapping, as `accumulate`'s reference is: JavaScript's
// bitwise operators are defined modulo 2^32 and signed overflow is undefined in
// C++, so the wrapping is the semantics rather than an accident.
//
// The bound is a parameter and the `volatile` sits at the call site, which is
// the convention the rest of this suite uses and the structure `nts.cpp` has.
#include <cstdint>
#include "harness.h"

namespace {

struct Cursor {
    std::int64_t at;
    std::uint32_t seed;

    std::uint32_t operator*() const { return seed & 255u; }

    Cursor &operator++() {
        at -= 1;
        seed = seed * 31u + static_cast<std::uint32_t>(at);
        return *this;
    }

    bool operator!=(const Cursor &) const { return at >= 0; }
};

struct Series {
    std::int64_t from;
    Cursor begin() const {
        Cursor c{from, 1u};
        ++c;
        return c;
    }
    Cursor end() const { return Cursor{0, 0u}; }
};

}  // namespace

static double run_loop(std::int64_t rounds) {
    std::uint32_t total = 0;
    for (std::uint32_t v : Series{rounds}) {
        total = total + v;
    }
    return static_cast<double>(static_cast<std::int32_t>(total));
}

double bench_run(void) {
    volatile std::int64_t rounds = 100000;
    return run_loop(rounds);
}
