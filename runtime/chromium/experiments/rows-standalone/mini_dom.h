#ifndef NTS_CHROMIUM_MINI_DOM_H_
#define NTS_CHROMIUM_MINI_DOM_H_
/* The entered DOM ABI over a minimal in-process tree; see mini_dom.c. */
#include "dom_abi.h"

NtsDomContext* mini_dom_create(void);
/* Brackets one native callback, as nts_blink_dom_entry does in Blink. */
void mini_dom_enter(NtsDomContext* context);
void mini_dom_leave(NtsDomContext* context);
/* Distinct nodes the program holds rooted, as nts_blink_dom_roots counts. */
uint32_t mini_dom_roots(void);
/* The element with this id, for the harness to hand the program. */
NtsDomNode* mini_dom_find(NtsDomContext* context, const char* id);
/* Interns a C string, for the harness: the ABI's own intern takes a view. */
uint32_t mini_dom_intern(NtsDomContext* context, const char* text);
/* className|textContent per tbody row, newline-separated; caller frees. */
char* mini_dom_serialize_rows(NtsDomContext* context);
#endif
