#ifndef NTS_CHROMIUM_DOM_BRIDGE_H_
#define NTS_CHROMIUM_DOM_BRIDGE_H_

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// Experimental document-scoped handles: 0 is null; all others identify
// rooted nodes until context disposal. No Blink or NTS layouts cross here.
typedef struct NtsDomContext NtsDomContext;
typedef struct NtsDomString {
  const uint16_t* data;
  size_t length;
} NtsDomString;

void nts_blink_dom_destroy(NtsDomContext* context);
uint32_t nts_blink_dom_body(NtsDomContext* context);
uint32_t nts_blink_dom_query(NtsDomContext* context, NtsDomString selector);
uint32_t nts_blink_dom_element(NtsDomContext* context, NtsDomString name);
uint32_t nts_blink_dom_text(NtsDomContext* context, NtsDomString text);
uint32_t nts_blink_dom_append(NtsDomContext* context,
                              uint32_t parent,
                              uint32_t child);
uint32_t nts_blink_dom_remove(NtsDomContext* context,
                              uint32_t parent,
                              uint32_t child);
int32_t nts_blink_dom_set_text(NtsDomContext* context,
                               uint32_t node,
                               NtsDomString text);
int32_t nts_blink_dom_set_attribute(NtsDomContext* context,
                                    uint32_t node,
                                    NtsDomString name,
                                    NtsDomString value);
// Returned text is borrowed until the next bridge call, copied by the C shim.
NtsDomString nts_blink_dom_read_text(NtsDomContext* context, uint32_t node);
int32_t nts_blink_dom_status(NtsDomContext* context);
size_t nts_blink_dom_roots(NtsDomContext* context);
void nts_blink_dom_collect_for_testing(NtsDomContext* context);
// A lexical native entry shares context/microtask scopes across immediate
// calls. Per-operation validity, exceptions and CE reactions remain checked.
void nts_blink_dom_native_scope(NtsDomContext* context,
                                void (*run)(void*),
                                void* state);
// Retained historical copying path for paired cost measurements only.
int32_t nts_blink_dom_set_text_vector_for_benchmark(NtsDomContext* context,
                                                    uint32_t node,
                                                    NtsDomString text);
void nts_blink_dom_callback(NtsDomContext* context,
                            void (*run)(void*),
                            void* state);
// Exactly one callback consumes state, including on document disposal.
void nts_blink_dom_enqueue(NtsDomContext* context,
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
