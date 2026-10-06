#ifndef NTS_CHROMIUM_DOM_TESTING_H_
#define NTS_CHROMIUM_DOM_TESTING_H_
/* What tests and benchmarks ask of the adapter beside the DOM, each inside an
 * entry, and never what an application calls: text
 * written from a buffer prepared in advance, at each width, through the same
 * path a program's `StringView` takes -- what the string costs is the
 * difference; text interned once for an id, then written as a reference to
 * the shared StringImpl with no copy; and a collection on demand, for the
 * witness that a node on the native stack survives one. */
#include "dom_abi.h"

/* Implemented by the adapter (adapter/dom_bridge.cc), beside the members. */
int32_t nts_dom_set_text16(NtsDomNode* node,
                           const uint16_t* text,
                           uint32_t length);
int32_t nts_dom_set_text8(NtsDomNode* node,
                          const uint8_t* text,
                          uint32_t length);
/* 0 is failure; ids hold until the context is destroyed. */
uint32_t nts_dom_intern(const NtsBorrowedString* text);
int32_t nts_dom_set_text_interned(NtsDomNode* node, uint32_t atom);
void nts_dom_collect_for_testing(void);
#endif
