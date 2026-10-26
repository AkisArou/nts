// New vectors for each copying API; sort/reverse never mutate the old vector.
#include "harness.h"
#include <algorithm>
#include <cstdint>
#include <utility>
#include <vector>
static double work(int n) {
  n = (n & 3) + 1;
  std::uint32_t total = 0;
  for (int batch = 0; batch < n; ++batch) {
    std::vector<std::int32_t> xs;
    for (int i = 0; i < 64; ++i)
      xs.push_back((i * 37 + batch) & 1023);
    for (int round = 0; round < 32; ++round) {
      auto sorted = xs;
      std::stable_sort(sorted.begin(), sorted.end());
      xs = std::move(sorted);
      auto reversed = xs;
      std::reverse(reversed.begin(), reversed.end());
      xs = std::move(reversed);
      auto replaced = xs;
      replaced[round % xs.size()] = round + batch;
      xs = std::move(replaced);
      std::vector<std::int32_t> mapped;
      for (auto x : xs)
        mapped.push_back((x + 17) & 1023);
      xs = std::move(mapped);
      std::vector<std::int32_t> filtered;
      for (auto x : xs)
        if (((x + round) & 3) != 0)
          filtered.push_back(x);
      xs = std::move(filtered);
      while (xs.size() < 64)
        xs.push_back((batch + round + xs.size() * 13) & 1023);
      for (auto x : xs)
        total += x;
    }
  }
  return static_cast<std::int32_t>(total);
}
double bench_run() {
  volatile int seed = 0;
  return work(seed);
}
