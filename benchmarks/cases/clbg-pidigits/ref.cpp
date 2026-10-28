/*
 * The Computer Language Benchmarks Game — BSD-3-Clause.
 * Copyright (c) 2004-2008 Brent Fulgham, 2005-2025 Isaac Gouy.
 * All rights reserved. See ../LICENSE-benchmarks-game for the licence.
 *
 * Contributed by Alessandro Power.
 * https://benchmarksgame-team.pages.debian.net/benchmarksgame/program/pidigits-gpp-4.html
 */

// The fair ceiling is the Game's own single-threaded GMP C++ program, keeping
// its arbitrary-precision LFT and both extractions. There is no fixed-width
// replacement for its arithmetic. GMP is the upstream program's dependency:
// this reference requires gmpxx.h and linking with -lgmpxx -lgmp.
// The benchmark harness needs to supply those link flags; it is not changed here.
#include <gmpxx.h>
#include <cstddef>
#include <cstdint>
#include <string>

#include "harness.h"

class LFT {
public:
    mpz_class q;
    mpz_class r;
    mpz_class t;
    unsigned k;

    LFT() : q(1), r(0), t(1), k(0) {}

    void next() {
        ++k;
        r = (2 * k + 1) * (2 * q + r);
        t = (2 * k + 1) * t;
        q = q * k;
    }

    unsigned extract(unsigned x) const {
        static mpz_class tmp0, tmp1;
        tmp0 = q * x + r;
        tmp1 = tmp0 / t;
        return tmp1.get_ui();
    }

    void produce(unsigned n) {
        q = 10 * q;
        r = 10 * (r - n * t);
    }
};

static std::string render(std::size_t TOTAL_DIGITS) {
    std::string output;
    LFT lft;
    std::size_t n_digits = 0;
    while (n_digits < TOTAL_DIGITS) {
        std::size_t i = 0;
        while (i < 10 && n_digits < TOTAL_DIGITS) {
            lft.next();
            if (lft.q > lft.r) continue;

            auto digit = lft.extract(3);
            if (digit == lft.extract(4)) {
                output += std::to_string(digit);
                lft.produce(digit);
                ++i;
                ++n_digits;
            }
        }

        for (; i < 10; ++i) output += ' ';
        output += "\t:" + std::to_string(n_digits) + '\n';
    }
    return output;
}

double bench_run(void) {
    volatile std::int32_t input = 500;
    const std::string output = render(static_cast<std::size_t>(input));
    std::uint32_t hash = 0;
    for (unsigned char byte : output) {
        hash = hash * 31u + byte;
    }
    return static_cast<double>(hash);
}
