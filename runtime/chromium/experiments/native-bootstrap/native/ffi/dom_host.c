#include "dom_host.h"
#include <stdlib.h>
#include <string.h>
void nts_dom_collect_for_testing(NtsDomContext* context) {
  nts_blink_dom_collect_for_testing(context);
}

uint32_t nts_dom_body(NtsDomContext* context) {
  return nts_blink_dom_body(context);
}
uint32_t nts_dom_query(NtsDomContext* context,
                       const NtsBorrowedString* selector) {
  return nts_blink_dom_query(context, nts_string_view(selector));
}
uint32_t nts_dom_element(NtsDomContext* context,
                         const NtsBorrowedString* name) {
  return nts_blink_dom_element(context, nts_string_view(name));
}
uint32_t nts_dom_text(NtsDomContext* context, const NtsBorrowedString* text) {
  return nts_blink_dom_text(context, nts_string_view(text));
}
uint32_t nts_dom_append(NtsDomContext* context,
                        uint32_t parent,
                        uint32_t child) {
  return nts_blink_dom_append(context, parent, child);
}
uint32_t nts_dom_remove(NtsDomContext* context,
                        uint32_t parent,
                        uint32_t child) {
  return nts_blink_dom_remove(context, parent, child);
}
int32_t nts_dom_set_text(NtsDomContext* context,
                         uint32_t node,
                         const NtsBorrowedString* text) {
  return nts_blink_dom_set_text(context, node, nts_string_view(text));
}
int32_t nts_dom_set_text_units(NtsDomContext* context,
                               uint32_t node,
                               const uint16_t* text,
                               uint32_t length) {
  return nts_blink_dom_set_text(
      context, node, (NtsStringView){text, length, NTS_STRING_VIEW_WIDE});
}
int32_t nts_dom_set_attribute(NtsDomContext* context,
                              uint32_t node,
                              const NtsBorrowedString* name,
                              const NtsBorrowedString* value) {
  return nts_blink_dom_set_attribute(context, node, nts_string_view(name),
                                     nts_string_view(value));
}
uint32_t nts_dom_text_length(NtsDomContext* context, uint32_t node) {
  return nts_blink_dom_read_text(context, node).length;
}
int32_t nts_dom_copy_text(NtsDomContext* context,
                          uint32_t node,
                          uint16_t* output,
                          uint32_t capacity) {
  const NtsStringView s = nts_blink_dom_read_text(context, node);
  if (s.length > capacity)
    abort();
  if (s.flags & NTS_STRING_VIEW_WIDE) {
    if (s.length)
      memcpy(output, s.units, s.length * sizeof(*output));
  } else {
    const uint8_t* latin1 = s.units;
    for (uint32_t i = 0; i < s.length; ++i)
      output[i] = latin1[i];
  }
  return nts_blink_dom_status(context);
}
int32_t nts_dom_status(NtsDomContext* context) {
  return nts_blink_dom_status(context);
}
// Prepared buffers, the benchmark's controls, as views of their width.
int32_t nts_dom_set_text16(NtsDomContext* context,
                           uint32_t node,
                           const uint16_t* text,
                           uint32_t length) {
  return nts_blink_dom_set_text_view(
      context, node, (NtsStringView){text, length, NTS_STRING_VIEW_WIDE});
}
int32_t nts_dom_set_text8(NtsDomContext* context,
                          uint32_t node,
                          const uint8_t* text,
                          uint32_t length) {
  return nts_blink_dom_set_text_view(context, node,
                                     (NtsStringView){text, length, 0});
}
