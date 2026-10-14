// What a C++ programmer writes for exactly this: `__int128`, which is what nts
// compiles a `bigint` to. So this column is a floor rather than a target -- the
// same arithmetic with no language in the way.
//
// It is *not* what node does. Node's `BigInt` is arbitrary precision and
// allocates, which is the comparison this row exists to make.
#include <cstdint>
#include "harness.h"

static std::int32_t mix(std::int32_t seed) {
    const __int128 modulus = 1000000007;
    __int128 a = 1;
    __int128 b = 998244353;
    const std::int32_t rounds = 61 + seed;
    for (std::int32_t round = 0; round < rounds; round++) {
        a = (a * b + 12345) % modulus;
        b = (b ^ (a << 3)) & (__int128)0xffffffffffffLL;
        a = a + (b >> 5);
    }
    return static_cast<std::int32_t>((a ^ b) & 0xffff);
}

double bench_run(void) {
    volatile std::int32_t seed = 3;
    return static_cast<double>(mix(seed));
}
