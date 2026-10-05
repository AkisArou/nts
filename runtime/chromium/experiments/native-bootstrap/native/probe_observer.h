#ifndef NTS_CHROMIUM_EXPERIMENT_PROBE_OBSERVER_H_
#define NTS_CHROMIUM_EXPERIMENT_PROBE_OBSERVER_H_

namespace content {
class RenderFrame;
}

namespace nts_chromium {
// The observer owns itself through RenderFrameObserver::OnDestruct.
void AttachProbe(content::RenderFrame* frame);
}  // namespace nts_chromium

#endif
