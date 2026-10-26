// The same three allocations per entry, with a nonrecursive ownership type.
#include "harness.h"
#include <cstdint>
#include <memory>
#include <vector>
struct Leaf {
  std::int32_t value;
};
struct Pair {
  std::unique_ptr<Leaf> left, right;
};
static double work(int n) {
  n = (n & 3) + 1;
  std::uint32_t total = 0;
  for (int batch = 0; batch < 16 * n; ++batch) {
    std::vector<std::unique_ptr<Pair>> xs;
    for (int i = 0; i < 256; ++i)
      xs.push_back(std::make_unique<Pair>(
          Pair{std::make_unique<Leaf>(Leaf{batch + i}),
               std::make_unique<Leaf>(Leaf{batch - i})}));
    for (const auto &pair : xs)
      total += pair->left->value + pair->right->value;
  }
  return static_cast<std::int32_t>(total);
}
double bench_run() {
  volatile int seed = 0;
  return work(seed);
}
