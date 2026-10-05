#ifndef NTS_CHROMIUM_DOM_HOST_H_
#define NTS_CHROMIUM_DOM_HOST_H_
/* The benchmark's controls beside the DOM ABI: text written from a buffer
 * prepared in advance, at each width, through the same entered path a
 * program's `StringView` takes -- what the string costs is the difference.
 * And a collection on demand, for the witness that a node on the native
 * stack survives one. */
#include "../dom_bridge.h"
int32_t nts_dom_set_text16(NtsDomContext* context,
                           NtsDomNode* node,
                           const uint16_t* text,
                           uint32_t length);
int32_t nts_dom_set_text8(NtsDomContext* context,
                          NtsDomNode* node,
                          const uint8_t* text,
                          uint32_t length);
void nts_dom_collect_for_testing(NtsDomContext* context);
#endif
