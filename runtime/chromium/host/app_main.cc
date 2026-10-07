#include <memory>
#include <optional>
#include <string>
#include <utility>

#include "base/command_line.h"
#include "base/files/file_path.h"
#include "base/files/file_util.h"
#include "base/memory/self_deleting.h"
#include "base/strings/escape.h"
#include "content/public/app/content_main.h"
#include "content/public/browser/browser_main_parts.h"
#include "content/public/browser/child_process_security_policy.h"
#include "content/public/browser/file_url_loader.h"
#include "content/shell/app/shell_main_delegate.h"
#include "content/shell/browser/shell_content_browser_client.h"
#include "content/shell/common/shell_content_client.h"
#include "content/shell/renderer/shell_content_renderer_client.h"
#include "mojo/public/cpp/bindings/pending_receiver.h"
#include "mojo/public/cpp/bindings/pending_remote.h"
#include "mojo/public/cpp/bindings/remote.h"
#include "net/base/filename_util.h"
#include "net/base/net_errors.h"
#include "nts/app_observer.h"
#include "services/network/public/cpp/resource_request.h"
#include "services/network/public/cpp/self_deleting_url_loader_factory.h"
#include "services/network/public/cpp/url_loader_completion_status.h"
#include "services/network/public/mojom/url_loader.mojom.h"
#include "third_party/blink/public/platform/web_string.h"
#include "third_party/blink/public/web/web_security_policy.h"
#include "url/gurl.h"

namespace nts_chromium {
namespace {

// An app is served from its own origin, nts-app://app, not from file URLs:
// a standard, secure scheme, so the page is a secure context with an origin
// of its own (storage, CORS and permissions key on it), and its URLs resolve
// relative to the app's directory, which the shell is given with
// --nts-app-dir.
constexpr char kAppScheme[] = "nts-app";
constexpr char kAppHost[] = "app";
constexpr char kAppDirectorySwitch[] = "nts-app-dir";

// The scheme registered in every process: the ContentClient is shared.
class AppContentClient final : public content::ShellContentClient {
 public:
  void AddAdditionalSchemes(Schemes* schemes) override {
    ShellContentClient::AddAdditionalSchemes(schemes);
    schemes->standard_schemes.push_back(kAppScheme);
    schemes->secure_schemes.push_back(kAppScheme);
    schemes->cors_enabled_schemes.push_back(kAppScheme);
  }
};

// nts-app://app/<path> as the file <path> under the app's directory, through
// content's file loader (MIME type by extension, ranges, no directory
// listing). The URL's path has been canonicalized, so it holds no "..";
// what still names a parent is refused rather than resolved.
class AppURLLoaderFactory final : public network::SelfDeletingURLLoaderFactory {
 public:
  static mojo::PendingRemote<network::mojom::URLLoaderFactory> Create(
      const base::FilePath& root) {
    mojo::PendingRemote<network::mojom::URLLoaderFactory> remote;
    base::MakeSelfDeleting<AppURLLoaderFactory>(
        root, remote.InitWithNewPipeAndPassReceiver());
    return remote;
  }

  AppURLLoaderFactory(
      const base::FilePath& root,
      mojo::PendingReceiver<network::mojom::URLLoaderFactory> receiver,
      base::SelfDeletingPassKey key)
      : SelfDeletingURLLoaderFactory(std::move(receiver), key), root_(root) {}

 private:
  ~AppURLLoaderFactory() override = default;

  void CreateLoaderAndStart(
      mojo::PendingReceiver<network::mojom::URLLoader> loader,
      int32_t request_id,
      uint32_t options,
      const network::ResourceRequest& request,
      mojo::PendingRemote<network::mojom::URLLoaderClient> client,
      const net::MutableNetworkTrafficAnnotationTag& traffic_annotation)
      override {
    const std::optional<base::FilePath> path = FileFor(request.url);
    if (!path) {
      mojo::Remote<network::mojom::URLLoaderClient>(std::move(client))
          ->OnComplete(
              network::URLLoaderCompletionStatus(net::ERR_FILE_NOT_FOUND));
      return;
    }
    network::ResourceRequest file_request = request;
    file_request.url = net::FilePathToFileURL(*path);
    content::CreateFileURLLoaderBypassingSecurityChecks(
        file_request, std::move(loader), std::move(client),
        /*observer=*/nullptr, /*allow_directory_listing=*/false);
  }

  std::optional<base::FilePath> FileFor(const GURL& url) const {
    if (!url.SchemeIs(kAppScheme) || url.host() != kAppHost)
      return std::nullopt;
    std::string relative =
        base::UnescapeBinaryURLComponent(url.path().substr(1));
    if (relative.empty())
      relative = "index.html";
    const base::FilePath path = base::FilePath::FromUTF8Unsafe(relative);
    if (path.IsAbsolute() || path.ReferencesParent())
      return std::nullopt;
    return root_.Append(path);
  }

  const base::FilePath root_;
};

class AppBrowserClient final : public content::ShellContentBrowserClient {
 public:
  explicit AppBrowserClient(base::FilePath root) : root_(std::move(root)) {}

  std::unique_ptr<content::BrowserMainParts> CreateBrowserMainParts(
      bool is_integration_test) override {
    // Renderers may request and commit the app's URLs, as they may http's.
    // Here rather than at construction: the policy reads features, which
    // exist from browser main on.
    content::ChildProcessSecurityPolicy::GetInstance()->RegisterWebSafeScheme(
        kAppScheme);
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
      return AppURLLoaderFactory::Create(root_);
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
      factories->emplace(kAppScheme, AppURLLoaderFactory::Create(root_));
  }

 private:
  // Empty without --nts-app-dir: the scheme is registered but serves nothing.
  const base::FilePath root_;
};

// The shell an app runs in: upstream content_shell's startup, sandbox and
// resources, through the client factories a derived embedder may replace,
// with the app attached to every frame. No Chromium file is patched.
class AppRendererClient final : public content::ShellContentRendererClient {
 public:
  AppRendererClient() : ShellContentRendererClient(false) {}

  void RenderThreadStarted() override {
    ShellContentRendererClient::RenderThreadStarted();
    // fetch() of the app's own files: Blink's fetch takes http(s) and the
    // schemes registered for it, as Chrome registers its extensions'.
    blink::WebSecurityPolicy::RegisterURLSchemeAsSupportingFetchAPI(
        blink::WebString::FromAscii(kAppScheme));
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
    base::FilePath root = base::CommandLine::ForCurrentProcess()
                              ->GetSwitchValuePath(kAppDirectorySwitch);
    if (!root.empty())
      root = base::MakeAbsoluteFilePath(root);
    browser_client_ = std::make_unique<AppBrowserClient>(std::move(root));
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
