#ifndef NTS_CHROMIUM_MINI_DOM_H_
#define NTS_CHROMIUM_MINI_DOM_H_
/* The entered DOM ABI over a minimal in-process tree; see mini_dom.c. */
#include "dom_abi.h"

NtsDomContext* mini_dom_create(void);
/* Brackets one native callback, as nts_blink_dom_entry does in Blink. */
void mini_dom_enter(NtsDomContext* context);
void mini_dom_leave(NtsDomContext* context);
uint32_t mini_dom_live_leases(NtsDomContext* context);
/* Interns a C string, for the harness: the ABI's own intern takes a view. */
uint32_t mini_dom_intern(NtsDomContext* context, const char* text);
/* className|textContent per tbody row, newline-separated; caller frees. */
char* mini_dom_serialize_rows(NtsDomContext* context);
#endif
