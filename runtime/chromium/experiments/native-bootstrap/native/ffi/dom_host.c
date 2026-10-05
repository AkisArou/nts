#include "dom_host.h"
int32_t nts_dom_set_text16(NtsDomNode* node,
                           const uint16_t* text,
                           uint32_t length) {
  return nts_blink_dom_set_text_view(
      node, (NtsStringView){text, length, NTS_STRING_VIEW_WIDE});
}
int32_t nts_dom_set_text8(NtsDomNode* node,
                          const uint8_t* text,
                          uint32_t length) {
  return nts_blink_dom_set_text_view(node, (NtsStringView){text, length, 0});
}
void nts_dom_collect_for_testing(void) {
  nts_blink_dom_collect_for_testing();
}
