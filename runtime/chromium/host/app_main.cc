// The test shell an app runs in (`nts_app`, testonly): upstream
// content_shell's startup, sandbox, resources and DevTools, through the
// client factories a derived embedder may replace, with the app's scheme
// (app_scheme.h) and the app attached to every frame. The release shell,
// with none of content_shell, is shell_main.cc. No Chromium file is patched.
#include <memory>
#include <optional>
#include <string>
#include <utility>

#include "base/files/file_path.h"
#include "content/public/app/content_main.h"
#include "content/public/browser/browser_main_parts.h"
#include "content/shell/app/shell_main_delegate.h"
#include "content/shell/browser/shell_content_browser_client.h"
#include "content/shell/common/shell_content_client.h"
#include "content/shell/renderer/shell_content_renderer_client.h"
#include "nts/app_observer.h"
#include "nts/app_scheme.h"
#include "url/gurl.h"

namespace nts_chromium {
namespace {

// The scheme registered in every process: the ContentClient is shared.
class AppContentClient final : public content::ShellContentClient {
 public:
  void AddAdditionalSchemes(Schemes* schemes) override {
    ShellContentClient::AddAdditionalSchemes(schemes);
    AddAppScheme(schemes);
  }
};

class AppBrowserClient final : public content::ShellContentBrowserClient {
 public:
  explicit AppBrowserClient(base::FilePath root) : root_(std::move(root)) {}

  std::unique_ptr<content::BrowserMainParts> CreateBrowserMainParts(
      bool is_integration_test) override {
    // Here rather than at construction: the policy reads features, which
    // exist from browser main on.
    RegisterAppSchemeInBrowser();
    return ShellContentBrowserClient::CreateBrowserMainParts(
        is_integration_test);
  }

  bool IsHandledURL(const GURL& url) override {
    return url.SchemeIs(kAppScheme) ||
           ShellContentBrowserClient::IsHandledURL(url);
  }

  mojo::PendingRemote<network::mojom::URLLoaderFactory>
  CreateNonNetworkNavigationURLLoaderFactory(
      const std::string& scheme,
      content::FrameTreeNodeId frame_tree_node_id) override {
    if (scheme == kAppScheme && !root_.empty())
      return CreateAppURLLoaderFactory(root_);
    return ShellContentBrowserClient::
        CreateNonNetworkNavigationURLLoaderFactory(scheme, frame_tree_node_id);
  }

  void RegisterNonNetworkSubresourceURLLoaderFactories(
      int render_process_id,
      int render_frame_id,
      const std::optional<url::Origin>& request_initiator_origin,
      NonNetworkURLLoaderFactoryMap* factories) override {
    ShellContentBrowserClient::RegisterNonNetworkSubresourceURLLoaderFactories(
        render_process_id, render_frame_id, request_initiator_origin,
        factories);
    if (!root_.empty())
      factories->emplace(kAppScheme, CreateAppURLLoaderFactory(root_));
  }

 private:
  // Empty without --nts-app-dir: the scheme is registered but serves nothing.
  const base::FilePath root_;
};

class AppRendererClient final : public content::ShellContentRendererClient {
 public:
  AppRendererClient() : ShellContentRendererClient(false) {}

  void RenderThreadStarted() override {
    ShellContentRendererClient::RenderThreadStarted();
    RegisterAppSchemeInRenderer();
  }

  void RenderFrameCreated(content::RenderFrame* frame) override {
    ShellContentRendererClient::RenderFrameCreated(frame);
    AttachApp(frame);
  }
};

class AppMainDelegate final : public content::ShellMainDelegate {
 public:
  // The shell's own members hold them: its startup calls into the browser
  // client it made.
  content::ContentClient* CreateContentClient() override {
    content_client_ = std::make_unique<AppContentClient>();
    return content_client_.get();
  }
  content::ContentBrowserClient* CreateContentBrowserClient() override {
    browser_client_ = std::make_unique<AppBrowserClient>(AppDirectory());
    return browser_client_.get();
  }
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
