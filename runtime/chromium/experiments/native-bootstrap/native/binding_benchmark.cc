#include "nts/binding_benchmark.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <memory>
#include <string>

#include "base/check.h"
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
enum class Path {
  kBlinkPrepared,
  kVectorPerCall,
  kCopyPerCall,
  kCopyScoped,
  kCompiledCopies,
  kCompiledPrepared,
  kCompiledCopiesScoped,
  kCompiledPreparedScoped,
};
constexpr std::array<const char*, 8> kNames = {
    "blink-prepared",           "native-vector-per-call",
    "native-copy-per-call",     "native-copy-scoped",
    "compiled-copies-per-call", "compiled-prepared-per-call",
    "compiled-copies-scoped",   "compiled-prepared-scoped"};

struct Loop {
  Path path;
  raw_ptr<NtsDomContext> context;
  uint32_t node;
  blink::Persistent<blink::Text> text;
  blink::String a;
  blink::String b;
  NtsDomString first;
  NtsDomString second;
  uint32_t iterations;
  int32_t status = 0;
};
void RunLoop(void* state) {
  auto& loop = *static_cast<Loop*>(state);
  for (uint32_t i = 0; i < loop.iterations; ++i) {
    const bool second = i % 2;
    if (loop.path == Path::kBlinkPrepared) {
      loop.text->setTextContent(second ? loop.b : loop.a);
    } else if (loop.path == Path::kVectorPerCall) {
      loop.status = nts_blink_dom_set_text_vector_for_benchmark(
          loop.context, loop.node, second ? loop.second : loop.first);
    } else {
      loop.status = nts_blink_dom_set_text(loop.context, loop.node,
                                           second ? loop.second : loop.first);
    }
  }
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
  // The same attached Text node is used by every path; setup is untimed.
  const std::u16string selector = u"#benchmark-text";
  blink::Vector<uint16_t> selector_units;
  for (char16_t unit : selector)
    selector_units.push_back(static_cast<uint16_t>(unit));
  const uint32_t parent = nts_blink_dom_query(
      context, {selector_units.data(), selector_units.size()});
  const uint32_t node = nts_blink_dom_text(context, {nullptr, 0});
  CHECK_EQ(nts_blink_dom_append(context, parent, node), node);
  auto* text = blink::To<blink::Text>(output->firstChild());
  base::ListValue samples;
  base::ListValue entry_samples;
  constexpr std::array<uint32_t, 3> lengths{16, 256, 4096};
  for (uint32_t position = 0; position < lengths.size(); ++position) {
    const uint32_t length = lengths[(position + order) % lengths.size()];
    std::array<uint32_t, 8> counts;
    counts.fill(16384);
    blink::Vector<uint16_t> a_units(length, 'x');
    blink::Vector<uint16_t> b_units(length, 'x');
    a_units[0] = b_units[0] = 0x100;  // Force UTF-16 in every representation.
    a_units[length - 1] = 'A';
    b_units[length - 1] = 'B';
    std::string first = "\xc4\x80" + std::string(length - 2, 'x') + "A";
    std::string second = "\xc4\x80" + std::string(length - 2, 'x') + "B";
    auto compiled = std::unique_ptr<NtsChromiumBenchmark,
                                    decltype(&nts_chromium_benchmark_destroy)>(
        nts_chromium_benchmark_create(probe, context, node, first.data(),
                                      second.data(), first.size()),
        &nts_chromium_benchmark_destroy);
    blink::String a = blink::String::FromUtf8(base::as_byte_span(first));
    blink::String b = blink::String::FromUtf8(base::as_byte_span(second));
    // One warm-up round, then seven rounds with rotating case order.
    for (uint32_t round = 0; round < 8; ++round) {
      for (uint32_t offset = 0; offset < kNames.size(); ++offset) {
        const uint32_t index = (offset + round) % kNames.size();
        const auto path = static_cast<Path>(index);
        const uint32_t iterations = counts[index];
        Loop loop{path,
                  context,
                  node,
                  blink::Persistent<blink::Text>(text),
                  a,
                  b,
                  {a_units.data(), a_units.size()},
                  {b_units.data(), b_units.size()},
                  iterations};
        NtsChromiumBenchmarkStats stats{};
        const auto start = base::TimeTicks::Now();
        if (index >= static_cast<uint32_t>(Path::kCompiledCopies)) {
          const bool prepared = path == Path::kCompiledPrepared ||
                                path == Path::kCompiledPreparedScoped;
          const bool scoped = path == Path::kCompiledCopiesScoped ||
                              path == Path::kCompiledPreparedScoped;
          stats = nts_chromium_benchmark_run(compiled.get(), iterations,
                                             prepared, scoped);
        } else if (path == Path::kCopyScoped || path == Path::kBlinkPrepared) {
          nts_blink_dom_native_scope(context, RunLoop, &loop);
        } else {
          RunLoop(&loop);
        }
        const double elapsed_ns =
            (base::TimeTicks::Now() - start).InMicrosecondsF() * 1000;
        CHECK_EQ(loop.status, 0);
        CHECK_EQ(text->data(), b) << kNames[index];
        CHECK_EQ(nts_blink_dom_status(context), 0);
        if (!round) {
          const double desired = 16e6 * iterations / std::max(elapsed_ns, 1.0);
          counts[index] = static_cast<uint32_t>(
              std::clamp(std::ceil(desired / 2) * 2, 32.0, 100000.0));
          continue;
        }
        base::DictValue sample;
        sample.Set("path", kNames[index]);
        sample.Set("round", static_cast<int>(round));
        sample.Set("length", static_cast<int>(length));
        sample.Set("iterations", static_cast<int>(iterations));
        sample.Set("elapsedNs", elapsed_ns);
        sample.Set("nsPerOperation", elapsed_ns / iterations);
        if (index >= static_cast<uint32_t>(Path::kCompiledCopies)) {
          sample.Set("ntsAllocations", static_cast<double>(stats.allocations));
          sample.Set("ntsRetains", static_cast<double>(stats.retains));
          sample.Set("ntsReleases", static_cast<double>(stats.releases));
          sample.Set("ntsLiveObjects", static_cast<double>(stats.live_objects));
        }
        samples.Append(std::move(sample));
      }
    }
    // Short callbacks expose the cost and break-even point of entering Blink
    // once per callback. Zero DOM operations measures unnecessary realm setup;
    // every nonempty callback ends on B so consecutive entries still mutate.
    for (const uint32_t operations : {0u, 2u, 8u, 32u}) {
      std::array<uint32_t, 2> entry_counts{16384, 16384};
      for (uint32_t round = 0; round < 8; ++round) {
        for (uint32_t offset = 0; offset < 2; ++offset) {
          const uint32_t scoped = (offset + round) % 2;
          const uint32_t entries = entry_counts[scoped];
          const blink::String previous = text->data();
          const auto start = base::TimeTicks::Now();
          const auto stats = nts_chromium_benchmark_entries(
              compiled.get(), operations, entries, scoped);
          const double elapsed_ns =
              (base::TimeTicks::Now() - start).InMicrosecondsF() * 1000;
          CHECK_EQ(text->data(), operations ? b : previous);
          CHECK_EQ(nts_blink_dom_status(context), 0);
          CHECK_EQ(stats.allocations, 0u);
          if (!round) {
            entry_counts[scoped] = static_cast<uint32_t>(std::clamp(
                std::ceil(16e6 * entries / std::max(elapsed_ns, 1.0)), 32.0,
                100000.0));
            continue;
          }
          base::DictValue sample;
          sample.Set("scoped", static_cast<bool>(scoped));
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
  base::DictValue result;
  result.Set("samples", std::move(samples));
  result.Set("entrySamples", std::move(entry_samples));
  result.Set("payload",
             "Alternating UTF-16 strings beginning with U+0100, ending A/B");
  result.Set(
      "timing",
      "Renderer TimeTicks around loops; no CDP or logging inside timed loops");
  result.Set("finalLength", static_cast<int>(text->length()));
  result.Set("status", nts_blink_dom_status(context));
  result.Set("order", static_cast<int>(order));
  return base::WriteJson(result).value();
}
}  // namespace nts_chromium
