#include "nts/kernels_benchmark.h"

#include <array>
#include <memory>
#include <string>

#include "base/check.h"
#include "base/compiler_specific.h"
#include "base/functional/bind.h"
#include "base/json/json_writer.h"
#include "base/location.h"
#include "base/memory/raw_ptr.h"
#include "base/task/single_thread_task_runner.h"
#include "base/time/time.h"
#include "base/values.h"
#include "third_party/blink/public/platform/task_type.h"
#include "third_party/blink/renderer/core/dom/document.h"
#include "third_party/blink/renderer/core/dom/element.h"
#include "third_party/blink/renderer/core/dom/text.h"
#include "third_party/blink/renderer/platform/bindings/exception_state.h"
#include "third_party/blink/renderer/platform/heap/persistent.h"

namespace nts_chromium {
namespace {
// native-typescript's matrix ran 100,000 iterations per sample after a
// 20,000-iteration warmup; these samples are 20,000 iterations, three
// discarded, twenty kept, each in its own task (see RowsRun: one long task
// leaves GC pacing to whichever lane allocates on V8's heap).
constexpr uint32_t kIterations = 20000;
constexpr uint32_t kWarm = 3;
constexpr uint32_t kMeasured = 20;

enum Kernel : uint32_t { kCreateElements = 0, kCounterTrees = 1 };
enum class Shape { kLoop, kPerCall };
enum class Lane { kIntrinsic, kCompiled };
struct Case {
  const char* kernel_name;
  Kernel kernel;
  Shape shape;
  Lane lane;
};
constexpr std::array<Case, 8> kCases{{
    {"create-element", kCreateElements, Shape::kLoop, Lane::kIntrinsic},
    {"create-element", kCreateElements, Shape::kLoop, Lane::kCompiled},
    {"create-element", kCreateElements, Shape::kPerCall, Lane::kIntrinsic},
    {"create-element", kCreateElements, Shape::kPerCall, Lane::kCompiled},
    {"detached-counter-tree", kCounterTrees, Shape::kLoop, Lane::kIntrinsic},
    {"detached-counter-tree", kCounterTrees, Shape::kLoop, Lane::kCompiled},
    {"detached-counter-tree", kCounterTrees, Shape::kPerCall,
     Lane::kIntrinsic},
    {"detached-counter-tree", kCounterTrees, Shape::kPerCall,
     Lane::kCompiled},
}};

// The C++ floor, as native-typescript's nts_blink_benchmark_host.cc writes
// it: the IDL members' implementations, an exception state per iteration,
// no wrapper, no handle, no reaction scope.
NOINLINE uint32_t CreateElementOnce(blink::Document& document) {
  blink::DummyExceptionStateForTesting exception_state;
  blink::Element* element = document.CreateElementForBinding(
      blink::AtomicString("div"), exception_state);
  return element && !exception_state.HadException() ? 1u : 0u;
}
NOINLINE uint32_t CreateCounterTreeOnce(blink::Document& document) {
  blink::DummyExceptionStateForTesting exception_state;
  blink::Element* button = document.CreateElementForBinding(
      blink::AtomicString("button"), exception_state);
  if (!button || exception_state.HadException())
    return 0;
  blink::Text* label = document.createTextNode("Count: 0");
  if (!label)
    return 0;
  if (button->appendChild(label, exception_state) != label ||
      exception_state.HadException())
    return 0;
  label->setData("Count: 1");
  return 1;
}
uint32_t IntrinsicOnce(Kernel kernel, blink::Document& document) {
  return kernel == kCreateElements ? CreateElementOnce(document)
                                   : CreateCounterTreeOnce(document);
}

class KernelsRun {
 public:
  KernelsRun(blink::Document* document,
             NtsDomContext* context,
             NtsChromiumProbe* probe,
             base::OnceCallback<void(std::string)> done)
      : document_(document),
        context_(context),
        probe_(probe),
        done_(std::move(done)) {}

  static void Post(std::unique_ptr<KernelsRun> run) {
    auto* document = run->document_.Get();
    if (!document)
      return;
    document->GetTaskRunner(blink::TaskType::kPostedMessage)
        ->PostTask(FROM_HERE,
                   base::BindOnce(&KernelsRun::Step, std::move(run)));
  }

 private:
  static void Step(std::unique_ptr<KernelsRun> run) {
    if (run->next_case_ == kCases.size()) {
      auto result = run->Finish();
      std::move(run->done_).Run(std::move(result));
      return;
    }
    run->Sample();
    Post(std::move(run));
  }

  void Sample() {
    const Case& c = kCases[next_case_];
    blink::Document& document = *document_;
    double checksum = 0;
    size_t allocations = 0;
    const auto start = base::TimeTicks::Now();
    if (c.lane == Lane::kIntrinsic) {
      if (c.shape == Shape::kLoop) {
        for (uint32_t i = 0; i < kIterations; ++i)
          checksum += IntrinsicOnce(c.kernel, document);
      } else {
        // A call per iteration through a pointer the compiler cannot fold:
        // the floor of crossing into a function at all.
        uint32_t (*const volatile once)(Kernel, blink::Document&) =
            &IntrinsicOnce;
        for (uint32_t i = 0; i < kIterations; ++i)
          checksum += once(c.kernel, document);
      }
    } else if (c.shape == Shape::kLoop) {
      checksum = nts_chromium_kernel_run(probe_, context_, c.kernel,
                                         kIterations, &allocations);
    } else {
      // One native callback per iteration: an environment entry and a DOM
      // entry each, what an event handler costs in this architecture.
      for (uint32_t i = 0; i < kIterations; ++i) {
        size_t made = 0;
        checksum +=
            nts_chromium_kernel_run(probe_, context_, c.kernel, 1, &made);
        allocations += made;
      }
    }
    const double elapsed_ns =
        (base::TimeTicks::Now() - start).InMicrosecondsF() * 1000;
    CHECK_EQ(checksum, static_cast<double>(kIterations)) << c.kernel_name;
    if (round_ >= kWarm) {
      base::DictValue sample;
      sample.Set("kernel", c.kernel_name);
      sample.Set("shape", c.shape == Shape::kLoop ? "loop" : "per-call");
      sample.Set("lane", c.lane == Lane::kIntrinsic ? "blink-intrinsic"
                                                    : "compiled");
      sample.Set("round", static_cast<int>(round_ - kWarm));
      sample.Set("iterations", static_cast<int>(kIterations));
      sample.Set("nsPerOperation", elapsed_ns / kIterations);
      sample.Set("ntsAllocations", static_cast<double>(allocations));
      samples_.Append(std::move(sample));
    }
    if (++round_ == kWarm + kMeasured) {
      round_ = 0;
      ++next_case_;
    }
  }

  std::string Finish() {
    base::DictValue result;
    result.Set("samples", std::move(samples_));
    result.Set("liveLeases",
               static_cast<double>(nts_blink_dom_roots(context_)));
    result.Set("status", 0);
    result.Set("timing",
               "Renderer TimeTicks around each sample; one posted task per "
               "sample");
    return base::WriteJson(result).value();
  }

  blink::WeakPersistent<blink::Document> document_;
  raw_ptr<NtsDomContext> context_;
  raw_ptr<NtsChromiumProbe> probe_;
  base::OnceCallback<void(std::string)> done_;
  base::ListValue samples_;
  size_t next_case_ = 0;
  uint32_t round_ = 0;
};
}  // namespace

void StartKernelsBenchmark(const blink::WebDocument& web_document,
                           NtsDomContext* context,
                           NtsChromiumProbe* probe,
                           base::OnceCallback<void(std::string)> done) {
  KernelsRun::Post(std::make_unique<KernelsRun>(
      static_cast<blink::Document*>(web_document), context, probe,
      std::move(done)));
}
}  // namespace nts_chromium
