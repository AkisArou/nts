#include "nts/binding_benchmark.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <memory>
#include <string>

#include "base/check.h"
#include "base/containers/span.h"
#include "base/json/json_writer.h"
#include "base/memory/raw_ptr.h"
#include "base/time/time.h"
#include "base/values.h"
#include "third_party/blink/renderer/core/dom/document.h"
#include "third_party/blink/renderer/core/dom/element.h"
#include "third_party/blink/renderer/core/dom/text.h"
#include "third_party/blink/renderer/platform/heap/persistent.h"
#include "third_party/blink/renderer/platform/wtf/text/atomic_string.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"
#include "third_party/blink/renderer/platform/wtf/vector.h"

namespace nts_chromium {
namespace {
// Each row is one architecture variant writing the same attached Text node.
// `mode` selects ntsChromiumBenchmarkLoop's loop; kIntrinsic is the C++
// control with prebuilt Blink strings and no binding or conversion at all.
constexpr uint32_t kIntrinsic = 100;
struct Row {
  const char* name;
  uint32_t mode;
};
// One-byte payloads: what most UI text is, and what Blink stores 8-bit.
constexpr std::array<Row, 6> kLatin1Rows{{
    {"blink-intrinsic", kIntrinsic},
    {"compiled-entered-prepared-utf16", 0},
    {"compiled-entered-prepared-latin1", 1},
    {"compiled-entered-string", 2},
    {"compiled-entered-fresh-string", 3},
    {"compiled-entered-atom", 4},
}};
// Two-byte payloads: the string crosses as a view at its own width, so these
// rows match the Latin-1 ones except that the copy is twice the bytes.
constexpr std::array<Row, 5> kWideRows{{
    {"blink-intrinsic", kIntrinsic},
    {"compiled-entered-prepared-utf16", 0},
    {"compiled-entered-string", 2},
    {"compiled-entered-fresh-string", 3},
    {"compiled-entered-atom", 4},
}};
// Interned text (mode 4) is the native counterpart of V8's repeated strings.
// The entry matrix: the prepared UTF-16 write, a fresh native entry around
// every few operations.
constexpr std::array<Row, 1> kEntryRows{{
    {"entered", 0},
}};

struct Intrinsic {
  blink::Persistent<blink::Text> text;
  blink::String a;
  blink::String b;
  uint32_t iterations;
};
void RunIntrinsic(void* state) {
  auto& loop = *static_cast<Intrinsic*>(state);
  for (uint32_t i = 0; i < loop.iterations; ++i)
    loop.text->setTextContent(i % 2 ? loop.b : loop.a);
}

uint32_t Calibrated(uint32_t iterations, double elapsed_ns) {
  const double desired = 16e6 * iterations / std::max(elapsed_ns, 1.0);
  return static_cast<uint32_t>(
      std::clamp(std::ceil(desired / 2) * 2, 32.0, 100000.0));
}
}  // namespace

std::string RunBindingBenchmark(const blink::WebDocument& web_document,
                                NtsDomContext* context,
                                NtsChromiumProbe* probe,
                                uint32_t order) {
  CHECK_LT(order, 3u);
  auto* document = static_cast<blink::Document*>(web_document);
  auto* output =
      document->getElementById(blink::AtomicString("benchmark-text"));
  CHECK(output);
  // The same attached Text node is used by every path; setup is untimed. The
  // DOM keeps it; the compiled loop is handed its address, as the DOM ABI
  // passes a node.
  auto* text = document->createTextNode("");
  output->appendChild(text);
  auto* node = reinterpret_cast<NtsDomNode*>(static_cast<blink::Node*>(text));
  base::ListValue samples;
  base::ListValue entry_samples;
  constexpr std::array<uint32_t, 3> lengths{16, 256, 4096};
  // Latin-1 first, so both fixtures finish on the same wide payload.
  for (const bool wide : {false, true}) {
    const base::span<const Row> rows =
        wide ? base::span<const Row>(kWideRows) : base::span<const Row>(kLatin1Rows);
    const char* payload = wide ? "wide" : "latin1";
    for (uint32_t position = 0; position < lengths.size(); ++position) {
      const uint32_t length = lengths[(position + order) % lengths.size()];
      // "x...A" / "x...B", led by U+0100 when wide to force two-byte storage.
      const std::string lead = wide ? "\xc4\x80" : "x";
      std::string first = lead + std::string(length - 2, 'x') + "A";
      std::string second = lead + std::string(length - 2, 'x') + "B";
      auto compiled =
          std::unique_ptr<NtsChromiumBenchmark,
                          decltype(&nts_chromium_benchmark_destroy)>(
              nts_chromium_benchmark_create(probe, context, node, first.data(),
                                            second.data(), first.size()),
              &nts_chromium_benchmark_destroy);
      const blink::String a = blink::String::FromUtf8(first);
      const blink::String b = blink::String::FromUtf8(second);
      CHECK_EQ(a.length(), length);
      std::array<uint32_t, 7> counts;
      counts.fill(16384);
      // One calibrating warm-up round, then seven with rotating row order.
      for (uint32_t round = 0; round < 8; ++round) {
        for (uint32_t offset = 0; offset < rows.size(); ++offset) {
          const uint32_t index = (offset + round) % rows.size();
          const Row& row = rows[index];
          const uint32_t iterations = counts[index];
          NtsChromiumBenchmarkStats stats{};
          const auto start = base::TimeTicks::Now();
          if (row.mode == kIntrinsic) {
            Intrinsic loop{blink::Persistent<blink::Text>(text), a, b,
                           iterations};
            CHECK_EQ(nts_blink_dom_entry(context, RunIntrinsic, &loop), 0);
          } else {
            stats = nts_chromium_benchmark_run(compiled.get(), iterations,
                                               row.mode);
          }
          const double elapsed_ns =
              (base::TimeTicks::Now() - start).InMicrosecondsF() * 1000;
          CHECK_EQ(text->data(), b) << row.name;
          if (!round) {
            counts[index] = Calibrated(iterations, elapsed_ns);
            continue;
          }
          base::DictValue sample;
          sample.Set("payload", payload);
          sample.Set("path", row.name);
          sample.Set("round", static_cast<int>(round));
          sample.Set("length", static_cast<int>(length));
          sample.Set("iterations", static_cast<int>(iterations));
          sample.Set("elapsedNs", elapsed_ns);
          sample.Set("nsPerOperation", elapsed_ns / iterations);
          if (row.mode != kIntrinsic) {
            sample.Set("ntsAllocations", static_cast<double>(stats.allocations));
            sample.Set("ntsRetains", static_cast<double>(stats.retains));
            sample.Set("ntsReleases", static_cast<double>(stats.releases));
            sample.Set("ntsLiveObjects", static_cast<double>(stats.live_objects));
          }
          samples.Append(std::move(sample));
        }
      }
      // Short callbacks expose what entering costs and where it pays off.
      // Zero operations is the bare entry; nonempty entries end on B.
      if (wide || length != 16)
        continue;
      for (const uint32_t operations : {0u, 2u, 8u, 32u}) {
        const uint32_t warm = std::max(32u, 16384u / std::max(operations, 1u));
        std::array<uint32_t, kEntryRows.size()> entry_counts;
        entry_counts.fill(warm);
        for (uint32_t round = 0; round < 8; ++round) {
          for (uint32_t offset = 0; offset < kEntryRows.size(); ++offset) {
            const uint32_t index = (offset + round) % kEntryRows.size();
            const Row& row = kEntryRows[index];
            const uint32_t entries = entry_counts[index];
            const blink::String previous = text->data();
            const auto start = base::TimeTicks::Now();
            const auto stats = nts_chromium_benchmark_entries(
                compiled.get(), operations, entries, row.mode);
            const double elapsed_ns =
                (base::TimeTicks::Now() - start).InMicrosecondsF() * 1000;
            CHECK_EQ(text->data(), operations ? b : previous);
            CHECK_EQ(stats.allocations, 0u);
            if (!round) {
              entry_counts[index] = static_cast<uint32_t>(std::clamp(
                  std::ceil(16e6 * entries / std::max(elapsed_ns, 1.0)), 32.0,
                  100000.0));
              continue;
            }
            base::DictValue sample;
            sample.Set("entry", row.name);
            sample.Set("round", static_cast<int>(round));
            sample.Set("length", static_cast<int>(length));
            sample.Set("operationsPerEntry", static_cast<int>(operations));
            sample.Set("entries", static_cast<int>(entries));
            sample.Set("elapsedNs", elapsed_ns);
            sample.Set("nsPerEntry", elapsed_ns / entries);
            sample.Set("ntsAllocations", static_cast<double>(stats.allocations));
            entry_samples.Append(std::move(sample));
          }
        }
      }
    }
  }
  base::DictValue result;
  result.Set("samples", std::move(samples));
  result.Set("entrySamples", std::move(entry_samples));
  result.Set("payload",
             "Latin-1 then UTF-16 (U+0100-led) strings ending A/B; fresh rows "
             "build prefix + A/B per mutation");
  result.Set(
      "timing",
      "Renderer TimeTicks around loops; no CDP or logging inside timed loops");
  result.Set("finalLength", static_cast<int>(text->length()));
  result.Set("status", 0);
  result.Set("order", static_cast<int>(order));
  return base::WriteJson(result).value();
}
}  // namespace nts_chromium
