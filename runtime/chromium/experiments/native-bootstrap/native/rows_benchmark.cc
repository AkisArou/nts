#include "nts/rows_benchmark.h"

#include <array>
#include <memory>
#include <string>

#include "base/check.h"
#include "base/json/json_writer.h"
#include "base/memory/raw_ptr.h"
#include "base/time/time.h"
#include "base/values.h"
#include "nts/dom_abi.h"
#include "third_party/blink/renderer/core/dom/document.h"
#include "third_party/blink/renderer/core/dom/element.h"
#include "third_party/blink/renderer/core/html/html_element.h"

namespace nts_chromium {
namespace {
// Operations of ntsRowsOperate (src/rows.ts) and the page script.
enum Operation : uint32_t {
  kReplace = 0,
  kAppend = 1,
  kUpdate = 2,
  kSelect = 3,
  kSwap = 4,
  kRemove = 5,
  kClear = 6,
  kNone = 7,
};
// The same table drives rows-benchmark-v8/index.html; keep them identical.
// `setup` runs untimed before every round (or only the first, if `once`);
// a sample is `batch` back-to-back operations, each its own native entry.
struct Case {
  const char* name;
  Operation setup;
  uint32_t setup_count;
  bool once;
  Operation operation;
  uint32_t count;
  uint32_t batch;
  uint32_t warm;
  uint32_t measured;
  // Force style and layout after each operation, as the next frame would:
  // the same HTMLElement::offsetHeightForBinding page script reaches.
  bool layout = false;
};
constexpr std::array<Case, 14> kCases{{
    {"create1k", kClear, 0, false, kReplace, 1000, 1, 3, 15},
    {"replace1k", kReplace, 1000, false, kReplace, 1000, 1, 3, 15},
    {"update10th", kReplace, 1000, false, kUpdate, 0, 10, 3, 15},
    {"select", kReplace, 1000, true, kSelect, 0, 1000, 3, 15},
    {"swap", kReplace, 1000, true, kSwap, 0, 1000, 3, 15},
    {"remove", kReplace, 1000, false, kRemove, 4, 200, 3, 15},
    {"append1k", kReplace, 1000, false, kAppend, 1000, 1, 3, 15},
    {"clear1k", kReplace, 1000, false, kClear, 0, 1, 3, 15},
    {"create10k", kClear, 0, false, kReplace, 10000, 1, 1, 6},
    {"clear10k", kReplace, 10000, false, kClear, 0, 1, 1, 6},
    {"create1k+layout", kClear, 0, false, kReplace, 1000, 1, 3, 15, true},
    {"update10th+layout", kReplace, 1000, false, kUpdate, 0, 10, 3, 15, true},
    {"select+layout", kReplace, 1000, true, kSelect, 0, 100, 3, 15, true},
    {"swap+layout", kReplace, 1000, true, kSwap, 0, 100, 3, 15, true},
}};
}  // namespace

std::string RunRowsBenchmark(const blink::WebDocument& web_document,
                             NtsDomContext* context,
                             NtsChromiumProbe* probe) {
  auto* document = static_cast<blink::Document*>(web_document);
  auto* table_body = blink::To<blink::HTMLElement>(
      document->getElementById(blink::AtomicString("tbody")));
  CHECK(table_body);
  uint32_t tbody = 0;
  struct Query {
    raw_ptr<NtsDomContext> context;
    raw_ptr<uint32_t> tbody;
  } query{context, &tbody};
  CHECK_EQ(nts_blink_dom_entry(
               context,
               [](void* state) {
                 auto& q = *static_cast<Query*>(state);
                 const uint32_t root = nts_dom_document(q.context);
                 *q.tbody = nts_dom_query_atom(
                     q.context, root,
                     nts_blink_dom_intern(q.context, {"#tbody", 6, 0}));
                 nts_dom_release(q.context, root);
               },
               &query),
           0);
  CHECK(tbody);
  auto rows = std::unique_ptr<NtsChromiumRows,
                              decltype(&nts_chromium_rows_destroy)>(
      nts_chromium_rows_create(probe, context, tbody),
      &nts_chromium_rows_destroy);
  base::ListValue samples;
  uint32_t selection = 0;
  for (const Case& c : kCases) {
    for (uint32_t round = 0; round < c.warm + c.measured; ++round) {
      if (c.setup != kNone && (!c.once || round == 0))
        nts_chromium_rows_operate(rows.get(), c.setup, c.setup_count);
      // The idle period the previous batch would have been followed by;
      // timed and reported, never folded into the interaction.
      const auto idle_start = base::TimeTicks::Now();
      nts_chromium_probe_collect_idle(probe);
      const double idle_ns =
          (base::TimeTicks::Now() - idle_start).InMicrosecondsF() * 1000;
      NtsChromiumRowsResult last{};
      size_t allocations = 0;
      const auto start = base::TimeTicks::Now();
      for (uint32_t i = 0; i < c.batch; ++i) {
        const uint32_t count =
            c.operation == kSelect ? selection++ % 1000 : c.count;
        last = nts_chromium_rows_operate(rows.get(), c.operation, count);
        allocations += last.allocations;
        if (c.layout)
          CHECK_GE(table_body->offsetHeightForBinding(), 0);
      }
      const double elapsed_ns =
          (base::TimeTicks::Now() - start).InMicrosecondsF() * 1000;
      if (round < c.warm)
        continue;
      base::DictValue sample;
      sample.Set("case", c.name);
      sample.Set("round", static_cast<int>(round - c.warm));
      sample.Set("batch", static_cast<int>(c.batch));
      sample.Set("elapsedNs", elapsed_ns);
      sample.Set("nsPerOperation", elapsed_ns / c.batch);
      sample.Set("rows", last.rows);
      sample.Set("ntsAllocations", static_cast<double>(allocations));
      sample.Set("ntsLiveObjects", static_cast<double>(last.live_objects));
      sample.Set("idleCollectNs", idle_ns);
      samples.Append(std::move(sample));
    }
  }
  // A final, untimed state both fixtures must reproduce exactly.
  nts_chromium_rows_operate(rows.get(), kReplace, 1000);
  nts_chromium_rows_operate(rows.get(), kUpdate, 0);
  nts_chromium_rows_operate(rows.get(), kSelect, 5);
  nts_chromium_rows_operate(rows.get(), kSwap, 0);
  const auto final_rows = nts_chromium_rows_operate(rows.get(), kRemove, 4);
  // The app ignores DOM statuses, so a refused call would leave an empty table
  // that still reports its rows. Count the real ones.
  CHECK_EQ(static_cast<double>(table_body->CountChildren()), final_rows.rows);
  base::DictValue result;
  result.Set("samples", std::move(samples));
  result.Set("finalRows", final_rows.rows);
  result.Set("liveLeases", static_cast<double>(nts_blink_dom_roots(context)));
  result.Set("status", 0);
  result.Set("timing",
             "Renderer TimeTicks around batches; each operation is one native "
             "entry (NTS environment + DOM entry)");
  return base::WriteJson(result).value();
}
}  // namespace nts_chromium
