// Sort pointers to objects, preserving object identity and stable ordering.
// Fields are integral in the TS source (explicit |0); no value-object shortcut.
#include "harness.h"
#include <algorithm>
#include <cstdint>
#include <memory>
#include <vector>
struct Item {
  std::int32_t key, tag;
};
static double work(int n) {
  n = (n & 3) + 1;
  std::uint32_t total = 0;
  for (int batch = 0; batch < n; ++batch) {
    std::vector<std::unique_ptr<Item>> xs;
    for (int i = 0; i < 256; ++i)
      xs.push_back(
          std::make_unique<Item>(Item{(i * 73 + batch * 11) % 257, i}));
    for (int round = 0; round < 16; ++round) {
      std::reverse(xs.begin(), xs.end());
      std::stable_sort(xs.begin(), xs.end(), [](const auto &a, const auto &b) {
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
