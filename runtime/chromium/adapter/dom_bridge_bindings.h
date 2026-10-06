#ifndef NTS_CHROMIUM_DOM_BRIDGE_BINDINGS_H_
#define NTS_CHROMIUM_DOM_BRIDGE_BINDINGS_H_
#include "nts/dom_bridge.h"
#include "third_party/blink/public/web/web_document.h"

namespace nts_chromium {
NtsDomContext* CreateDomContext(const blink::WebDocument& document);
}  // namespace nts_chromium
#endif
