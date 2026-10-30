// nts-authored: the same ASCII searches through std::string_view.
#include "harness.h"
#include <cstdint>
#include <string_view>

static std::int32_t position(std::size_t value) {
  return value == std::string_view::npos ? -1 : static_cast<std::int32_t>(value);
}
static std::int32_t work(std::uint32_t state) {
  std::int32_t total = 0;
  for (unsigned i = 0; i < 1000; ++i) {
    state = state * 1664525u + 1013904223u;
    const std::string_view text = ((state >> 16) & 1u) == 0 ? "abracadabra" : "barbarian arena";
    const std::string_view needle = ((state >> 17) & 1u) == 0 ? "a" : "ra";
    total += position(text.find(needle)) + position(text.rfind(needle)) * 2
      + (text.find(needle) != std::string_view::npos ? 4 : 0)
      + (text.starts_with(needle) ? 8 : 0) + (text.ends_with(needle) ? 16 : 0);
  }
  return total;
}
double bench_run(void) {
  volatile std::uint32_t seed = 3;
  return static_cast<double>(work(seed));
}
