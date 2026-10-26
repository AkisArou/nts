// C++ state is a value. The array deliberately copies before appending, the
// semantics requested by [...xs, v]; ordinary push_back would answer another
// row.
#include "harness.h"
#include <cstdint>
#include <utility>
#include <vector>
struct State {
  std::int32_t k, a, b, c;
};
static double work(int n) {
  n = (n & 3) + 1;
  std::uint32_t total = 0;
  for (int batch = 0; batch < 4 * n; ++batch) {
    State state{batch, 7, 11, 13};
    std::vector<std::int32_t> xs;
    for (int i = 0; i < 256; ++i) {
      State next = state;
      next.k = state.k + i + 1;
      state = next;
      auto copied = xs;
      copied.push_back(state.k);
      xs = std::move(copied);
      total += state.a + state.b + state.c + xs[(i * 17) % xs.size()];
    }
    total += xs.size() + state.k;
  }
  return static_cast<std::int32_t>(total);
}
double bench_run() {
  volatile int seed = 0;
  return work(seed);
}
