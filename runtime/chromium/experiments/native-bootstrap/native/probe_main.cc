#include <memory>
#include <utility>

#include "base/command_line.h"
#include "content/public/app/content_main.h"
#include "content/public/common/content_switches.h"
#include "content/shell/app/shell_main_delegate.h"
#include "content/shell/browser/shell_content_browser_client.h"
#include "content/shell/renderer/shell_content_renderer_client.h"
#include "nts/probe_observer.h"

namespace nts_chromium {
namespace {

class ProbeBrowserClient final : public content::ShellContentBrowserClient {
 public:
  void AppendExtraCommandLineSwitches(base::CommandLine* child,
                                      int child_process_id) override {
    ShellContentBrowserClient::AppendExtraCommandLineSwitches(child,
                                                              child_process_id);
    const auto& browser = *base::CommandLine::ForCurrentProcess();
    if (child->GetSwitchValueASCII(switches::kProcessType) ==
            switches::kRendererProcess &&
        browser.HasSwitch("nts-probe-url")) {
      child->AppendSwitchASCII("nts-probe-url",
                               browser.GetSwitchValueASCII("nts-probe-url"));
      for (const char* name : {"nts-benchmark-order", "nts-collection"}) {
        if (browser.HasSwitch(name))
          child->AppendSwitchASCII(name, browser.GetSwitchValueASCII(name));
      }
    }
  }
};

class ProbeRendererClient final : public content::ShellContentRendererClient {
 public:
  ProbeRendererClient() : ShellContentRendererClient(false) {}

  void RenderFrameCreated(content::RenderFrame* frame) override {
    ShellContentRendererClient::RenderFrameCreated(frame);
    AttachProbe(frame);
  }
};

// Reuse the upstream experiment shell's startup, sandbox and resource setup.
// The client factories are an existing extension point for derived embedders;
// no Chromium client implementations or build files need to be patched.
class ProbeMainDelegate final : public content::ShellMainDelegate {
 public:
  content::ContentBrowserClient* CreateContentBrowserClient() override {
    browser_client_ = std::make_unique<ProbeBrowserClient>();
    return browser_client_.get();
  }

  content::ContentRendererClient* CreateContentRendererClient() override {
    renderer_client_ = std::make_unique<ProbeRendererClient>();
    return renderer_client_.get();
  }
};

}  // namespace
}  // namespace nts_chromium

int main(int argc, const char** argv) {
  nts_chromium::ProbeMainDelegate delegate;
  content::ContentMainParams params(&delegate);
  params.argc = argc;
  params.argv = argv;
  return content::ContentMain(std::move(params));
}
