// Same seeded rotations, same reference identity, stable sorting.
#include "harness.h"
#include <algorithm>
#include <cstdint>
#include <memory>
#include <vector>
struct Item {
  std::int32_t key, tag;
};
static double work(int seed) {
  const int n = (seed & 3) + 1;
  int offset = seed & 255;
  std::uint32_t total = 0;
  for (int batch = 0; batch < n; ++batch) {
    std::vector<std::unique_ptr<Item>> ordered;
    for (int i = 0; i < 256; ++i)
      ordered.push_back(std::make_unique<Item>(Item{i, i}));
    for (int round = 0; round < 16; ++round) {
      offset = (offset + 73) & 255;
      std::vector<Item *> xs;
      for (int i = 0; i < 256; ++i)
        xs.push_back(ordered[(i + offset) & 255].get());
      std::stable_sort(xs.begin(), xs.end(), [](const Item *a, const Item *b) {
        return a->key < b->key || (a->key == b->key && a->tag < b->tag);
      });
      for (int i = 0; i < static_cast<int>(xs.size()); ++i)
        total += (i + 1) * xs[i]->tag + xs[i]->key;
    }
  }
  return static_cast<std::int32_t>(total);
}
double bench_run() {
  volatile int seed = 0;
  return work(seed);
}
