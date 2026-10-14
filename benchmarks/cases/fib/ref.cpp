// Native integers, which is what a C++ programmer writes for `fib`.
//
// This is a harder ceiling than it looks, and deliberately so. `fib(93)`
// overflows `int64_t` while the double version does not, so nts cannot choose
// this representation from the type `number` alone -- the C++ programmer is
// using information about the input that the type does not carry. The gap this
// row shows is real and is not going to close by trying harder at the same
// problem; it closes when a caller's argument range reaches the callee, which
// is what the interprocedural analysis is for.
#include <cstdint>
#include "harness.h"

static std::int64_t fib(std::int64_t n) {
    if (n < 2) {
        return n;
    }
    return fib(n - 1) + fib(n - 2);
}

double bench_run(void) {
    volatile std::int64_t n = 27;
    return static_cast<double>(fib(n));
}
