#include "nts/rows_benchmark.h"

#include <array>
#include <memory>
#include <string>

#include "base/check.h"
#include "base/functional/bind.h"
#include "base/json/json_writer.h"
#include "base/location.h"
#include "base/memory/raw_ptr.h"
#include "base/task/single_thread_task_runner.h"
#include "base/time/time.h"
#include "base/values.h"
#include "nts/dom_abi.h"
#include "third_party/blink/public/platform/task_type.h"
#include "third_party/blink/renderer/core/dom/document.h"
#include "third_party/blink/renderer/core/dom/element.h"
#include "third_party/blink/renderer/core/dom/frame_request_callback_collection.h"
#include "third_party/blink/renderer/core/html/html_element.h"
#include "third_party/blink/renderer/platform/heap/garbage_collected.h"
#include "third_party/blink/renderer/platform/heap/persistent.h"
#include "third_party/blink/renderer/platform/heap/prefinalizer.h"

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
// A round is two interactions: the setup, a rendered frame, then the timed
// batch -- each a posted task, as the page script posts its own -- so the
// measured operation always meets laid-out, painted rows, as a user's would.
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
// Runs the case table one task at a time. Between tasks the event loop runs
// what Blink scheduled -- incremental GC steps above all -- as it does between
// real events. All rounds in one task let an Oilpan marking cycle stay open
// across the measured work: V8 paces marking by JS allocation, which finishes
// a cycle in a few steps for page script, while the compiled app allocates
// in its own heap, which V8 does not see. create1k+layout measured 38.1 ms
// native against 29.1 ms V8 that way, and 30.6 against 30.6 with incremental
// marking off in both -- the harness, not the DOM work, made the difference.
// Runs a closure from the next frame's animation callbacks. A run dropped
// with its document is released before sweeping, not during it.
class NextFrame final : public blink::FrameCallback {
  USING_PRE_FINALIZER(NextFrame, Dispose);

 public:
  explicit NextFrame(base::OnceClosure run) : run_(std::move(run)) {}
  void Invoke(double) override { std::move(run_).Run(); }
  void Dispose() { run_.Reset(); }

 private:
  base::OnceClosure run_;
};

class RowsRun {
 public:
  RowsRun(blink::Document* document,
          blink::HTMLElement* table_body,
          NtsChromiumProbe* probe,
          NtsChromiumRows* rows,
          base::OnceCallback<void(std::string)> done)
      : document_(document),
        table_body_(table_body),
        probe_(probe),
        rows_(rows),
        done_(std::move(done)) {}

  static void Post(std::unique_ptr<RowsRun> run) {
    // A document gone mid-run drops the run, and its app with the
    // environment that owns it.
    auto* document = run->document_.Get();
    if (!document)
      return;
    document->GetTaskRunner(blink::TaskType::kPostedMessage)
        ->PostTask(FROM_HERE, base::BindOnce(&RowsRun::Step, std::move(run)));
  }

 private:
  static void Step(std::unique_ptr<RowsRun> run) {
    if (run->next_case_ == kCases.size()) {
      auto result = run->Finish();
      std::move(run->done_).Run(std::move(result));
      return;
    }
    if (run->measuring_) {
      run->Measure();
      run->measuring_ = false;
      Post(std::move(run));
      return;
    }
    run->Setup();
    run->measuring_ = true;
    // The frame the setup produces, then the first task after it.
    auto* document = run->document_.Get();
    if (!document)
      return;
    document->RequestAnimationFrame(
        blink::MakeGarbageCollected<NextFrame>(
            base::BindOnce(&RowsRun::Post, std::move(run))),
        blink::FrameCallbackType::kInternal);
  }

  void Setup() {
    const Case& c = kCases[next_case_];
    if (c.setup != kNone && (!c.once || round_ == 0))
      nts_chromium_rows_operate(rows_, c.setup, c.setup_count);
  }

  void Measure() {
    const Case& c = kCases[next_case_];
    // The idle period the previous batch would have been followed by;
    // timed and reported, never folded into the interaction.
    const auto idle_start = base::TimeTicks::Now();
    nts_chromium_probe_collect_idle(probe_);
    const double idle_ns =
        (base::TimeTicks::Now() - idle_start).InMicrosecondsF() * 1000;
    NtsChromiumRowsResult last{};
    size_t allocations = 0;
    base::TimeDelta layout;
    const auto start = base::TimeTicks::Now();
    for (uint32_t i = 0; i < c.batch; ++i) {
      const uint32_t count =
          c.operation == kSelect ? selection_++ % 1000 : c.count;
      last = nts_chromium_rows_operate(rows_, c.operation, count);
      allocations += last.allocations;
      if (c.layout) {
        // Timed on its own as well, inside the batch, so a +layout case
        // says whether the cost is in building the DOM or laying it out.
        const auto layout_start = base::TimeTicks::Now();
        CHECK_GE(table_body_->offsetHeightForBinding(), 0);
        layout += base::TimeTicks::Now() - layout_start;
      }
    }
    const double elapsed_ns =
        (base::TimeTicks::Now() - start).InMicrosecondsF() * 1000;
    if (round_ >= c.warm) {
      base::DictValue sample;
      sample.Set("case", c.name);
      sample.Set("round", static_cast<int>(round_ - c.warm));
      sample.Set("batch", static_cast<int>(c.batch));
      sample.Set("elapsedNs", elapsed_ns);
      sample.Set("nsPerOperation", elapsed_ns / c.batch);
      sample.Set("rows", last.rows);
      sample.Set("ntsAllocations", static_cast<double>(allocations));
      sample.Set("ntsLiveObjects", static_cast<double>(last.live_objects));
      sample.Set("idleCollectNs", idle_ns);
      if (c.layout)
        sample.Set("layoutNs", layout.InMicrosecondsF() * 1000);
      samples_.Append(std::move(sample));
    }
    if (++round_ == c.warm + c.measured) {
      round_ = 0;
      ++next_case_;
    }
  }

  std::string Finish() {
    // A final, untimed state both fixtures must reproduce exactly.
    nts_chromium_rows_operate(rows_, kReplace, 1000);
    nts_chromium_rows_operate(rows_, kUpdate, 0);
    nts_chromium_rows_operate(rows_, kSelect, 5);
    nts_chromium_rows_operate(rows_, kSwap, 0);
    const auto final_rows = nts_chromium_rows_operate(rows_, kRemove, 4);
    // The app ignores DOM statuses, so a refused call would leave an empty
    // table that still reports its rows. Count the real ones.
    CHECK_EQ(static_cast<double>(table_body_->CountChildren()),
             final_rows.rows);
    // Nodes the app keeps rooted while it holds its table, then what
    // destroying it leaves: none.
    const double live_roots = nts_blink_dom_roots();
    nts_chromium_rows_destroy(rows_.ExtractAsDangling());
    base::DictValue result;
    result.Set("samples", std::move(samples_));
    result.Set("finalRows", final_rows.rows);
    result.Set("liveRoots", live_roots);
    result.Set("rootsAfterDestroy",
               static_cast<double>(nts_blink_dom_roots()));
    result.Set("status", 0);
    result.Set("timing",
               "Renderer TimeTicks around batches; each operation is one "
               "native entry (NTS environment + DOM entry); setup and batch "
               "are separate posted tasks");
    return base::WriteJson(result).value();
  }

  blink::WeakPersistent<blink::Document> document_;
  blink::Persistent<blink::HTMLElement> table_body_;
  raw_ptr<NtsChromiumProbe> probe_;
  raw_ptr<NtsChromiumRows> rows_;
  base::OnceCallback<void(std::string)> done_;
  base::ListValue samples_;
  size_t next_case_ = 0;
  uint32_t round_ = 0;
  uint32_t selection_ = 0;
  bool measuring_ = false;
};
}  // namespace

void StartRowsBenchmark(const blink::WebDocument& web_document,
                        NtsDomContext* context,
                        NtsChromiumProbe* probe,
                        base::OnceCallback<void(std::string)> done) {
  auto* document = static_cast<blink::Document*>(web_document);
  auto* table_body = blink::To<blink::HTMLElement>(
      document->getElementById(blink::AtomicString("tbody")));
  CHECK(table_body);
  // The table as the DOM ABI passes a node: its address. The app keeps it,
  // so the compiler roots it; nothing here does.
  auto *tbody = reinterpret_cast<NtsDomNode *>(
      static_cast<blink::Node *>(table_body));
  RowsRun::Post(std::make_unique<RowsRun>(
      document, table_body, probe,
      nts_chromium_rows_create(probe, context, tbody), std::move(done)));
}
}  // namespace nts_chromium
