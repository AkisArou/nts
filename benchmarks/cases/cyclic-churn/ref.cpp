// C++ expresses parent ownership explicitly: an owning child and a borrowed
// parent pointer. The observable graph is the same; this reference has no cycle
// collector. shared_ptr on both edges would leak and would not be a reference.
#include "harness.h"
#include <cstdint>
#include <memory>
struct Link {
  std::int32_t value;
  Link *parent = nullptr;
  std::unique_ptr<Link> child;
  explicit Link(std::int32_t value) : value(value) {}
};
static double work(int n) {
  n = (n & 3) + 1;
  std::uint32_t total = 0;
  for (int i = 0; i < 2048 * n; ++i) {
    auto parent = std::make_unique<Link>(i);
    parent->child = std::make_unique<Link>(i + 1);
    parent->child->parent = parent.get();
    total += parent->child->value + parent->child->parent->value;
  }
  return static_cast<std::int32_t>(total);
}
double bench_run() {
  volatile int seed = 0;
  return work(seed);
}
