#ifndef NTS_CHROMIUM_APP_SCHEME_H_
#define NTS_CHROMIUM_APP_SCHEME_H_

#include "base/files/file_path.h"
#include "content/public/common/content_client.h"
#include "mojo/public/cpp/bindings/pending_remote.h"
#include "services/network/public/mojom/url_loader_factory.mojom-forward.h"

// An app is served from its own origin, nts-app://app, not from file URLs:
// a standard, secure scheme, so the page is a secure context with an origin
// of its own (storage, CORS and permissions key on it), and its URLs resolve
// relative to the app's directory, which the shell is given with
// --nts-app-dir. Shared by every shell that runs an app.
namespace nts_chromium {

inline constexpr char kAppScheme[] = "nts-app";
inline constexpr char kAppHost[] = "app";
inline constexpr char kAppDirectorySwitch[] = "nts-app-dir";

// The scheme, as each process's ContentClient registers it.
void AddAppScheme(content::ContentClient::Schemes* schemes);

// The app's directory from --nts-app-dir, made absolute; empty without it.
base::FilePath AppDirectory();

// A factory serving nts-app://app/<path> from `root`.
mojo::PendingRemote<network::mojom::URLLoaderFactory> CreateAppURLLoaderFactory(
    const base::FilePath& root);

// What the browser does once its features exist: lets renderers request and
// commit the app's URLs, as they may http's.
void RegisterAppSchemeInBrowser();

// What a renderer does as its thread starts: fetch() of the app's files.
void RegisterAppSchemeInRenderer();

}  // namespace nts_chromium

#endif  // NTS_CHROMIUM_APP_SCHEME_H_
