#include <memory>
#include <utility>

#include "content/public/app/content_main.h"
#include "content/shell/app/shell_main_delegate.h"
#include "content/shell/browser/shell_content_browser_client.h"
#include "content/shell/renderer/shell_content_renderer_client.h"
#include "nts/app_observer.h"

namespace nts_chromium {
namespace {

// The shell an app runs in: upstream content_shell's startup, sandbox and
// resources, through the client factories a derived embedder may replace,
// with the app attached to every frame. No Chromium file is patched.
class AppRendererClient final : public content::ShellContentRendererClient {
 public:
  AppRendererClient() : ShellContentRendererClient(false) {}

  void RenderFrameCreated(content::RenderFrame* frame) override {
    ShellContentRendererClient::RenderFrameCreated(frame);
    AttachApp(frame);
  }
};

class AppMainDelegate final : public content::ShellMainDelegate {
 public:
  content::ContentRendererClient* CreateContentRendererClient() override {
    renderer_client_ = std::make_unique<AppRendererClient>();
    return renderer_client_.get();
  }
};

}  // namespace
}  // namespace nts_chromium

int main(int argc, const char** argv) {
  nts_chromium::AppMainDelegate delegate;
  content::ContentMainParams params(&delegate);
  params.argc = argc;
  params.argv = argv;
  return content::ContentMain(std::move(params));
}
