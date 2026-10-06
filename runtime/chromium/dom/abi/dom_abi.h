#ifndef NTS_CHROMIUM_DOM_ABI_H_
#define NTS_CHROMIUM_DOM_ABI_H_
/* The DOM ABI, implemented directly by the pinned Blink adapter: no wrapper
 * hop, no V8 object per call, no handle table for a node the program only
 * passes along. Its members -- every attribute and operation of the bound
 * interfaces whose IDL types map -- are generated from Blink's own IDL by
 * Blink's own binding generator (dom_idl.h, tooling/chromium/bindgen). This
 * header is the hand-written rest: what the IDL does not say.
 *
 * Entry. Every function except retain/release runs inside an entry --
 * nts_blink_dom_entry, a listener's dispatch, a queued job -- which holds the
 * document and the agent's microtask scope for the whole native callback, and
 * which every call finds as this thread's entered context. A call outside one
 * stops the renderer: program code runs only inside one.
 *
 * Objects. A node, an event, a token list is the Blink object itself: each
 * handle is its address as a ScriptWrappable, typed by its interface. Oilpan
 * scans the native stack at every collection that can run under a native
 * call, so a node on the stack is alive with nothing done for it. A node the
 * program keeps -- in a field, an array, a closure, a global, across an
 * await -- is rooted with nts_dom_retain and unrooted with nts_dom_release,
 * and the compiler calls both (`HostClass`): the program never does.
 * Identity is the address; null is NULL.
 *
 * Strings. Text and names cross as a `StringView` (nts_string_view.h): the
 * program's own units at their own width, exact. Blink copies text once into
 * a string of the same width; a literal (NTS_STRING_VIEW_IMMORTAL) is copied
 * once per document and shared after, and a literal used as a name becomes
 * its AtomicString once, found by the literal's address. Text read back is a
 * `const NtsStringView *` of Blink's own string, valid until the next call,
 * which the compiler copies.
 *
 * Errors. A member Blink marks as raising takes a last `NtsDomException **`
 * (`@ntsThrows`): on failure it stores the exception there, and the compiler
 * throws nts_dom_exception_take_message's text. No other member has one.
 *
 * Events. A listener is Blink's own: a native event listener the target
 * holds, calling a compiled closure with the event inside its own entry, the program's environment entered by the host's invoker
 * (nts_blink_dom_set_invoker). The closure crosses as C's
 * (callback, context, destroy) triple and is given back -- destroy -- when
 * the listener is removed, or when the document goes. A listener handle is
 * rooted like a node where the program keeps it. */
#include "dom_idl.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct NtsDomContext NtsDomContext;
typedef struct NtsDomListener NtsDomListener;

/* Root and unroot a node the program keeps off the stack. Called by the
 * compiler, never by the program; main thread only. */
void* nts_dom_retain(void* node);
void nts_dom_release(void* node);

/* The entered context's document. */
NtsDomDocument* nts_dom_document(void);

/* A reported exception as the message the program throws, "Name: message" --
 * the DOMException's name, or the ECMAScript error's -- in UTF-8, malloc'd
 * for the caller to free. Frees the exception. */
char* nts_dom_exception_take_message(NtsDomException* exception);

/* `target.addEventListener(type, listener)` for a compiled closure, called
 * with the event, which the listener keeps until nts_dom_unlisten or the
 * document's end. */
NtsDomListener* nts_dom_listen(NtsDomEventTarget* target,
                               const NtsBorrowedString* type,
                               void (*callback)(NtsDomEvent* event,
                                                void* closure),
                               void* closure,
                               void (*destroy)(void* closure));
/* `target.addEventListener(type, listener, capture)`, as the DOM defines it:
 * adding a listener equal to one the target has -- same type, capture and
 * closure, the closure known by its context -- does nothing, and the
 * reference the call brought is given back at once. */
void nts_dom_add_event_listener(NtsDomEventTarget* target,
                                const NtsBorrowedString* type,
                                void (*callback)(NtsDomEvent* event,
                                                 void* closure),
                                void* closure,
                                void (*destroy)(void* closure),
                                bool capture);
/* `target.removeEventListener(type, listener, capture)`: the listener added
 * with the same closure comes off and its closure goes back; none, nothing. */
void nts_dom_remove_event_listener(NtsDomEventTarget* target,
                                   const NtsBorrowedString* type,
                                   void (*callback)(NtsDomEvent* event,
                                                    void* closure),
                                   void* closure,
                                   bool capture);
/* Removes the listener and gives its closure back; a second call does
 * nothing. */
void nts_dom_unlisten(NtsDomListener* listener);
void* nts_dom_listener_retain(void* listener);
void nts_dom_listener_release(void* listener);

/* `requestAnimationFrame(callback)` for a compiled closure: called once, with
 * the frame's time, in the queue page script's callbacks share, then given
 * back. Answers the id nts_dom_cancel_animation_frame takes, which gives the
 * closure back unrun; the document's end gives back any still waiting. */
int32_t nts_dom_request_animation_frame(void (*callback)(double time,
                                                         void* closure),
                                        void* closure,
                                        void (*destroy)(void* closure));
void nts_dom_cancel_animation_frame(int32_t id);

/* `setTimeout(callback, timeout)` and `setInterval` for a compiled closure,
 * as HTML's timer initialization steps run them: the timeout is WebIDL's
 * `long` (ToInt32; a negative one is 0), past nesting level 5 one under 4 ms
 * is 4 ms, and an interval is at least 1 ms, on the timer task queues page
 * script's timers use. A timeout runs once and gives its closure back; an
 * interval runs until cleared. Answers the id the clear functions take: the
 * program's timers are their own id space, apart from page script's. */
int32_t nts_dom_set_timeout(void (*callback)(void* closure),
                            void* closure,
                            void (*destroy)(void* closure),
                            double timeout);
int32_t nts_dom_set_interval(void (*callback)(void* closure),
                             void* closure,
                             void (*destroy)(void* closure),
                             double timeout);
/* The same with the timeout left out, which is 0: an `@ntsDefault` takes
 * only an integer, and the timeout is a double so that ToInt32 is applied
 * here, as page script's binding applies it. */
int32_t nts_dom_set_timeout_default(void (*callback)(void* closure),
                                    void* closure,
                                    void (*destroy)(void* closure));
int32_t nts_dom_set_interval_default(void (*callback)(void* closure),
                                     void* closure,
                                     void (*destroy)(void* closure));
/* `clearTimeout(id)` / `clearInterval(id)`, either for either kind, as in
 * HTML: the timer stops and its closure goes back -- once its own run
 * returns, when cleared from inside it. An unknown id does nothing. */
void nts_dom_clear_timeout(int32_t id);
void nts_dom_clear_interval(int32_t id);

#ifdef __cplusplus
}
#endif
#endif
