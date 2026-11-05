#include "nts/kernels_benchmark.h"

#include <array>
#include <memory>
#include <string>
#include <vector>

#include "base/check.h"
#include "base/command_line.h"
#include "base/compiler_specific.h"
#include "base/functional/bind.h"
#include "base/json/json_writer.h"
#include "base/location.h"
#include "base/memory/raw_ptr.h"
#include "base/task/single_thread_task_runner.h"
#include "base/time/time.h"
#include "base/values.h"
#include "third_party/blink/public/platform/task_type.h"
#include "third_party/blink/renderer/bindings/core/v8/script_value.h"
#include "third_party/blink/renderer/bindings/core/v8/v8_binding_for_core.h"
#include "third_party/blink/renderer/bindings/core/v8/v8_post_message_options.h"
#include "third_party/blink/renderer/core/dom/document.h"
#include "third_party/blink/renderer/core/dom/element.h"
#include "third_party/blink/renderer/core/dom/events/native_event_listener.h"
#include "third_party/blink/renderer/core/dom/text.h"
#include "third_party/blink/renderer/core/execution_context/agent.h"
#include "third_party/blink/renderer/core/execution_context/execution_context.h"
#include "third_party/blink/renderer/core/html/canvas/canvas_context_creation_attributes_core.h"
#include "third_party/blink/renderer/core/html/canvas/canvas_rendering_context.h"
#include "third_party/blink/renderer/core/html/canvas/html_canvas_element.h"
#include "third_party/blink/renderer/core/html/custom/ce_reactions_scope.h"
#include "third_party/blink/renderer/core/html/html_element.h"
#include "third_party/blink/renderer/core/messaging/message_channel.h"
#include "third_party/blink/renderer/core/messaging/message_port.h"
#include "third_party/blink/renderer/modules/canvas/canvas2d/canvas_rendering_context_2d.h"
#include "third_party/blink/renderer/platform/bindings/exception_state.h"
#include "third_party/blink/renderer/platform/heap/persistent.h"
#include "third_party/blink/renderer/platform/scheduler/public/event_loop.h"
#include "third_party/blink/renderer/platform/wtf/std_lib_extras.h"

namespace nts_chromium {
namespace {
// native-typescript's matrix ran 100,000 iterations per sample after a
// 20,000-iteration warmup; these samples are 20,000 iterations, three
// discarded, twenty kept, each in its own task (see RowsRun: one long task
// leaves GC pacing to whichever lane allocates on V8's heap).
constexpr uint32_t kIterations = 20000;
constexpr uint32_t kWarm = 3;
constexpr uint32_t kMeasured = 20;

enum Kernel : uint32_t {
  kCreateElements = 0,
  kCounterTrees = 1,
  kEventRoundTrips = 2,
  kCanvasRects = 3,
};
enum class Shape { kLoop, kPerCall, kBatch16, kBatch256, kTaskCall };
// Iterations in a task-call sample: one posted task per iteration, as
// on the V8 side, so 2,000 -- 20,000 tasks would measure the queue.
constexpr uint32_t kTaskIterations = 2000;
// Iterations per entry for a shape: the loop is one entry for the whole
// sample, per-call one per iteration, a batch one per N. Fitting time
// against batch size separates an entry's cost from a call's.
constexpr uint32_t BatchOf(Shape shape) {
  return shape == Shape::kLoop      ? kIterations
         : shape == Shape::kPerCall ? 1
         : shape == Shape::kBatch16 ? 16
                                    : 256;
}
constexpr const char* NameOf(Shape shape) {
  return shape == Shape::kLoop       ? "loop"
         : shape == Shape::kPerCall  ? "per-call"
         : shape == Shape::kBatch16  ? "batch16"
         : shape == Shape::kBatch256 ? "batch256"
                                     : "task-call";
}
enum class Lane { kIntrinsic, kCompiled, kAtomLookupControl };
const char* NameOf(Lane lane) {
  return lane == Lane::kIntrinsic  ? "blink-intrinsic"
         : lane == Lane::kCompiled ? "compiled"
                                   : "blink-atom-lookup";
}
struct Case {
  const char* kernel_name;
  Kernel kernel;
  Shape shape;
  Lane lane;
};
constexpr std::array<Case, 23> kCases{{
    {"create-element", kCreateElements, Shape::kLoop, Lane::kIntrinsic},
    {"create-element", kCreateElements, Shape::kLoop, Lane::kCompiled},
    {"create-element", kCreateElements, Shape::kLoop, Lane::kAtomLookupControl},
    {"create-element", kCreateElements, Shape::kPerCall, Lane::kIntrinsic},
    {"create-element", kCreateElements, Shape::kPerCall, Lane::kCompiled},
    {"detached-counter-tree", kCounterTrees, Shape::kLoop, Lane::kIntrinsic},
    {"detached-counter-tree", kCounterTrees, Shape::kLoop, Lane::kCompiled},
    {"detached-counter-tree", kCounterTrees, Shape::kPerCall, Lane::kIntrinsic},
    {"detached-counter-tree", kCounterTrees, Shape::kPerCall, Lane::kCompiled},
    {"event-round-trip", kEventRoundTrips, Shape::kLoop, Lane::kIntrinsic},
    {"event-round-trip", kEventRoundTrips, Shape::kLoop, Lane::kCompiled},
    {"event-round-trip", kEventRoundTrips, Shape::kPerCall, Lane::kIntrinsic},
    {"event-round-trip", kEventRoundTrips, Shape::kPerCall, Lane::kCompiled},
    {"canvas-rects", kCanvasRects, Shape::kLoop, Lane::kIntrinsic},
    {"canvas-rects", kCanvasRects, Shape::kLoop, Lane::kCompiled},
    {"canvas-rects", kCanvasRects, Shape::kPerCall, Lane::kIntrinsic},
    {"canvas-rects", kCanvasRects, Shape::kPerCall, Lane::kCompiled},
    {"canvas-rects", kCanvasRects, Shape::kBatch16, Lane::kIntrinsic},
    {"canvas-rects", kCanvasRects, Shape::kBatch16, Lane::kCompiled},
    {"canvas-rects", kCanvasRects, Shape::kBatch256, Lane::kIntrinsic},
    {"canvas-rects", kCanvasRects, Shape::kBatch256, Lane::kCompiled},
    {"canvas-rects", kCanvasRects, Shape::kTaskCall, Lane::kIntrinsic},
    {"canvas-rects", kCanvasRects, Shape::kTaskCall, Lane::kCompiled},
}};

// One immutable set per launch, built before any sample clock. Helpers
// receive references, so no per-call static-initialization guard remains.
struct KernelConstants {
  const blink::AtomicString div{"div"};
  const blink::AtomicString button{"button"};
  const blink::AtomicString click{"click"};
  const blink::AtomicString canvas_id{"kernel-canvas"};
  const blink::AtomicString two_d{"2d"};
  const blink::String initial_label{"Count: 0"};
  const blink::String updated_label{"Count: 1"};
  const blink::CanvasContextCreationAttributesCore canvas_attributes;
};

enum Call : size_t {
  kCreateElement,
  kCreateText,
  kAppendChild,
  kSetData,
  kBody,
  kAddListener,
  kClick,
  kRemoveListener,
  kElementById,
  kGetContext,
  kFillRect,
  kCallCount
};
constexpr std::array<const char*, kCallCount> kCallNames{
    "createElement",  "createTextNode",   "appendChild", "setData",
    "body",           "addEventListener", "click",       "removeEventListener",
    "getElementById", "getContext",       "fillRect"};
using CallCounts = std::array<uint64_t, kCallCount>;

// Audit is a distinct, untimed instantiation. The normal instantiation has
// no counter access or runtime audit branch. Every counted call invokes the
// same opaque Blink implementation as the normal body.
template <bool Audit, typename Function>
ALWAYS_INLINE decltype(auto) BlinkCall(CallCounts& calls,
                                       Call call,
                                       Function function) {
  if constexpr (Audit)
    ++calls[call];
  return function();
}

// Blink's own C++: the same IDL implementations, exception state and
// required reaction scopes as the compiled bindings, with constants built
// once and no program ABI or V8 value conversions.
template <bool Audit>
ALWAYS_INLINE uint32_t CreateElementOnce(blink::Document& document,
                                         CallCounts& calls,
                                         const KernelConstants& constants) {
  blink::DummyExceptionStateForTesting exception_state;
  blink::Element* element = BlinkCall<Audit>(calls, kCreateElement, [&] {
    return document.CreateElementForBinding(constants.div, exception_state);
  });
  return element && !exception_state.HadException() ? 1u : 0u;
}
// Request 18's control: the same call and exception handling as the
// intrinsic kernel, with only the atom-table lookup repeated per call.
ALWAYS_INLINE uint32_t
CreateElementWithAtomLookupOnce(blink::Document& document) {
  blink::DummyExceptionStateForTesting exception_state;
  blink::Element* element = document.CreateElementForBinding(
      blink::AtomicString("div"), exception_state);
  return element && !exception_state.HadException() ? 1u : 0u;
}
template <bool Audit>
ALWAYS_INLINE uint32_t CreateCounterTreeOnce(blink::Document& document,
                                             CallCounts& calls,
                                             const KernelConstants& constants) {
  blink::DummyExceptionStateForTesting exception_state;
  blink::Element* button = BlinkCall<Audit>(calls, kCreateElement, [&] {
    return document.CreateElementForBinding(constants.button, exception_state);
  });
  if (!button || exception_state.HadException())
    return 0;
  blink::Text* label = BlinkCall<Audit>(calls, kCreateText, [&] {
    return document.createTextNode(constants.initial_label);
  });
  if (!label)
    return 0;
  {
    blink::CEReactionsScope reactions(
        document.GetExecutionContext()->GetIsolate());
    if (BlinkCall<Audit>(calls, kAppendChild,
                         [&] {
                           return button->appendChild(label, exception_state);
                         }) != label ||
        exception_state.HadException())
      return 0;
  }
  BlinkCall<Audit>(calls, kSetData,
                   [&] { label->setData(constants.updated_label); });
  return 1;
}
// A listener counting its calls, as native-typescript's
// RunSynchronousEventRoundTripsCpp registers one.
class CountingListener final : public blink::NativeEventListener {
 public:
  void Invoke(blink::ExecutionContext*, blink::Event*) override { ++count; }
  uint32_t count = 0;
};
// Listen on the body, click it `clicks` times, remove the listener.
template <bool Audit>
ALWAYS_INLINE uint32_t EventRoundTrips(blink::Document& document,
                                       uint32_t clicks,
                                       CallCounts& calls,
                                       const KernelConstants& constants) {
  blink::HTMLElement* body =
      BlinkCall<Audit>(calls, kBody, [&] { return document.body(); });
  if (!body)
    return 0;
  auto* listener = blink::MakeGarbageCollected<CountingListener>();
  if (!BlinkCall<Audit>(calls, kAddListener, [&] {
        return body->addEventListener(constants.click, listener, false);
      }))
    return 0;
  for (uint32_t i = 0; i < clicks; ++i)
    BlinkCall<Audit>(calls, kClick, [&] { body->click(); });
  BlinkCall<Audit>(calls, kRemoveListener, [&] {
    body->removeEventListener(constants.click, listener, false);
  });
  return listener->count;
}
// The page's canvas and its 2D context, found as the compiled kernel finds
// them, then `count` 2x2 rectangles.
template <bool Audit>
ALWAYS_INLINE uint32_t CanvasRects(blink::Document& document,
                                   uint32_t count,
                                   CallCounts& calls,
                                   const KernelConstants& constants) {
  auto* canvas = blink::DynamicTo<blink::HTMLCanvasElement>(BlinkCall<Audit>(
      calls, kElementById,
      [&] { return document.getElementById(constants.canvas_id); }));
  // HTMLCanvasElementModule::getContext and the compiled adapter both
  // check this before GetCanvasRenderingContext. The default attributes
  // are the same no-options value; neither native lane needs the
  // V8RenderingContext union that adapts the result back to page script.
  if (!canvas || canvas->IsOffscreenCanvasRegistered())
    return 0;
  // The same atom the compiled kernel's adapter passes, built once:
  // asking Blink the same thing means not paying a fresh String here
  // that the compiled side no longer pays.
  blink::CanvasRenderingContext* rendering =
      BlinkCall<Audit>(calls, kGetContext, [&] {
        return canvas->GetCanvasRenderingContext(document.GetExecutionContext(),
                                                 constants.two_d,
                                                 constants.canvas_attributes);
      });
  if (!rendering || !rendering->IsRenderingContext2D())
    return 0;
  auto* context = static_cast<blink::CanvasRenderingContext2D*>(rendering);
  for (uint32_t i = 0; i < count; ++i)
    BlinkCall<Audit>(calls, kFillRect,
                     [&] { context->fillRect(i & 255, (i >> 8) & 255, 2, 2); });
  return count;
}
template <bool Audit>
ALWAYS_INLINE uint32_t IntrinsicBatch(Kernel kernel,
                                      blink::Document& document,
                                      uint32_t count,
                                      CallCounts& calls,
                                      const KernelConstants& constants) {
  uint32_t checksum = 0;
  switch (kernel) {
    case kCreateElements:
      for (uint32_t i = 0; i < count; ++i)
        checksum += CreateElementOnce<Audit>(document, calls, constants);
      return checksum;
    case kCounterTrees:
      for (uint32_t i = 0; i < count; ++i)
        checksum += CreateCounterTreeOnce<Audit>(document, calls, constants);
      return checksum;
    case kEventRoundTrips:
      return EventRoundTrips<Audit>(document, count, calls, constants);
    case kCanvasRects:
      return CanvasRects<Audit>(document, count, calls, constants);
  }
}

class TaskCallListener;
class KernelsRun {
 public:
  KernelsRun(blink::Document* document,
             NtsDomContext* context,
             NtsChromiumProbe* probe,
             base::OnceCallback<void(std::string)> done)
      : document_(document),
        context_(context),
        probe_(probe),
        done_(std::move(done)) {
    const auto& command = *base::CommandLine::ForCurrentProcess();
    const std::string lane = command.GetSwitchValueASCII("nts-kernels-lane");
    const std::string selected =
        command.GetSwitchValueASCII("nts-kernels-case");
    audit_ = command.HasSwitch("nts-kernels-audit-calls");
    for (const Case& c : kCases) {
      if (audit_ && c.lane != Lane::kIntrinsic)
        continue;
      if (!lane.empty() && lane != NameOf(c.lane))
        continue;
      if (!selected.empty() &&
          selected != std::string(c.kernel_name) + "/" + NameOf(c.shape))
        continue;
      cases_.push_back(c);
    }
    CHECK(!cases_.empty()) << "No kernel case matches the launch selection";
  }

  static void Post(std::unique_ptr<KernelsRun> run) {
    auto* document = run->document_.Get();
    if (!document)
      return;
    document->GetTaskRunner(blink::TaskType::kPostedMessage)
        ->PostTask(FROM_HERE,
                   base::BindOnce(&KernelsRun::Step, std::move(run)));
  }

  // One iteration of a task-call sample, from its message handler.
  void TaskCallOnce();

 private:
  static void Step(std::unique_ptr<KernelsRun> run) {
    if (run->audit_)
      run->AuditCalls();
    if (run->audit_ || run->next_case_ == run->cases_.size()) {
      auto result = run->Finish();
      std::move(run->done_).Run(std::move(result));
      return;
    }
    if (run->Sample())
      Post(std::move(run));
    else
      *ActiveTaskCall() = std::move(run);
  }
  // The run a task-call sample holds across its tasks (one benchmark
  // at a time in a renderer). Leaked slot: no exit-time destructor.
  static std::unique_ptr<KernelsRun>* ActiveTaskCall() {
    static std::unique_ptr<KernelsRun>* slot =
        new std::unique_ptr<KernelsRun>();
    return slot;
  }

  void StartTaskCall();
  void PostTaskCallMessage();
  void AuditCalls() {
    for (const Case& c : cases_) {
      CHECK(c.lane == Lane::kIntrinsic);
      const uint32_t iterations =
          c.shape == Shape::kTaskCall ? kTaskIterations : kIterations;
      const uint32_t batch = c.shape == Shape::kTaskCall ? 1 : BatchOf(c.shape);
      calls_.fill(0);
      uint32_t checksum = 0;
      for (uint32_t done = 0; done < iterations; done += batch) {
        checksum += IntrinsicBatch<true>(c.kernel, *document_,
                                         std::min(batch, iterations - done),
                                         calls_, constants_);
        EndTask(*document_);
      }
      CHECK_EQ(checksum, iterations);
      const uint64_t entries = (iterations + batch - 1) / batch;
      CallCounts expected{};
      switch (c.kernel) {
        case kCreateElements:
          expected[kCreateElement] = iterations;
          break;
        case kCounterTrees:
          for (Call call :
               {kCreateElement, kCreateText, kAppendChild, kSetData})
            expected[call] = iterations;
          break;
        case kEventRoundTrips:
          for (Call call : {kBody, kAddListener, kRemoveListener})
            expected[call] = entries;
          expected[kClick] = iterations;
          break;
        case kCanvasRects:
          expected[kElementById] = entries;
          expected[kGetContext] = entries;
          expected[kFillRect] = iterations;
          break;
      }
      base::DictValue actual;
      for (size_t at = 0; at < kCallCount; ++at) {
        CHECK_EQ(calls_[at], expected[at]) << kCallNames[at];
        actual.Set(kCallNames[at], static_cast<double>(calls_[at]));
      }
      base::DictValue row;
      row.Set("kernel", c.kernel_name);
      row.Set("shape", NameOf(c.shape));
      row.Set("iterations", static_cast<int>(iterations));
      row.Set("checksum", static_cast<int>(checksum));
      row.Set("calls", std::move(actual));
      audits_.Append(std::move(row));
    }
  }
  void Record(const Case& c,
              double checksum,
              size_t allocations,
              double elapsed_ns,
              uint32_t iterations) {
    CHECK_EQ(checksum, static_cast<double>(iterations)) << c.kernel_name;
    if (round_ >= kWarm) {
      base::DictValue sample;
      sample.Set("kernel", c.kernel_name);
      sample.Set("shape", NameOf(c.shape));
      sample.Set("lane", NameOf(c.lane));
      sample.Set("round", static_cast<int>(round_ - kWarm));
      sample.Set("iterations", static_cast<int>(iterations));
      sample.Set("nsPerOperation", elapsed_ns / iterations);
      sample.Set("ntsAllocations", static_cast<double>(allocations));
      samples_.Append(std::move(sample));
    }
    executed_iterations_ += iterations;
    if (++round_ == kWarm + kMeasured) {
      round_ = 0;
      ++next_case_;
    }
  }

  // The checkpoint Blink's task epilogue runs, performed by the harness
  // because it, not the scheduler, ends each emulated task body.
  static void EndTask(blink::Document& document) {
    document.GetExecutionContext()
        ->GetAgent()
        ->event_loop()
        ->PerformMicrotaskCheckpoint();
  }

  // One common batch/entry path. The intrinsic body may inline normally;
  // it has no forced helper call or volatile function-pointer dispatch.
  double RunBatch(const Case& c, uint32_t count) {
    if (c.lane == Lane::kCompiled)
      return nts_chromium_kernel_run(probe_, context_, c.kernel, count);
    if (c.lane == Lane::kIntrinsic)
      return IntrinsicBatch<false>(c.kernel, *document_, count, calls_,
                                   constants_);
    CHECK(c.kernel == kCreateElements && c.shape == Shape::kLoop);
    uint32_t checksum = 0;
    for (uint32_t i = 0; i < count; ++i)
      checksum += CreateElementWithAtomLookupOnce(*document_);
    return checksum;
  }

  // Returns false when the sample runs asynchronously (task-call):
  // its handler records it and posts the next Step.
  bool Sample() {
    const Case& c = cases_[next_case_];
    if (c.shape == Shape::kTaskCall) {
      StartTaskCall();
      return false;
    }
    blink::Document& document = *document_;
    double checksum = 0;
    const uint32_t batch = BatchOf(c.shape);
    nts_chromium_counting_reset();
    nts_chromium_kernel_timing_begin();
    const auto start = base::TimeTicks::Now();
    for (uint32_t done = 0; done < kIterations; done += batch) {
      checksum += RunBatch(c, std::min(batch, kIterations - done));
      // Both native lanes emulate the same task epilogue. Real task-call
      // samples leave this checkpoint to Blink's scheduler on both lanes.
      EndTask(document);
    }
    const double elapsed_ns =
        (base::TimeTicks::Now() - start).InMicrosecondsF() * 1000;
    nts_chromium_kernel_timing_end();
    const size_t allocations = nts_chromium_counted_allocations();
    Record(c, checksum, allocations, elapsed_ns, kIterations);
    return true;
  }

  std::string Finish() {
    base::DictValue result;
    result.Set("samples", std::move(samples_));
    result.Set("audits", std::move(audits_));
    result.Set("auditOnly", audit_);
    result.Set("executedIterations", static_cast<double>(executed_iterations_));
    result.Set("warmupSamples", static_cast<int>(kWarm));
    result.Set("measuredSamples", static_cast<int>(kMeasured));
    result.Set("liveRoots", static_cast<double>(nts_blink_dom_roots()));
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
  base::ListValue audits_;
  std::vector<Case> cases_;
  const KernelConstants constants_;
  CallCounts calls_{};
  bool audit_ = false;
  uint64_t executed_iterations_ = 0;
  size_t next_case_ = 0;
  uint32_t round_ = 0;
  blink::Persistent<blink::MessageChannel> channel_;
  blink::Persistent<TaskCallListener> task_listener_;
  uint32_t task_left_ = 0;
  double task_checksum_ = 0;
  base::TimeTicks task_start_;
};

// Both native lanes use this MessageChannel handler: one posted task per
// iteration, the kernel called with 1, the next message posted from inside
// the handler. Their difference measures the compiled entry and bindings
// over Blink's own C++ directly, with identical channel machinery. The V8
// page has the same task shape as a reference.
class TaskCallListener final : public blink::NativeEventListener {
 public:
  explicit TaskCallListener(KernelsRun* run) : run_(run) {}
  void Invoke(blink::ExecutionContext*, blink::Event*) override {
    if (run_)
      run_->TaskCallOnce();
  }
  void Detach() { run_ = nullptr; }

 private:
  RAW_PTR_EXCLUSION KernelsRun* run_;
};

void KernelsRun::StartTaskCall() {
  blink::Document& document = *document_;
  auto* channel = blink::MessageChannel::Create(document.GetExecutionContext());
  channel_ = channel;
  auto* listener = blink::MakeGarbageCollected<TaskCallListener>(this);
  task_listener_ = listener;
  DEFINE_STATIC_LOCAL(const blink::AtomicString, type, ("message"));
  CHECK(channel->port1()->addEventListener(type, listener, false));
  channel->port1()->start();
  task_left_ = kTaskIterations;
  task_checksum_ = 0;
  nts_chromium_counting_reset();
  nts_chromium_kernel_timing_begin();
  task_start_ = base::TimeTicks::Now();
  PostTaskCallMessage();
}

void KernelsRun::PostTaskCallMessage() {
  blink::Document& document = *document_;
  auto* script_state = blink::ToScriptStateForMainWorld(document.GetFrame());
  blink::ScriptState::Scope scope(script_state);
  blink::DummyExceptionStateForTesting exception_state;
  channel_->port2()->postMessage(
      script_state, blink::ScriptValue::CreateNull(script_state->GetIsolate()),
      blink::PostMessageOptions::Create(), exception_state);
  CHECK(!exception_state.HadException());
}

void KernelsRun::TaskCallOnce() {
  const Case& c = cases_[next_case_];
  task_checksum_ += RunBatch(c, 1);
  if (--task_left_ > 0) {
    PostTaskCallMessage();
    return;
  }
  const double elapsed_ns =
      (base::TimeTicks::Now() - task_start_).InMicrosecondsF() * 1000;
  nts_chromium_kernel_timing_end();
  const size_t allocations = nts_chromium_counted_allocations();
  task_listener_->Detach();
  task_listener_.Clear();
  channel_->port1()->close();
  channel_->port2()->close();
  channel_.Clear();
  Record(cases_[next_case_], task_checksum_, allocations, elapsed_ns,
         kTaskIterations);
  Post(std::move(*ActiveTaskCall()));
}
}  // namespace

void StartKernelsBenchmark(const blink::WebDocument& web_document,
                           NtsDomContext* context,
                           NtsChromiumProbe* probe,
                           base::OnceCallback<void(std::string)> done) {
  KernelsRun::Post(
      std::make_unique<KernelsRun>(static_cast<blink::Document*>(web_document),
                                   context, probe, std::move(done)));
}
}  // namespace nts_chromium
