/*
 * The Computer Language Benchmarks Game — BSD-3-Clause.
 * Copyright (c) 2004-2008 Brent Fulgham, 2005-2025 Isaac Gouy.
 * All rights reserved.
 * See ../LICENSE-benchmarks-game for the licence notice and conditions.
 * Converted to C++ from D by Rafal Rusin; modified by Vaclav Haisman,
 * The Anh (to compile with g++ 4.3.2), and Branimir Maksimovic.
 * https://benchmarksgame-team.pages.debian.net/benchmarksgame/program/fasta-gpp-1.html
 *
 * This is the suite's single-threaded C++ program, retaining its float
 * arithmetic, cumulative probabilities, std::vector and count_if lookup.
 * It is the fair ceiling because these are the original C++ author's choices.
 * Only I/O becomes a string, RNG/table state is reset for repeated calls,
 * and bench_run hashes the output after reading the size through volatile.
 */
#include <algorithm>
#include <cstdint>
#include <cstring>
#include <numeric>
#include <string>
#include <vector>

#include "harness.h"

namespace ClbgFasta {
static int const IM = 139968, IA = 3877, IC = 29573;
static int last = 42;

static inline float genRandom(float max) {
    return max * (last = (last * IA + IC) % IM) / IM;
}

struct IUB {
    char c;
    float p;
};

static inline void makeCumulative(std::vector<IUB>& i) {
    std::partial_sum(i.begin(), i.end(), i.begin(),
                    [](IUB l, IUB r) -> IUB { r.p += l.p; return r; });
}

static const char alu[] =
    "GGCCGGGCGCGGTGGCTCACGCCTGTAATCCCAGCACTTTGG"
    "GAGGCCGAGGCGGGCGGATCACCTGAGGTCAGGAGTTCGAGA"
    "CCAGCCTGGCCAACATGGTGAAACCCCGTCTCTACTAAAAAT"
    "ACAAAAATTAGCCGGGCGTGGTGGCGCGCGCCTGTAATCCCA"
    "GCTACTCGGGAGGCTGAGGCAGGAGAATCGCTTGAACCCGGG"
    "AGGCGGAGGTTGCAGTGAGCCGAGATCGCGCCACTGCACTCC"
    "AGCCTGGGCGACAGAGCGAGACTCCGTCTCAAAAA";
static const unsigned length = 60;

template <class F>
static inline void make(std::string& output, char const* id,
                        char const* desc, unsigned n, F f) {
    output += ">";
    output += id;
    output += " ";
    output += desc;
    output += '\n';
    char line[length + 1] = {0};
    unsigned i = 0;
    while (n-- > 0) {
        line[i++] = f();
        if (i >= length) {
            output += line;
            output += '\n';
            i = 0;
        }
    }
    line[i] = 0;
    if (std::strlen(line)) {
        output += line;
        output += '\n';
    }
}

struct Repeat {
    explicit Repeat(const char* alu) : i(0), size(std::strlen(alu)), alu(alu) {}
    char operator()() {
        if (i >= size) i = 0;
        return alu[i++];
    }
    unsigned i, size;
    const char* alu;
};

struct Random {
    explicit Random(std::vector<IUB>& i) : i(i) {}
    char operator()() {
        float p = genRandom(1.0);
        return i[std::count_if(i.begin(), i.end(),
                              [p](IUB i) { return p >= i.p; })].c;
    }
    std::vector<IUB>& i;
};

static std::string render(unsigned n) {
    last = 42;
    std::vector<IUB> iub = {
        {'a', 0.27}, {'c', 0.12}, {'g', 0.12}, {'t', 0.27},
        {'B', 0.02}, {'D', 0.02}, {'H', 0.02}, {'K', 0.02},
        {'M', 0.02}, {'N', 0.02}, {'R', 0.02}, {'S', 0.02},
        {'V', 0.02}, {'W', 0.02}, {'Y', 0.02}
    };
    std::vector<IUB> homosapiens = {
        {'a', 0.3029549426680}, {'c', 0.1979883004921},
        {'g', 0.1975473066391}, {'t', 0.3015094502008}
    };
    makeCumulative(iub);
    makeCumulative(homosapiens);
    std::string output;
    make(output, "ONE", "Homo sapiens alu", n * 2, Repeat(alu));
    make(output, "TWO", "IUB ambiguity codes", n * 3, Random(iub));
    make(output, "THREE", "Homo sapiens frequency", n * 5, Random(homosapiens));
    return output;
}
}  // namespace ClbgFasta

double bench_run(void) {
    volatile std::uint32_t n = 10000;
    const std::string output = ClbgFasta::render(n);
    std::uint32_t hash = 0;
    for (unsigned char c : output) hash = hash * 31u + c;
    return hash;
}
