/*
 * The Computer Language Benchmarks Game — BSD-3-Clause.
 * Copyright (c) 2004-2008 Brent Fulgham, 2005-2025 Isaac Gouy.
 * All rights reserved. See ../LICENSE-benchmarks-game for the licence.
 *
 * Original C contributed by Sebastien Loisel; conversion to C++ by Jon Harrop.
 * https://benchmarksgame-team.pages.debian.net/benchmarksgame/program/spectralnorm-gpp-1.html
 */

// This is the Game's scalar, single-threaded C++ program and its own vectors,
// matrix calls, and accumulation order: a fair portable ceiling for this row.
// In particular the original C++ keeps accumulating v between power steps.
// Printing is replaced by the same nine-decimal output in memory.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <iomanip>
#include <locale>
#include <sstream>
#include <string>
#include <vector>

#include "harness.h"

static double eval_A(int i, int j) {
    return 1.0 / ((i + j) * (i + j + 1) / 2 + i + 1);
}

static void eval_A_times_u(const std::vector<double>& u, std::vector<double>& Au) {
    for (int i = 0; i < static_cast<int>(u.size()); i++) {
        for (int j = 0; j < static_cast<int>(u.size()); j++) {
            Au[i] += eval_A(i, j) * u[j];
        }
    }
}

static void eval_At_times_u(const std::vector<double>& u, std::vector<double>& Au) {
    for (int i = 0; i < static_cast<int>(u.size()); i++) {
        for (int j = 0; j < static_cast<int>(u.size()); j++) {
            Au[i] += eval_A(j, i) * u[j];
        }
    }
}

static void eval_AtA_times_u(const std::vector<double>& u, std::vector<double>& AtAu) {
    std::vector<double> v(u.size());
    eval_A_times_u(u, v);
    eval_At_times_u(v, AtAu);
}

static std::string render(int N) {
    std::vector<double> u(N), v(N);
    std::fill(u.begin(), u.end(), 1);
    for (int i = 0; i < 10; i++) {
        eval_AtA_times_u(u, v);
        std::fill(u.begin(), u.end(), 0);
        eval_AtA_times_u(v, u);
    }
    double vBv = 0, vv = 0;
    for (int i = 0; i < N; i++) {
        vBv += u[i] * v[i];
        vv += v[i] * v[i];
    }
    std::ostringstream output;
    output.imbue(std::locale::classic());
    output << std::fixed << std::setprecision(9) << std::sqrt(vBv / vv) << '\n';
    return output.str();
}

double bench_run(void) {
    volatile std::int32_t input = 128;
    const std::string output = render(input);
    std::uint32_t hash = 0;
    for (unsigned char byte : output) {
        hash = hash * 31u + byte;
    }
    return static_cast<double>(hash);
}
