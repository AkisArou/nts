#ifndef NTS_CHROMIUM_DOM_BRIDGE_H_
#define NTS_CHROMIUM_DOM_BRIDGE_H_

#include <stddef.h>
#include <stdint.h>

#include "nts_string_view.h"

#ifdef __cplusplus
extern "C" {
#endif

// What native code beside the compiled program -- the renderer harnesses,
// the C shims -- asks of the Blink adapter. The program itself sees only the
// DOM ABI (ffi/dom_abi.h), whose node types these are.
typedef struct NtsDomContext NtsDomContext;
typedef struct NtsDomNode NtsDomNode;
void nts_blink_dom_destroy(NtsDomContext* context);
// Entered calls. One entry per native callback supplies what
// V8ScriptRunner::CallFunction supplies a JS callback -- the agent's
// microtask scope, so nested script cannot checkpoint mid-callback and the
// outermost entry checkpoints on return. Operations inside it touch no V8
// context, TryCatch or V8 exception object: Blink records the DOM exception
// code without V8, and each result carries its own status. Outside an entry
// they return kNtsDomNoEntry and do nothing.
enum { kNtsDomNoEntry = 1001 };
int32_t nts_blink_dom_entry(NtsDomContext* context,
                            void (*run)(void*),
                            void* state);
// The nodes the program keeps off the stack, rooted by nts_dom_retain: how
// many distinct ones, on this thread.
size_t nts_blink_dom_roots(void);
// A conservative collection now, as one triggered by an allocation would be:
// what a node only the native stack refers to must survive.
void nts_blink_dom_collect_for_testing(NtsDomContext* context);
// Text from a prepared buffer, as a view of its width: the benchmark's
// control for the program's own `string`, which crosses the same way.
int32_t nts_blink_dom_set_text_view(NtsDomContext* context,
                                    NtsDomNode* node,
                                    NtsStringView text);
// Interns text native code holds for an id (nts_dom_intern for the program).
uint32_t nts_blink_dom_intern(NtsDomContext* context, NtsStringView text);
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
