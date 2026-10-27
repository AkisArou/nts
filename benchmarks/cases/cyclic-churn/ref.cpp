// C++ expresses parent ownership explicitly: an owning child and a borrowed
// parent pointer. The observable graph is the same; this reference has no cycle
// collector. shared_ptr on both edges would leak and would not be a reference.
#include "harness.h"
#include <array>
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
  std::array<std::unique_ptr<Link>, 64> ring;
  for (int i = 0; i < 2048 * n; ++i) {
    const int slot = i & 63;
    if (i >= 64) {
      const auto &old = ring[slot];
      total += old->child->value + old->child->parent->value;
    }
    auto parent = std::make_unique<Link>(i);
    parent->child = std::make_unique<Link>(i + 1);
    parent->child->parent = parent.get();
    ring[slot] = std::move(parent);
  }
  for (const auto &parent : ring) {
    total += parent->child->value + parent->child->parent->value;
  }
  return static_cast<std::int32_t>(total);
}
double bench_run() {
  volatile int seed = 0;
  return work(seed);
}
