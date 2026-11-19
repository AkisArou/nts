#include "harness.h"
#include <algorithm>
#include <cstdint>
#include <string>
#include <vector>
static double work(int seed) {
  std::vector<std::string> xs{"ccc", "a", "bb", std::to_string(seed & 15),
                              "dd",  "e"};
  std::stable_sort(xs.begin(), xs.end(), [](const auto &a, const auto &b) {
    return a.size() < b.size();
  });
  std::uint32_t total = 0;
  for (std::size_t i = 0; i < xs.size(); ++i) {
    if (i)
      total = total * 31 + ',';
    for (unsigned char c : xs[i])
      total = total * 31 + c;
  }
  return static_cast<std::int32_t>(total);
}
double bench_run() {
  volatile int seed = 7;
  return work(seed);
}
