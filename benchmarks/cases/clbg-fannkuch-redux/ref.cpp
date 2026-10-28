/*
 * The Computer Language Benchmarks Game -- BSD-3-Clause.
 * Copyright (c) 2004-2008 Brent Fulgham, 2005-2025 Isaac Gouy.
 * All rights reserved. See ../LICENSE-benchmarks-game for the licence.
 *
 * contributed by Branimir Maksimovic
 * https://benchmarksgame-team.pages.debian.net/benchmarksgame/program/fannkuchredux-gpp-3.html
 */

// The suite's single-threaded C++ #3 program is the fair ceiling: its byte
// arrays, incremental permutation order and std::reverse are the upstream
// author's choices. It uses neither threads nor intrinsics. The leading blank
// before "Pfannkuchen" in its printf is removed to match the published output
// fixture exactly; the computation is unchanged.
#include <algorithm>
#include <cstdint>
#include <string>

#include "harness.h"

typedef unsigned char int_t;

static void rotate(int_t* p, int n) {
  int_t tmp = p[0];
  for (int i = 0; i < n; ++i) p[i] = p[i + 1];
  p[n] = tmp;
}

static bool next_permutation(int_t* beg, int n, int_t* c) {
  int i = 1;
  while (i < n) {
    rotate(beg, i);
    if (c[i] >= i) c[i++] = 0;
    else break;
  }
  if (i >= n) return false;
  ++c[i];
  return true;
}

struct Result {
  int checksum;
  int maxflips;
};

static Result fannkuch(int n) {
  Result tmp = {0};
  int i = 0, permcount = 0;
  int_t perm[16], tperm[16], cnt[16] = {0};

  std::generate(perm, perm + n, [&i]() { return ++i; });
  do {
    std::copy(perm, perm + n, tperm);
    int flips = 0;
    while (tperm[0] != 1) {
      std::reverse(tperm, tperm + tperm[0]);
      ++flips;
    }
    tmp.checksum += (permcount % 2 == 0) ? flips : -flips;
    tmp.maxflips = std::max(tmp.maxflips, flips);
  } while (++permcount, next_permutation(perm, n, cnt));
  return tmp;
}

static std::string render(int n) {
  Result r = fannkuch(n);
  return std::to_string(r.checksum) + "\nPfannkuchen(" + std::to_string(n)
      + ") = " + std::to_string(r.maxflips) + "\n";
}

double bench_run(void) {
  volatile int n = 8;
  const std::string output = render(n);
  std::uint32_t hash = 0;
  for (unsigned char byte : output) hash = hash * 31u + byte;
  return hash;
}
