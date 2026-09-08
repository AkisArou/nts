// What a C++ programmer writes when the function value itself is chosen at
// runtime, which is `std::function` and not a template.
//
// `closures/ref.cpp` uses a template on purpose -- it monomorphizes, so the
// call is direct and inlined, "the best any language can do with this shape".
// That is unavailable here by construction: the two arms are different lambdas
// with different types, and a template would instantiate twice and leave two
// direct calls, which is a different program. The whole point of the row is a
// single call site that sees both.
//
// So the reference is type-erased, and the note matters because it decides what
// a loss means. `std::function` over a one-`int` capture fits libstdc++'s small
// buffer, so there is no allocation, but the call is an indirect through a
// stored pointer with no speculation. C2 and V8 both *do* speculate on a
// bimorphic site -- two guarded direct calls, and a two-entry inline cache --
// so this is one of the few rows where the managed lanes have a mechanism the
// native one does not. If C++ wins here it wins on call overhead; if it loses,
// it loses to speculation, and either way the number says which.
//
// A C++ programmer might instead branch and call each lambda directly. That is
// a faster program and a different one: it never forms the merged value, which
// is the thing being measured.
#include <cstdint>
#include <functional>
#include "harness.h"

static std::int32_t drive(const std::function<std::int32_t(std::int32_t)> &f,
                          std::int32_t times) {
    std::int32_t total = 0;
    for (std::int32_t i = 0; i < times; i++) {
        total = total ^ f(i);
    }
    return total;
}

static std::int32_t work(std::int32_t seed) {
    const std::int32_t step = seed;
    std::int32_t total = 0;
    for (std::int32_t round = 0; round < 8; round++) {
        std::function<std::int32_t(std::int32_t)> mix;
        if ((round & 1) == 0) {
            mix = [step](std::int32_t x) {
                const std::uint32_t ux = static_cast<std::uint32_t>(x);
                return static_cast<std::int32_t>(
                    (ux * 2654435761u ^ (ux >> 3)) + static_cast<std::uint32_t>(step));
            };
        } else {
            mix = [step](std::int32_t x) {
                const std::uint32_t ux = static_cast<std::uint32_t>(x);
                return static_cast<std::int32_t>(
                    (ux * 40503u ^ (ux >> 5)) - static_cast<std::uint32_t>(step));
            };
        }
        for (std::int32_t i = 0; i < 512; i++) {
            total = total ^ mix(i);
        }
        total = static_cast<std::int32_t>(static_cast<std::uint32_t>(total) +
                                          static_cast<std::uint32_t>(drive(mix, 512)));
    }
    return total;
}

double bench_run(void) {
    volatile std::int32_t seed = 5;
    return static_cast<double>(work(seed));
}
