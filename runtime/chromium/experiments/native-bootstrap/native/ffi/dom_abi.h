#ifndef NTS_CHROMIUM_DOM_ABI_H_
#define NTS_CHROMIUM_DOM_ABI_H_
/* The entered DOM ABI, implemented directly by the pinned Blink adapter: no
 * wrapper hop, no V8 object per call, no copy for an interned string.
 *
 * Entry. Every function below except intern/release/last_error runs only
 * inside nts_blink_dom_entry, which holds the document and the agent's
 * microtask scope for the whole native callback. Outside one they return
 * 0 / kNtsDomNoEntry (1001) and change nothing.
 *
 * Handles. A node handle is a lease: a slot in the document's traced
 * registry plus a generation, so a released handle never aliases a later
 * node. Each function returning a handle gives the caller one lease, and the
 * same node always yields the same handle while any lease is live, so `===`
 * is node identity. 0 is null. nts_dom_release ends one lease; at zero the
 * node is unrooted and Oilpan may collect it.
 *
 * Strings. An atom is a name or literal text interned once per document; an
 * operation taking one passes a reference to Blink's shared string, with no
 * copy and no hashing. Text crosses as a `StringView` (nts_string_view.h):
 * the program's own units at their own width, Latin-1 or UTF-16, exact --
 * NUL and lone surrogates included -- and Blink copies them once into a
 * string of the same width, which is the floor for text Blink keeps. A
 * literal (NTS_STRING_VIEW_IMMORTAL) is copied once per document and shared
 * after, keyed by its address.
 *
 * Errors. A status-returning function returns its DOM exception code (0 on
 * success). A handle-returning function returns 0 on null or failure and
 * records its code for nts_dom_last_error, which the next call overwrites. */
#include <stdint.h>

#include "nts_string_view.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct NtsDomContext NtsDomContext;

uint32_t nts_dom_intern(NtsDomContext* context, const NtsBorrowedString* text);
void nts_dom_release(NtsDomContext* context, uint32_t node);
int32_t nts_dom_last_error(NtsDomContext* context);

uint32_t nts_dom_document(NtsDomContext* context);
uint32_t nts_dom_query_atom(NtsDomContext* context,
                            uint32_t root,
                            uint32_t selector);
uint32_t nts_dom_create_element(NtsDomContext* context, uint32_t tag);
uint32_t nts_dom_create_text(NtsDomContext* context,
                             const NtsBorrowedString* text);
uint32_t nts_dom_clone(NtsDomContext* context, uint32_t node, int32_t deep);
uint32_t nts_dom_first_child(NtsDomContext* context, uint32_t node);
uint32_t nts_dom_next_sibling(NtsDomContext* context, uint32_t node);

int32_t nts_dom_append_child(NtsDomContext* context,
                             uint32_t parent,
                             uint32_t child);
int32_t nts_dom_insert_before(NtsDomContext* context,
                              uint32_t parent,
                              uint32_t child,
                              uint32_t reference);
int32_t nts_dom_remove_node(NtsDomContext* context, uint32_t node);
int32_t nts_dom_set_text_value(NtsDomContext* context,
                               uint32_t node,
                               const NtsBorrowedString* text);
int32_t nts_dom_set_text_interned(NtsDomContext* context,
                                  uint32_t node,
                                  uint32_t atom);
int32_t nts_dom_set_attribute_interned(NtsDomContext* context,
                                       uint32_t element,
                                       uint32_t name,
                                       uint32_t value);

#ifdef __cplusplus
}
#endif
#endif
