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
                       const uint16_t* text,
                       uint32_t length) {
  return nts_blink_dom_query(context, (NtsDomString){text, length});
}
uint32_t nts_dom_element(NtsDomContext* context,
                         const uint16_t* name,
                         uint32_t length) {
  return nts_blink_dom_element(context, (NtsDomString){name, length});
}
uint32_t nts_dom_text(NtsDomContext* context,
                      const uint16_t* text,
                      uint32_t length) {
  return nts_blink_dom_text(context, (NtsDomString){text, length});
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
                         const uint16_t* text,
                         uint32_t length) {
  return nts_blink_dom_set_text(context, node, (NtsDomString){text, length});
}
int32_t nts_dom_set_attribute(NtsDomContext* context,
                              uint32_t node,
                              const uint16_t* name,
                              uint32_t name_length,
                              const uint16_t* value,
                              uint32_t value_length) {
  return nts_blink_dom_set_attribute(context, node,
                                     (NtsDomString){name, name_length},
                                     (NtsDomString){value, value_length});
}
uint32_t nts_dom_text_length(NtsDomContext* context, uint32_t node) {
  const NtsDomString s = nts_blink_dom_read_text(context, node);
  if (s.length > UINT32_MAX)
    abort();
  return (uint32_t)s.length;
}
int32_t nts_dom_copy_text(NtsDomContext* context,
                          uint32_t node,
                          uint16_t* output,
                          uint32_t capacity) {
  const NtsDomString s = nts_blink_dom_read_text(context, node);
  if (s.length > capacity)
    abort();
  if (s.length)
    memcpy(output, s.data, s.length * sizeof(*output));
  return nts_blink_dom_status(context);
}
int32_t nts_dom_status(NtsDomContext* context) {
  return nts_blink_dom_status(context);
}
int32_t nts_dom_set_text16(NtsDomContext* context,
                           uint32_t node,
                           const uint16_t* text,
                           uint32_t length) {
  return nts_blink_dom_set_text16(context, node, (NtsDomString){text, length});
}
int32_t nts_dom_set_text8(NtsDomContext* context,
                          uint32_t node,
                          const uint8_t* text,
                          uint32_t length) {
  return nts_blink_dom_set_text8(context, node, text, length);
}
