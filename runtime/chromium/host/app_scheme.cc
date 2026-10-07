#include "nts/app_scheme.h"

#include <optional>
#include <string>
#include <utility>

#include "base/command_line.h"
#include "base/files/file_util.h"
#include "base/memory/self_deleting.h"
#include "base/strings/escape.h"
#include "content/public/browser/child_process_security_policy.h"
#include "content/public/browser/file_url_loader.h"
#include "mojo/public/cpp/bindings/pending_receiver.h"
#include "mojo/public/cpp/bindings/remote.h"
#include "net/base/filename_util.h"
#include "net/base/net_errors.h"
#include "services/network/public/cpp/resource_request.h"
#include "services/network/public/cpp/self_deleting_url_loader_factory.h"
#include "services/network/public/cpp/url_loader_completion_status.h"
#include "services/network/public/mojom/url_loader.mojom.h"
#include "third_party/blink/public/platform/web_string.h"
#include "third_party/blink/public/web/web_security_policy.h"
#include "url/gurl.h"

namespace nts_chromium {
namespace {

// nts-app://app/<path> as the file <path> under the app's directory, through
// content's file loader (MIME type by extension, ranges, no directory
// listing). The URL's path has been canonicalized, so it holds no "..";
// what still names a parent is refused rather than resolved.
class AppURLLoaderFactory final : public network::SelfDeletingURLLoaderFactory {
 public:
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

}  // namespace

void AddAppScheme(content::ContentClient::Schemes* schemes) {
  schemes->standard_schemes.push_back(kAppScheme);
  schemes->secure_schemes.push_back(kAppScheme);
  schemes->cors_enabled_schemes.push_back(kAppScheme);
}

base::FilePath AppDirectory() {
  base::FilePath root =
      base::CommandLine::ForCurrentProcess()->GetSwitchValuePath(
          kAppDirectorySwitch);
  return root.empty() ? root : base::MakeAbsoluteFilePath(root);
}

mojo::PendingRemote<network::mojom::URLLoaderFactory> CreateAppURLLoaderFactory(
    const base::FilePath& root) {
  mojo::PendingRemote<network::mojom::URLLoaderFactory> remote;
  base::MakeSelfDeleting<AppURLLoaderFactory>(
      root, remote.InitWithNewPipeAndPassReceiver());
  return remote;
}

void RegisterAppSchemeInBrowser() {
  content::ChildProcessSecurityPolicy::GetInstance()->RegisterWebSafeScheme(
      kAppScheme);
}

void RegisterAppSchemeInRenderer() {
  // Blink's fetch takes http(s) and the schemes registered for it, as Chrome
  // registers its extensions'.
  blink::WebSecurityPolicy::RegisterURLSchemeAsSupportingFetchAPI(
      blink::WebString::FromAscii(kAppScheme));
}

}  // namespace nts_chromium
