// A C++ tree owns its children. unique_ptr destruction frees one node at a
// time, just as native RC does; construction and the checksum walk are timed.
#include "harness.h"
#include <cstdint>
#include <memory>
struct Tree {
  std::int32_t value;
  std::unique_ptr<Tree> left, right;
};
static std::unique_ptr<Tree> build(int depth, std::int32_t value) {
  auto tree = std::make_unique<Tree>();
  tree->value = value;
  if (depth != 0) {
    tree->left = build(depth - 1, value + 1);
    tree->right = build(depth - 1, value + 3);
  }
  return tree;
}
static std::int32_t sum(const Tree &tree) {
  auto total = tree.value;
  if (tree.left)
    total += sum(*tree.left);
  if (tree.right)
    total += sum(*tree.right);
  return total;
}
static double work(int n) {
  n = (n & 3) + 1;
  std::uint32_t total = 0;
  for (int round = 0; round < 16 * n; ++round) {
    auto root = build(8, round);
    total += sum(*root);
  }
  return static_cast<std::int32_t>(total);
}
double bench_run() {
  volatile int seed = 0;
  return work(seed);
}
