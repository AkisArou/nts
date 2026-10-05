#include "nts/probe_observer.h"

#include <memory>

#include "base/check.h"
#include "base/command_line.h"
#include "base/functional/bind.h"
#include "base/functional/callback_helpers.h"
#include "base/logging.h"
#include "base/memory/weak_ptr.h"
#include "base/strings/string_number_conversions.h"
#include "content/public/renderer/render_frame.h"
#include "content/public/renderer/render_frame_observer.h"
#include "content/public/renderer/render_thread.h"
#include "nts/binding_benchmark.h"
#include "nts/kernels_benchmark.h"
#include "nts/rows_benchmark.h"
#include "nts/dom_bridge_bindings.h"
#include "nts/probe.h"
#include "third_party/blink/public/platform/web_string.h"
#include "third_party/blink/public/web/web_document.h"
#include "third_party/blink/public/web/web_element.h"
#include "third_party/blink/public/web/web_local_frame.h"
#include "url/gurl.h"

namespace nts_chromium {
namespace {

class ProbeObserver final : public content::RenderFrameObserver {
 public:
  explicit ProbeObserver(content::RenderFrame* frame)
      : content::RenderFrameObserver(frame) {}
  ~ProbeObserver() override { Dispose(); }

 private:
  void OnDestruct() override { delete this; }
  void DidCreateNewDocument() override { Dispose(); }
  void WillReleaseScriptContext(v8::Local<v8::Context>,
                                int32_t world_id) override {
    if (world_id == 0) {
      Dispose();
    }
  }
  void WillDetach(blink::DetachReason) override { Dispose(); }

  void DidFinishLoad() override {
    CHECK(content::RenderThread::IsMainThread());
    auto* frame = render_frame()->GetWebFrame();
    if (frame->Parent() || probe_) {
      return;
    }
    const auto& command = *base::CommandLine::ForCurrentProcess();
    const GURL selected(command.GetSwitchValueASCII("nts-probe-url"));
    const GURL committed(frame->GetDocument().Url());
    if (!selected.is_valid() || !selected.SchemeIsFile() ||
        committed != selected) {
      return;
    }
    // A file fixture opt-in for E1, not a packaged-origin authorization model.
    probe_.reset(nts_chromium_probe_create());
    const auto result = nts_chromium_probe_run(probe_.get());
    CHECK(result.scalar == 50.0);
    CHECK(result.text_matches);
    CHECK(result.live_objects_before == result.live_objects_after);
    LOG(INFO) << "NTS_PROBE attach backend=" << NTS_CHROMIUM_PROBE_BACKEND
              << " scalar=" << result.scalar
              << " text=native:probe live=" << result.live_objects_after;

    // A bounded public-API input witness, not a general DOM binding surface.
    // The ordinary E1 fixture has neither of these native-counter elements.
    const auto document = frame->GetDocument();
    auto rows = document.GetElementById(
        blink::WebString::FromAscii("native-rows-run"));
    if (!rows.IsNull()) {
      dom_.reset(CreateDomContext(document));
      // Idle-time collection is the architecture under test;
      // --nts-collection=checkpoint keeps the runtime default for an A/B.
      if (command.GetSwitchValueASCII("nts-collection") != "checkpoint")
        nts_chromium_probe_install_host(probe_.get(), dom_.get());
      counter_output_ = document.GetElementById(
          blink::WebString::FromAscii("benchmark-result"));
      CHECK(!counter_output_.IsNull());
      counter_listener_ = rows.AddEventListener(
          blink::WebNode::EventType::kInput,
          base::BindRepeating(&ProbeObserver::RunRows,
                              weak_factory_.GetWeakPtr()));
      counter_output_.SetAttribute(blink::WebString::FromAscii("data-state"),
                                   blink::WebString::FromAscii("ready"));
      return;
    }
    auto kernels = document.GetElementById(
        blink::WebString::FromAscii("native-kernels-run"));
    if (!kernels.IsNull()) {
      dom_.reset(CreateDomContext(document));
      if (command.GetSwitchValueASCII("nts-collection") != "checkpoint")
        nts_chromium_probe_install_host(probe_.get(), dom_.get());
      counter_output_ = document.GetElementById(
          blink::WebString::FromAscii("benchmark-result"));
      CHECK(!counter_output_.IsNull());
      counter_listener_ = kernels.AddEventListener(
          blink::WebNode::EventType::kInput,
          base::BindRepeating(&ProbeObserver::RunKernels,
                              weak_factory_.GetWeakPtr()));
      counter_output_.SetAttribute(blink::WebString::FromAscii("data-state"),
                                   blink::WebString::FromAscii("ready"));
      return;
    }
    auto benchmark = document.GetElementById(
        blink::WebString::FromAscii("native-benchmark-run"));
    if (!benchmark.IsNull()) {
      dom_.reset(CreateDomContext(document));
      counter_output_ = document.GetElementById(
          blink::WebString::FromAscii("benchmark-result"));
      CHECK(!counter_output_.IsNull());
      counter_listener_ = benchmark.AddEventListener(
          blink::WebNode::EventType::kInput,
          base::BindRepeating(&ProbeObserver::RunBenchmark,
                              weak_factory_.GetWeakPtr()));
      counter_output_.SetAttribute(blink::WebString::FromAscii("data-state"),
                                   blink::WebString::FromAscii("ready"));
      return;
    }
    if (!document
             .GetElementById(blink::WebString::FromAscii("native-dom-start"))
             .IsNull()) {
      dom_.reset(CreateDomContext(document));
      const double dom_result =
          nts_chromium_probe_dom_run(probe_.get(), dom_.get());
      CHECK_EQ(dom_result, 0.0)
          << "NTS DOM program failed at witness " << dom_result;
      LOG(INFO) << "NTS_DOM backend=" << NTS_CHROMIUM_PROBE_BACKEND
                << " result=" << dom_result
                << " roots=" << nts_blink_dom_roots();
    }
    auto input = document.GetElementById(
        blink::WebString::FromAscii("native-increment"));
    counter_output_ = document.GetElementById(blink::WebString::FromAscii(
        dom_ ? "native-dom-count" : "native-count"));
    CHECK(input.IsNull() == counter_output_.IsNull());
    if (!input.IsNull()) {
      nts_chromium_probe_counter_initialize(probe_.get());
      microtasks_ =
          !document.GetElementById(blink::WebString::FromAscii("native-jobs"))
               .IsNull();
      if (microtasks_)
        nts_chromium_probe_install_microtasks(probe_.get(), dom_.get());
      counter_listener_ = input.AddEventListener(
          blink::WebNode::EventType::kInput,
          base::BindRepeating(&ProbeObserver::IncrementCounter,
                              weak_factory_.GetWeakPtr()));
    }
  }

  void IncrementCounter(blink::WebDOMEvent) {
    CHECK(content::RenderThread::IsMainThread());
    CHECK(probe_);
    CHECK(!counter_output_.IsNull());
    if (microtasks_) {
      nts_blink_dom_callback(
          dom_.get(),
          [](void* state) {
            auto* observer = static_cast<ProbeObserver*>(state);
            nts_chromium_probe_await_counter(observer->probe_.get());
          },
          this);
      return;
    }
    const auto result = nts_chromium_probe_counter_increment(probe_.get());
    CHECK(result.live_objects_before == 1);
    CHECK(result.live_objects_after == 1);
    if (dom_) {
      nts_chromium_probe_dom_counter(probe_.get(), dom_.get(), result.count);
    } else {
      counter_output_.SetAttribute(
          blink::WebString::FromAscii("data-count"),
          blink::WebString::FromAscii(base::NumberToString(result.count)));
    }
    LOG(INFO) << "NTS_COUNTER backend=" << NTS_CHROMIUM_PROBE_BACKEND
              << " count=" << result.count
              << " live=" << result.live_objects_after;
  }

  void RunRows(blink::WebDOMEvent) {
    CHECK(probe_ && dom_);
    StartRowsBenchmark(render_frame()->GetWebFrame()->GetDocument(), dom_.get(),
                       probe_.get(),
                       base::BindOnce(&ProbeObserver::WorkloadDone,
                                      weak_factory_.GetWeakPtr()));
  }

  void RunKernels(blink::WebDOMEvent) {
    CHECK(probe_ && dom_);
    StartKernelsBenchmark(render_frame()->GetWebFrame()->GetDocument(),
                          dom_.get(), probe_.get(),
                          base::BindOnce(&ProbeObserver::WorkloadDone,
                                         weak_factory_.GetWeakPtr()));
  }

  void WorkloadDone(std::string result) {
    counter_output_.SetAttribute(blink::WebString::FromAscii("data-result"),
                                 blink::WebString::FromUtf8(result));
    counter_output_.SetAttribute(blink::WebString::FromAscii("data-state"),
                                 blink::WebString::FromAscii("done"));
    LOG(INFO) << "NTS_WORKLOAD done backend=" << NTS_CHROMIUM_PROBE_BACKEND;
  }

  void RunBenchmark(blink::WebDOMEvent) {
    CHECK(probe_ && dom_);
    uint32_t order = 0;
    const auto value =
        base::CommandLine::ForCurrentProcess()->GetSwitchValueASCII(
            "nts-benchmark-order");
    if (!value.empty())
      CHECK(base::StringToUint(value, &order));
    const auto result =
        RunBindingBenchmark(render_frame()->GetWebFrame()->GetDocument(),
                            dom_.get(), probe_.get(), order);
    counter_output_.SetAttribute(blink::WebString::FromAscii("data-result"),
                                 blink::WebString::FromUtf8(result));
    counter_output_.SetAttribute(blink::WebString::FromAscii("data-state"),
                                 blink::WebString::FromAscii("done"));
    LOG(INFO) << "NTS_BENCH done backend=" << NTS_CHROMIUM_PROBE_BACKEND;
  }

  void Dispose() {
    if (probe_) {
      CHECK(content::RenderThread::IsMainThread());
      // Revoke callbacks and release Blink roots before the NTS environment.
      weak_factory_.InvalidateWeakPtrs();
      counter_listener_.RunAndReset();
      counter_output_.Reset();
      // Drop a managed host task retaining the compiled counter before its
      // environment closes. Generated await tasks still lack drop callbacks.
      if (microtasks_)
        nts_chromium_probe_teardown_witness(probe_.get());
      dom_.reset();
      microtasks_ = false;
      probe_.reset();
      LOG(INFO) << "NTS_PROBE dispose backend=" << NTS_CHROMIUM_PROBE_BACKEND;
    }
  }

  std::unique_ptr<NtsChromiumProbe, decltype(&nts_chromium_probe_destroy)>
      probe_{nullptr, &nts_chromium_probe_destroy};
  blink::WebElement counter_output_;
  std::unique_ptr<NtsDomContext, decltype(&nts_blink_dom_destroy)> dom_{
      nullptr, &nts_blink_dom_destroy};
  base::ScopedClosureRunner counter_listener_;
  bool microtasks_ = false;
  base::WeakPtrFactory<ProbeObserver> weak_factory_{this};
};

}  // namespace

void AttachProbe(content::RenderFrame* frame) {
  new ProbeObserver(frame);
}

}  // namespace nts_chromium
