/*
 * The Computer Language Benchmarks Game — BSD-3-Clause.
 * Copyright (c) 2004-2008 Brent Fulgham, 2005-2025 Isaac Gouy.
 * All rights reserved. See ../LICENSE-benchmarks-game for the licence.
 *
 * Contributed by Elam Kolenovic.
 * https://benchmarksgame-team.pages.debian.net/benchmarksgame/program/mandelbrot-gpp-2.html
 */

// The fair ceiling is the Game's own single-threaded, portable eight-pixel
// C++ program. Its arithmetic and arrays stay intact, without vector intrinsics.
// stdout is collected in memory. For partial rows, emit the final byte (the
// original writes width/8) and clear its padding, as the PBM format requires.
#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "harness.h"

static std::string render(int n) {
    typedef unsigned char Byte;
    const std::size_t N = static_cast<std::size_t>(std::max(0, n));
    const std::size_t width = N;
    const std::size_t height = N;
    const std::size_t maxX = (width + 7) / 8;
    const std::size_t maxIterations = 50;
    const double limit = 2.0;
    const double limitSq = limit * limit;

    std::vector<Byte> data(height * maxX);
    for (std::size_t y = 0; y < height; ++y) {
        const double ci0 = 2.0 * y / height - 1.0;
        Byte* line = &data[y * maxX];
        for (std::size_t x = 0; x < maxX; ++x) {
            double cr0[8];
            for (std::size_t k = 0; k < 8; ++k) {
                cr0[k] = 2.0 * (8 * x + k) / width - 1.5;
            }

            double cr[8];
            std::copy(cr0, cr0 + 8, &cr[0]);
            double ci[8];
            std::fill(ci, ci + 8, ci0);

            Byte bits = 0;
            for (std::size_t i = 0; i < maxIterations && bits != 0xFF; ++i) {
                double cr2[8];
                double ci2[8];
                double crci[8];
                for (std::size_t k = 0; k < 8; ++k) {
                    const Byte mask = (1 << (7 - k));
                    if ((bits & mask) == 0) {
                        cr2[k] = cr[k] * cr[k];
                        ci2[k] = ci[k] * ci[k];
                        crci[k] = cr[k] * ci[k];

                        cr[k] = cr2[k] - ci2[k] + cr0[k];
                        ci[k] = 2.0 * crci[k] + ci0;

                        if (cr2[k] + ci2[k] > limitSq) {
                            bits |= mask;
                        }
                    }
                }
            }
            line[x] = static_cast<Byte>(~bits);
        }
        if (width % 8 != 0) {
            line[maxX - 1] &= static_cast<Byte>(0xff << (8 - width % 8));
        }
    }

    std::string output = "P4\n" + std::to_string(width) + " " +
                         std::to_string(height) + "\n";
    for (std::size_t y = 0; y < height; ++y) {
        const Byte* line = &data[y * maxX];
        for (std::size_t x = 0; x < maxX; ++x) {
            output += static_cast<char>(line[x]);
        }
    }
    return output;
}

double bench_run(void) {
    volatile std::int32_t input = 256;
    const std::string output = render(input);
    std::uint32_t hash = 0;
    for (unsigned char byte : output) {
        hash = hash * 31u + byte;
    }
    return static_cast<double>(hash);
}
