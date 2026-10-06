#ifndef NTS_CHROMIUM_HOST_APP_OBSERVER_H_
#define NTS_CHROMIUM_HOST_APP_OBSERVER_H_

namespace content {
class RenderFrame;
}

namespace nts_chromium {

// Runs the linked app (host/app.h) in every main-frame document that opts in
// with <meta name="nts-app">, from DOMContentLoaded until the document ends.
void AttachApp(content::RenderFrame* frame);

}  // namespace nts_chromium

#endif
