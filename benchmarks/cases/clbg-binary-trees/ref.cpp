/*
 * The Computer Language Benchmarks Game -- BSD-3-Clause.
 * Copyright (c) 2004-2008 Brent Fulgham, 2005-2025 Isaac Gouy.
 * All rights reserved. See ../LICENSE-benchmarks-game for the licence.
 *
 * Contributed by Jon Harrop
 * Modified by Alex Mizrahi
 * *reset*
 * https://benchmarksgame-team.pages.debian.net/benchmarksgame/program/binarytrees-gpp-2.html
 */

// This is the suite's single-threaded C++ #2 program: one allocation per
// node, the original recursive check, and recursive deletion. It is a fair
// ceiling because these are the upstream C++ author's choices, with no arena,
// threads, intrinsics or replacement algorithm. Only input/output is adapted.
#include <algorithm>
#include <cstdint>
#include <sstream>
#include <string>

#include "harness.h"

struct Node {
  Node *l, *r;
  Node() : l(0), r(0) {}
  Node(Node *l2, Node *r2) : l(l2), r(r2) {}
  ~Node() { delete l; delete r; }
  int check() const {
    if (l)
      return l->check() + 1 + r->check();
    else return 1;
  }
};

static Node *make(int d) {
  if (d == 0) return new Node();
  return new Node(make(d - 1), make(d - 1));
}

static std::string render(int n) {
  int min_depth = 4,
      max_depth = std::max(min_depth + 2, n),
      stretch_depth = max_depth + 1;
  std::ostringstream output;
  {
    Node *c = make(stretch_depth);
    output << "stretch tree of depth " << stretch_depth << "\t "
           << "check: " << c->check() << '\n';
    delete c;
  }

  Node *long_lived_tree = make(max_depth);
  for (int d = min_depth; d <= max_depth; d += 2) {
    int iterations = 1 << (max_depth - d + min_depth), c = 0;
    for (int i = 1; i <= iterations; ++i) {
      Node *a = make(d);
      c += a->check();
      delete a;
    }
    output << iterations << "\t trees of depth " << d << "\t "
           << "check: " << c << '\n';
  }
  output << "long lived tree of depth " << max_depth << "\t "
         << "check: " << long_lived_tree->check() << '\n';
  delete long_lived_tree;
  return output.str();
}

double bench_run(void) {
  volatile int n = 12;
  const std::string output = render(n);
  std::uint32_t hash = 0;
  for (unsigned char byte : output) hash = hash * 31u + byte;
  return hash;
}
