#ifndef NTS_CHROMIUM_DOM_HOST_H_
#define NTS_CHROMIUM_DOM_HOST_H_
#include "../dom_bridge.h"
uint32_t nts_dom_body(NtsDomContext* context);
uint32_t nts_dom_query(NtsDomContext* context,
                       const NtsBorrowedString* selector);
uint32_t nts_dom_element(NtsDomContext* context,
                         const NtsBorrowedString* name);
uint32_t nts_dom_text(NtsDomContext* context, const NtsBorrowedString* text);
uint32_t nts_dom_append(NtsDomContext* context,
                        uint32_t parent,
                        uint32_t child);
uint32_t nts_dom_remove(NtsDomContext* context,
                        uint32_t parent,
                        uint32_t child);
int32_t nts_dom_set_text(NtsDomContext* context,
                         uint32_t node,
                         const NtsBorrowedString* text);
// A prepared UTF-16 buffer through the same bridge: the benchmark's control.
int32_t nts_dom_set_text_units(NtsDomContext* context,
                               uint32_t node,
                               const uint16_t* text,
                               uint32_t length);
int32_t nts_dom_set_attribute(NtsDomContext* context,
                              uint32_t node,
                              const NtsBorrowedString* name,
                              const NtsBorrowedString* value);
int32_t nts_dom_set_text16(NtsDomContext* context,
                           uint32_t node,
                           const uint16_t* text,
                           uint32_t length);
int32_t nts_dom_set_text8(NtsDomContext* context,
                          uint32_t node,
                          const uint8_t* text,
                          uint32_t length);
uint32_t nts_dom_text_length(NtsDomContext* context, uint32_t node);
int32_t nts_dom_copy_text(NtsDomContext* context,
                          uint32_t node,
                          uint16_t* output,
                          uint32_t capacity);
int32_t nts_dom_status(NtsDomContext* context);
void nts_dom_collect_for_testing(NtsDomContext* context);
#endif
