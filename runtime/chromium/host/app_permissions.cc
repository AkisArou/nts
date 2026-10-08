#include "nts/app_permissions.h"

#include <utility>

#include "base/functional/callback.h"
#include "content/public/browser/permission_request_description.h"
#include "content/public/browser/render_frame_host.h"
#include "nts/app_scheme.h"
#include "third_party/blink/public/common/permissions/permission_utils.h"
#include "url/gurl.h"
#include "url/origin.h"

namespace nts_chromium {
namespace {

using blink::mojom::PermissionStatus;

bool IsApp(const url::Origin& origin) {
  return origin.scheme() == kAppScheme && origin.host() == kAppHost;
}

// What the app is granted without a prompt.
bool Granted(blink::PermissionType type) {
  switch (type) {
    case blink::PermissionType::CLIPBOARD_READ_WRITE:
    case blink::PermissionType::CLIPBOARD_SANITIZED_WRITE:
      return true;
    default:
      return false;
  }
}

PermissionStatus StatusFor(
    const blink::mojom::PermissionDescriptorPtr& descriptor,
    const url::Origin& requesting,
    const url::Origin& embedding) {
  return IsApp(requesting) && IsApp(embedding) &&
                 Granted(blink::PermissionDescriptorToPermissionType(descriptor))
             ? PermissionStatus::GRANTED
             : PermissionStatus::DENIED;
}

PermissionStatus StatusFor(
    const blink::mojom::PermissionDescriptorPtr& descriptor,
    content::RenderFrameHost* frame) {
  if (frame->IsNestedWithinFencedFrame())
    return PermissionStatus::DENIED;
  return StatusFor(descriptor, frame->GetLastCommittedOrigin(),
                   frame->GetMainFrame()->GetLastCommittedOrigin());
}

}  // namespace

void AppPermissions::RequestPermissionsFromCurrentDocument(
    content::RenderFrameHost* render_frame_host,
    const content::PermissionRequestDescription& request_description,
    base::OnceCallback<void(const std::vector<content::PermissionResult>&)>
        callback) {
  std::vector<content::PermissionResult> results;
  results.reserve(request_description.permissions.size());
  for (const auto& permission : request_description.permissions)
    results.emplace_back(StatusFor(permission, render_frame_host));
  std::move(callback).Run(results);
}

PermissionStatus AppPermissions::GetPermissionStatus(
    const blink::mojom::PermissionDescriptorPtr& permission_descriptor,
    const GURL& requesting_origin,
    const GURL& embedding_origin) {
  return StatusFor(permission_descriptor, url::Origin::Create(requesting_origin),
                   url::Origin::Create(embedding_origin));
}

content::PermissionResult
AppPermissions::GetPermissionResultForOriginWithoutContext(
    const blink::mojom::PermissionDescriptorPtr& permission_descriptor,
    const url::Origin& requesting_origin,
    const url::Origin& embedding_origin) {
  return content::PermissionResult(
      StatusFor(permission_descriptor, requesting_origin, embedding_origin));
}

content::PermissionResult AppPermissions::GetPermissionResultForCurrentDocument(
    const blink::mojom::PermissionDescriptorPtr& permission_descriptor,
    content::RenderFrameHost* render_frame_host,
    bool should_include_device_status) {
  return content::PermissionResult(
      StatusFor(permission_descriptor, render_frame_host));
}

content::PermissionResult AppPermissions::GetPermissionResultForWorker(
    const blink::mojom::PermissionDescriptorPtr& permission_descriptor,
    content::RenderProcessHost* render_process_host,
    const GURL& worker_origin) {
  const url::Origin origin = url::Origin::Create(worker_origin);
  return content::PermissionResult(
      StatusFor(permission_descriptor, origin, origin));
}

content::PermissionResult AppPermissions::GetPermissionResultForEmbeddedRequester(
    const blink::mojom::PermissionDescriptorPtr& permission_descriptor,
    content::RenderFrameHost* render_frame_host,
    const url::Origin& requesting_origin) {
  if (render_frame_host->IsNestedWithinFencedFrame())
    return content::PermissionResult(PermissionStatus::DENIED);
  return content::PermissionResult(StatusFor(
      permission_descriptor, requesting_origin,
      render_frame_host->GetMainFrame()->GetLastCommittedOrigin()));
}

}  // namespace nts_chromium
