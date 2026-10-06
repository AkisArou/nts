#include "nts/app_observer.h"

#include <memory>
#include <utility>

#include "base/check.h"
#include "base/logging.h"
#include "base/memory/raw_ptr.h"
#include "content/public/renderer/render_frame.h"
#include "content/public/renderer/render_frame_observer.h"
#include "content/public/renderer/render_thread.h"
#include "nts/app.h"
#include "nts/dom_bridge_bindings.h"
#include "third_party/blink/public/platform/web_string.h"
#include "third_party/blink/public/web/web_document.h"
#include "third_party/blink/public/web/web_element.h"
#include "third_party/blink/public/web/web_local_frame.h"

namespace nts_chromium {
namespace {

class AppObserver final : public content::RenderFrameObserver {
 public:
  explicit AppObserver(content::RenderFrame* frame)
      : content::RenderFrameObserver(frame) {}
  ~AppObserver() override { Stop(); }

 private:
  void OnDestruct() override { delete this; }

  // DOMContentLoaded, where page script's deferred scripts have run: the
  // document is parsed and the app's markup is there to find.
  void DidDispatchDOMContentLoadedEvent() override {
    blink::WebLocalFrame* frame = render_frame()->GetWebFrame();
    if (app_ || !frame || frame->Parent())
      return;
    blink::WebDocument document = frame->GetDocument();
    if (document
            .QuerySelector(blink::WebString::FromAscii("meta[name=\"nts-app\"]"))
            .IsNull())
      return;
    CHECK(content::RenderThread::IsMainThread());
    dom_.reset(CreateDomContext(document));
    app_ = nts_chromium_app_start(dom_.get());
    LOG(INFO) << "NTS_APP start";
  }

  // The document ends: a new one replaces it, its main world's context goes,
  // or the frame detaches.
  void DidCreateNewDocument() override { Stop(); }
  void WillReleaseScriptContext(v8::Local<v8::Context>,
                                int32_t world_id) override {
    if (world_id == 0)
      Stop();
  }
  void WillDetach(blink::DetachReason) override { Stop(); }

  // In the order the host needs: `unload` while the document can be read;
  // then the context closes, giving back every closure the program lent it
  // through the host that is still there; then the program's environment.
  void Stop() {
    if (!app_)
      return;
    nts_chromium_app_unload(app_);
    dom_.reset();
    nts_chromium_app_destroy(std::exchange(app_, nullptr));
    LOG(INFO) << "NTS_APP stop";
  }

  std::unique_ptr<NtsDomContext, decltype(&nts_blink_dom_destroy)> dom_{
      nullptr, &nts_blink_dom_destroy};
  raw_ptr<NtsChromiumApp> app_ = nullptr;
};

}  // namespace

void AttachApp(content::RenderFrame* frame) {
  new AppObserver(frame);
}

}  // namespace nts_chromium
