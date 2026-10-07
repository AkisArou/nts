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
// How a listener reaches the program: the host enters its environment and
// runs `call(state)`, which calls the compiled closure. Installed once per
// context by the code that owns the program; without one, listening fails.
typedef void (*NtsDomInvoke)(void* host, void (*call)(void*), void* state);
void nts_blink_dom_set_invoker(NtsDomContext* context,
                               NtsDomInvoke invoke,
                               void* host);
// The program's promises, which a member answering one hands it (`await
// video.play()`): made inside the program's call, settled later through the
// invoker. `make` answers a promise holding two references, the program's
// and the adapter's; `fulfil`, `reject` (with an Error of that name and
// message) and `drop` (unsettled: the document is gone) each give the
// adapter's back. Installed once per context, beside the invoker; each is
// given the state installed with it.
typedef struct NtsPromise NtsPromise;
typedef struct NtsDomPromiseOps {
  NtsPromise* (*make)(void* state);
  void (*fulfil)(void* state, NtsPromise* promise);
  void (*reject)(void* state, NtsPromise* promise, const char* name,
                 const char* message);
  void (*drop)(void* state, NtsPromise* promise);
} NtsDomPromiseOps;
void nts_blink_dom_set_promise_ops(NtsDomContext* context,
                                   const NtsDomPromiseOps* ops,
                                   void* state);
// Runs program code: `run(state)` as an entry. One entry per native callback
// supplies what V8ScriptRunner::CallFunction supplies a JS callback -- the
// agent's microtask scope, so nested script cannot checkpoint mid-callback
// and the outermost entry checkpoints on return -- and makes the context the
// one every DOM call inside it is part of. Calls touch no V8 context,
// TryCatch or V8 exception object: Blink records a DOM exception without V8,
// and the program throws it. 11 (InvalidStateError), without running, for a
// closed context or an inactive document.
int32_t nts_blink_dom_entry(NtsDomContext* context,
                            void (*run)(void*),
                            void* state);
// The closures the context holds for the program -- listeners not yet
// removed, frames not yet run -- each given back when it is done with.
size_t nts_blink_dom_held_closures(NtsDomContext* context);
// The program's promises Blink has not settled yet, each keeping alive what
// awaits it until it does.
size_t nts_blink_dom_pending_promises(NtsDomContext* context);
// The document's element with this id, or NULL: how native code outside
// Blink's boundary hands the program a node to start from.
NtsDomNode* nts_blink_dom_element_by_id(NtsDomContext* context,
                                        const char* id);
// The nodes the program keeps off the stack, rooted by nts_dom_retain: how
// many distinct ones, on this thread.
size_t nts_blink_dom_roots(void);
// Logs each root left (NTS_DOM_ROOT Interface xcount): what a handle the
// program never released was.
void nts_blink_dom_log_roots(void);
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
