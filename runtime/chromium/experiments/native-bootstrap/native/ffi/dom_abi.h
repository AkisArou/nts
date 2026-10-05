#ifndef NTS_CHROMIUM_DOM_ABI_H_
#define NTS_CHROMIUM_DOM_ABI_H_
/* The entered DOM ABI, implemented directly by the pinned Blink adapter: no
 * wrapper hop, no V8 object per call, no handle table for a node the program
 * only passes along.
 *
 * Entry. Every function below except retain/release/last_error runs only
 * inside nts_blink_dom_entry, which holds the document and the agent's
 * microtask scope for the whole native callback. Outside one they return
 * NULL / kNtsDomNoEntry (1001) and change nothing.
 *
 * Nodes. A node is the blink::Node itself: NtsDomNode * is its address, and
 * the typed pointers below are the same address seen as an Element, a Text or
 * the Document. Oilpan scans the native stack at every collection that can run
 * under a native call, so a node on the stack is alive with nothing done for
 * it. A node the program keeps -- in a field, an array, a closure, a global,
 * across an await -- is rooted with nts_dom_retain and unrooted with
 * nts_dom_release, and the compiler calls both (`HostClass` in
 * types/dom-abi.d.ts): the program never does. Identity is the address; null
 * is NULL.
 *
 * Strings. Text and names cross as a `StringView` (nts_string_view.h): the
 * program's own units at their own width, exact. Blink copies text once into
 * a string of the same width; a literal (NTS_STRING_VIEW_IMMORTAL) is copied
 * once per document and shared after, and a literal used as a name becomes
 * its AtomicString once, found by the literal's address. Text read back is a
 * `const NtsStringView *` of Blink's own string, valid until the next call,
 * which the compiler copies (`StringView` as a result). Text written over and
 * over that is not a literal may be interned for an id instead.
 *
 * Errors. A status-returning function returns its DOM exception code (0 on
 * success). A node-returning function returns NULL on null or failure and
 * records its code for nts_dom_last_error, which the next call overwrites. */
#include <stdint.h>

#include "nts_string_view.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct NtsDomContext NtsDomContext;
typedef struct NtsDomNode NtsDomNode;
typedef struct NtsDomElement NtsDomElement;
typedef struct NtsDomText NtsDomText;
typedef struct NtsDomDocument NtsDomDocument;

/* Root and unroot a node the program keeps off the stack. Called by the
 * compiler, never by the program; main thread only. */
void* nts_dom_retain(void* node);
void nts_dom_release(void* node);
int32_t nts_dom_last_error(NtsDomContext* context);

NtsDomDocument* nts_dom_document(NtsDomContext* context);
/* `root.querySelector(selectors)`; root is a Document, Element or fragment. */
NtsDomElement* nts_dom_query(NtsDomContext* context,
                             NtsDomNode* root,
                             const NtsBorrowedString* selectors);
NtsDomElement* nts_dom_create_element(NtsDomContext* context,
                                      const NtsBorrowedString* tag);
NtsDomText* nts_dom_create_text(NtsDomContext* context,
                                const NtsBorrowedString* text);
NtsDomNode* nts_dom_clone(NtsDomContext* context,
                          NtsDomNode* node,
                          int32_t deep);
/* The same, for an element, whose clone is one: a cloned row keeps its type
 * without a check the program would otherwise have to make. */
NtsDomElement* nts_dom_clone_element(NtsDomContext* context,
                                     NtsDomElement* element,
                                     int32_t deep);
NtsDomNode* nts_dom_first_child(NtsDomContext* context, NtsDomNode* node);
NtsDomNode* nts_dom_next_sibling(NtsDomContext* context, NtsDomNode* node);
/* The same node as an Element or a Text, or NULL if it is not one. */
NtsDomElement* nts_dom_as_element(NtsDomContext* context, NtsDomNode* node);
NtsDomText* nts_dom_as_text(NtsDomContext* context, NtsDomNode* node);

int32_t nts_dom_append_child(NtsDomContext* context,
                             NtsDomNode* parent,
                             NtsDomNode* child);
/* A NULL reference appends. */
int32_t nts_dom_insert_before(NtsDomContext* context,
                              NtsDomNode* parent,
                              NtsDomNode* child,
                              NtsDomNode* reference);
int32_t nts_dom_remove_child(NtsDomContext* context,
                             NtsDomNode* parent,
                             NtsDomNode* child);
/* `node.remove()`: detaches it from whatever parent it has. */
int32_t nts_dom_remove(NtsDomContext* context, NtsDomNode* node);
int32_t nts_dom_set_text_content(NtsDomContext* context,
                                 NtsDomNode* node,
                                 const NtsBorrowedString* text);
int32_t nts_dom_set_attribute(NtsDomContext* context,
                              NtsDomElement* element,
                              const NtsBorrowedString* name,
                              const NtsBorrowedString* value);
/* `node.textContent`: Blink's own string, valid until the next call. */
const NtsStringView* nts_dom_text_content(NtsDomContext* context,
                                          NtsDomNode* node);
/* `element.getAttribute(name)`, NULL where there is none. */
const NtsStringView* nts_dom_get_attribute(NtsDomContext* context,
                                           NtsDomElement* element,
                                           const NtsBorrowedString* name);

/* Text written repeatedly that is not a literal: interned once for an id,
 * then written as a reference to the shared StringImpl, with no copy. 0 is
 * failure; ids hold until the context is destroyed. */
uint32_t nts_dom_intern(NtsDomContext* context, const NtsBorrowedString* text);
int32_t nts_dom_set_text_interned(NtsDomContext* context,
                                  NtsDomNode* node,
                                  uint32_t atom);

#ifdef __cplusplus
}
#endif
#endif
