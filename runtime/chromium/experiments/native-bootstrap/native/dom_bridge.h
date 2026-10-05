#ifndef NTS_CHROMIUM_DOM_BRIDGE_H_
#define NTS_CHROMIUM_DOM_BRIDGE_H_

#include <stddef.h>
#include <stdint.h>

#include "nts_string_view.h"

#ifdef __cplusplus
extern "C" {
#endif

// Experimental document-scoped handles: 0 is null; all others identify
// rooted nodes until context disposal. No Blink or NTS layouts cross here.
typedef struct NtsDomContext NtsDomContext;
// Text crosses both ways as an NtsStringView (nts_string_view.h): units at
// their own width, Latin-1 or UTF-16, with a length.

void nts_blink_dom_destroy(NtsDomContext* context);
uint32_t nts_blink_dom_body(NtsDomContext* context);
uint32_t nts_blink_dom_query(NtsDomContext* context, NtsStringView selector);
uint32_t nts_blink_dom_element(NtsDomContext* context, NtsStringView name);
uint32_t nts_blink_dom_text(NtsDomContext* context, NtsStringView text);
uint32_t nts_blink_dom_append(NtsDomContext* context,
                              uint32_t parent,
                              uint32_t child);
uint32_t nts_blink_dom_remove(NtsDomContext* context,
                              uint32_t parent,
                              uint32_t child);
int32_t nts_blink_dom_set_text(NtsDomContext* context,
                               uint32_t node,
                               NtsStringView text);
int32_t nts_blink_dom_set_attribute(NtsDomContext* context,
                                    uint32_t node,
                                    NtsStringView name,
                                    NtsStringView value);
// Blink's own text, at the width Blink stores it: borrowed until the next
// bridge call, copied by the C shim.
NtsStringView nts_blink_dom_read_text(NtsDomContext* context, uint32_t node);
int32_t nts_blink_dom_status(NtsDomContext* context);
size_t nts_blink_dom_roots(NtsDomContext* context);
void nts_blink_dom_collect_for_testing(NtsDomContext* context);
// A lexical native entry shares context/microtask scopes across immediate
// calls. Per-operation validity, exceptions and CE reactions remain checked.
void nts_blink_dom_native_scope(NtsDomContext* context,
                                void (*run)(void*),
                                void* state);
// Entered calls: the architecture under test. One entry per native callback
// supplies what V8ScriptRunner::CallFunction supplies a JS callback -- the
// agent's microtask scope, so nested script cannot checkpoint mid-callback
// and the outermost entry checkpoints on return. Operations inside it touch
// no V8 context, TryCatch or V8 exception object: Blink records the DOM
// exception code without V8, and each result carries its own status.
// Text crosses at its own width -- Latin-1 or UTF-16 -- with one copy.
// Outside an entry these return kNtsDomNoEntry and do nothing.
enum { kNtsDomNoEntry = 1001 };
int32_t nts_blink_dom_entry(NtsDomContext* context,
                            void (*run)(void*),
                            void* state);
int32_t nts_blink_dom_set_text_view(NtsDomContext* context,
                                    uint32_t node,
                                    NtsStringView text);
// Interns a name or literal text once (no entry needed: no DOM change);
// 0 is failure. Valid until the context is destroyed.
uint32_t nts_blink_dom_intern(NtsDomContext* context, NtsStringView text);
// Writes interned text: a reference to the shared StringImpl, no copy.
int32_t nts_blink_dom_set_text_atom(NtsDomContext* context,
                                    uint32_t node,
                                    uint32_t atom);
void nts_blink_dom_callback(NtsDomContext* context,
                            void (*run)(void*),
                            void* state);
// Exactly one callback consumes state, including on document disposal.
void nts_blink_dom_enqueue(NtsDomContext* context,
                           void (*run)(void*),
                           void (*drop)(void*),
                           void* state);
// Runs once in an idle period (or drops on disposal); for deferred work such
// as cycle collection that must stay off the interaction path.
void nts_blink_dom_post_idle(NtsDomContext* context,
                             void (*run)(void*),
                             void (*drop)(void*),
                             void* state);
void nts_blink_dom_end_checkpoint(NtsDomContext* context,
                                  void (*run)(void*),
                                  void (*drop)(void*),
                                  void* state);

#ifdef __cplusplus
}
#endif
#endif
