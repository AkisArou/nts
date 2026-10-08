#ifndef NTS_APP_PERMISSIONS_H_
#define NTS_APP_PERMISSIONS_H_

#include <vector>

#include "base/functional/callback_forward.h"
#include "content/public/browser/permission_controller_delegate.h"
#include "content/public/browser/permission_result.h"

namespace nts_chromium {

// The release shell's permission policy. The app is the shell's own code,
// served from its own origin (app_scheme.h), and there is no prompt to ask
// anyone: the app's top-level documents are granted what an app needs
// without one -- the clipboard, read and write -- and everything else is
// denied, to the app and to every other origin, as a shell with no delegate
// denies it. Nothing is remembered, so nothing is reset.
class AppPermissions final : public content::PermissionControllerDelegate {
 public:
  AppPermissions() = default;
  AppPermissions(const AppPermissions&) = delete;
  AppPermissions& operator=(const AppPermissions&) = delete;
  ~AppPermissions() override = default;

  void RequestPermissionsFromCurrentDocument(
      content::RenderFrameHost* render_frame_host,
      const content::PermissionRequestDescription& request_description,
      base::OnceCallback<void(const std::vector<content::PermissionResult>&)>
          callback) override;
  blink::mojom::PermissionStatus GetPermissionStatus(
      const blink::mojom::PermissionDescriptorPtr& permission_descriptor,
      const GURL& requesting_origin,
      const GURL& embedding_origin) override;
  content::PermissionResult GetPermissionResultForOriginWithoutContext(
      const blink::mojom::PermissionDescriptorPtr& permission_descriptor,
      const url::Origin& requesting_origin,
      const url::Origin& embedding_origin) override;
  content::PermissionResult GetPermissionResultForCurrentDocument(
      const blink::mojom::PermissionDescriptorPtr& permission_descriptor,
      content::RenderFrameHost* render_frame_host,
      bool should_include_device_status) override;
  content::PermissionResult GetPermissionResultForWorker(
      const blink::mojom::PermissionDescriptorPtr& permission_descriptor,
      content::RenderProcessHost* render_process_host,
      const GURL& worker_origin) override;
  content::PermissionResult GetPermissionResultForEmbeddedRequester(
      const blink::mojom::PermissionDescriptorPtr& permission_descriptor,
      content::RenderFrameHost* render_frame_host,
      const url::Origin& requesting_origin) override;
  void ResetPermission(blink::PermissionType permission,
                       const GURL& requesting_origin,
                       const GURL& embedding_origin) override {}
};

}  // namespace nts_chromium

#endif  // NTS_APP_PERMISSIONS_H_
