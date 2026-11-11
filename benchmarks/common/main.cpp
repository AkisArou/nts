// Times bench_run() and prints "<ns per op> <checksum>".
//
// The checksum is not decoration. The runner compares it across variants, so a
// backend that is fast because it computes the wrong thing fails the benchmark
// rather than winning it.
//
// It is printed as the value's **sixty-four bits**, and that is load-bearing
// rather than fussy. `%.17g` and JavaScript's shortest round-trip disagree on
// ordinary values -- `0.1` is `0.10000000000000001` here and `0.1` there -- and
// the runner compares checksums as *strings*, so the first case to return one
// would report a disagreement no lane caused. Nothing has, because every
// checksum so far happens to be integral. Java's `Double.toString` disagrees
// with both (`1.437497244444425E7`), so a third lane makes it certain rather
// than likely.
//
// This is the convention `nts/rt/Check` already uses in the differential, for
// the reason written there: a harness that lost a bit in transit would report a
// disagreement it caused itself.
//
// Counting mode (tooling/bench/README.md is the spec) is selected by
// NTS_BENCH_COUNT_MODE, spelled exactly as bench.mjs spells it: calibrate
// picks a fixed repetition count, count warms that same loop and runs it
// inside perf's enable/disable bracket. The timed path below is the original
// code shape on purpose; counting branches before it and changes none of it.
#include "harness.h"
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>

static double now_ns(void) {
  const auto now = std::chrono::steady_clock::now().time_since_epoch();
  return static_cast<double>(
      std::chrono::duration_cast<std::chrono::nanoseconds>(now).count());
}

static std::uint64_t bits_of(double value) {
  std::uint64_t bits;
  std::memcpy(&bits, &value, sizeof bits);
  return bits;
}

static long long count_env(const char *name) {
  const char *text = std::getenv(name);
  if (text == nullptr || *text == '\0') return -1;
  char *end = nullptr;
  const long long value = std::strtoll(text, &end, 10);
  return end != text && *end == '\0' ? value : -1;
}

static double run_loop(long long reps) {
  double sink = 0;
  for (long long i = 0; i < reps; i++) {
    sink += bench_run();
  }
  return sink;
}

static void perf_command(std::FILE *control, std::FILE *acknowledgement,
                         const char *value) {
  std::fprintf(control, "%s\n", value);
  std::fflush(control);
  char message[8] = {};
  std::size_t length = 0;
  for (;;) {
    const int next = std::fgetc(acknowledgement);
    if (next == EOF) {
      std::fprintf(stderr, "perf control acknowledgement missing\n");
      std::exit(1);
    }
    if (next == '\0') continue; // perf appends a NUL after ack\n
    if (length + 1 < sizeof message) message[length++] = static_cast<char>(next);
    if (next == '\n') break;
  }
  if (std::strcmp(message, "ack\n") != 0) {
    std::fprintf(stderr, "unexpected perf acknowledgement: %s", message);
    std::exit(1);
  }
}

static int calibrate(double checksum) {
  // The timed path's warmup bounds: 20,000 calls or 300 ms.
  const double until = now_ns() + 300'000'000.0;
  long long warmed = 0;
  while (warmed < 20000 && now_ns() < until) {
    bench_run();
    warmed++;
  }
  long long reps = 1;
  double elapsed = 0;
  double sink = 0;
  for (;;) {
    const double start = now_ns();
    sink += run_loop(reps);
    elapsed = now_ns() - start;
    if (elapsed >= 20'000'000.0 || reps >= 50'000'000LL) break;
    reps = reps * 2 < 50'000'000LL ? reps * 2 : 50'000'000LL;
  }
  if (sink != sink) {
    std::fprintf(stderr, "unreachable\n");
    return 1;
  }
  std::fprintf(stderr, "NTS_BENCH_SINK %016llx\n",
               static_cast<unsigned long long>(bits_of(sink)));
  std::printf("{\"checksum\":\"%016llx\",\"warmup\":%lld,\"nsPerOp\":%.17g,\"reps\":%lld}\n",
              static_cast<unsigned long long>(bits_of(checksum)), warmed,
              elapsed / static_cast<double>(reps), reps);
  return 0;
}

static int count(double checksum) {
  const long long n = count_env("NTS_BENCH_COUNT_N");
  const long long warmed = count_env("NTS_BENCH_COUNT_WARMUP");
  if (n < 1 || warmed < 0) {
    std::fprintf(stderr, "fixed counts are required: NTS_BENCH_COUNT_N and NTS_BENCH_COUNT_WARMUP\n");
    return 1;
  }
  // Warm up the loop being counted, outside the bracket.
  run_loop(warmed);
  std::FILE *const control = std::fopen(std::getenv("NTS_BENCH_COUNT_CONTROL"), "w");
  std::FILE *const acknowledgement = std::fopen(std::getenv("NTS_BENCH_COUNT_ACK"), "r");
  if (control == nullptr || acknowledgement == nullptr) {
    std::fprintf(stderr, "perf control acknowledgement missing\n");
    return 1;
  }
  perf_command(control, acknowledgement, "enable");
  const double start = now_ns();
  const double sink = run_loop(n);
  const double elapsed = now_ns() - start;
  perf_command(control, acknowledgement, "disable");
  std::fclose(control);
  std::fclose(acknowledgement);
  if (sink != sink) {
    std::fprintf(stderr, "unreachable\n");
    return 1;
  }
  std::printf("{\"checksum\":\"%016llx\",\"warmup\":%lld,\"n\":%lld,\"elapsedNs\":%.17g,\"nsPerOp\":%.17g,\"sink\":%.17g}\n",
              static_cast<unsigned long long>(bits_of(checksum)), warmed, n,
              elapsed, elapsed / static_cast<double>(n), sink);
  return 0;
}

int main(void) {
  const char *const mode = std::getenv("NTS_BENCH_COUNT_MODE");
  if (mode != nullptr) {
    const double checksum = bench_run();
    if (std::strcmp(mode, "calibrate") == 0) return calibrate(checksum);
    if (std::strcmp(mode, "count") == 0) return count(checksum);
    std::fprintf(stderr, "unknown NTS_BENCH_COUNT_MODE: %s\n", mode);
    return 1;
  }

  // Warm up, and take the value the runner will compare.
  double checksum = bench_run();

  // Calibrate to roughly 100ms of work, so a fast case is not measured by
  // clock granularity and a slow one does not take all day.
  double start = now_ns();
  volatile double sink = bench_run();
  double one = now_ns() - start;
  long reps = static_cast<long>(1e8 / (one > 1.0 ? one : 1.0));
  if (reps < 1) {
    reps = 1;
  }
  if (reps > 50000000) {
    reps = 50000000;
  }

  // Best of five. The minimum is the run least contaminated by the scheduler:
  // the mean measures the machine's other tenants as much as the code.
  double best = 1e30;
  for (int trial = 0; trial < 5; trial++) {
    double began = now_ns();
    for (long i = 0; i < reps; i++) {
      sink += bench_run();
    }
    double per = (now_ns() - began) / static_cast<double>(reps);
    if (per < best) {
      best = per;
    }
  }

  static_cast<void>(sink);
  std::uint64_t bits;
  std::memcpy(&bits, &checksum, sizeof bits);
  printf("%.4f %016llx\n", best, static_cast<unsigned long long>(bits));
  return 0;
}
