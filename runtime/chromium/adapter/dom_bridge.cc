#include "nts/dom_context.h"

#include <cstdlib>
#include <cstring>
#include <string>

#include "base/check.h"
#include "third_party/blink/renderer/core/dom/dom_exception.h"
#include "third_party/blink/renderer/platform/bindings/exception_code.h"

namespace nts_dom {
// The objects the program keeps off the stack -- nodes, events, token lists
// -- one count per root it holds (nts_dom_retain / nts_dom_release, which the
// compiler calls). An object the program only passes along is never here:
// Oilpan finds it on the native stack, where it is a raw pointer like any
// other in Blink's own frames. One set per thread, held by one Persistent,
// so a root is one traced member and costs a hash only when the program
// keeps an object.
class Roots final : public blink::GarbageCollected<Roots> {
public:
  void Trace(blink::Visitor *visitor) const { visitor->Trace(counts); }
  blink::HeapHashCountedSet<blink::Member<blink::ScriptWrappable>> counts;
};

Roots &HeldObjects() {
  DEFINE_STATIC_LOCAL(blink::Persistent<Roots>, roots,
                      (blink::MakeGarbageCollected<Roots>()));
  return *roots;
}

// A compiled closure listening on a target: Blink's own native listener,
// which the target holds. It keeps the closure as C keeps one (callback,
// context, destroy) until it is removed or the document goes, and gives it
// back once -- never from a destructor, which Oilpan runs while sweeping.
class NtsListener final : public blink::NativeEventListener {
public:
  NtsListener(NtsDomContext *context, blink::EventTarget *target,
              const blink::AtomicString &type, NtsDomCallback callback,
              void *closure, NtsDomDestroy destroy)
      : context_(context), target_(target), type_(type), callback_(callback),
        closure_(closure), destroy_(destroy) {}

  void Invoke(blink::ExecutionContext *, blink::Event *event) override;

  // Takes the listener off its target and hands back what gives the
  // closure back; the caller runs it where the program's environment is
  // entered. Nothing the second time.
  NtsDomDestroy Detach(void *&closure) {
    if (!callback_)
      return nullptr;
    target_->removeEventListener(type_, this, /*use_capture=*/false);
    callback_ = nullptr;
    context_ = nullptr;
    closure = closure_.ExtractAsDangling();
    return std::exchange(destroy_, nullptr);
  }

  void Trace(blink::Visitor *visitor) const override {
    visitor->Trace(target_);
    blink::NativeEventListener::Trace(visitor);
  }

private:
  raw_ptr<NtsDomContext> context_;
  blink::Member<blink::EventTarget> target_;
  blink::AtomicString type_;
  NtsDomCallback callback_;
  raw_ptr<void> closure_;
  NtsDomDestroy destroy_;
};

// The listeners a context has registered, until each is removed: what gives
// every closure back when the document goes.
// A compiled closure to run before the next frame: Blink's own frame
// callback, in the queue page script's requestAnimationFrame uses, so the two
// run in the order they asked. It runs once and gives the closure back; a
// cancelled one, or one the document's end leaves, gives it back unrun.
class NtsFrame final : public blink::FrameCallback {
public:
  NtsFrame(NtsDomContext *context, NtsDomFrameCallback callback, void *closure,
           NtsDomDestroy destroy)
      : context_(context), callback_(callback), closure_(closure),
        destroy_(destroy) {}

  void Invoke(double time) override;

  // What gives the closure back, once; nothing after.
  NtsDomDestroy Take(void *&closure) {
    if (!callback_)
      return nullptr;
    callback_ = nullptr;
    context_ = nullptr;
    closure = closure_.ExtractAsDangling();
    return std::exchange(destroy_, nullptr);
  }

private:
  raw_ptr<NtsDomContext> context_;
  NtsDomFrameCallback callback_;
  raw_ptr<void> closure_;
  NtsDomDestroy destroy_;
};

// What a context's program has asked Blink to call -- listeners until each is
// removed, frames until each runs -- and so what gives every closure back
// when the document goes.
class ListenerSet final : public blink::GarbageCollected<ListenerSet> {
public:
  void Trace(blink::Visitor *visitor) const {
    visitor->Trace(set);
    visitor->Trace(frames);
  }
  blink::HeapHashSet<blink::Member<NtsListener>> set;
  blink::HeapHashSet<blink::Member<NtsFrame>> frames;
};

// Listener handles the program keeps off the stack, as Roots for objects.
class ListenerRoots final : public blink::GarbageCollected<ListenerRoots> {
public:
  void Trace(blink::Visitor *visitor) const { visitor->Trace(counts); }
  blink::HeapHashCountedSet<blink::Member<NtsListener>> counts;
};

ListenerRoots &HeldListeners() {
  DEFINE_STATIC_LOCAL(blink::Persistent<ListenerRoots>, roots,
                      (blink::MakeGarbageCollected<ListenerRoots>()));
  return *roots;
}

class NativeJob final : public base::RefCounted<NativeJob> {
public:
  using Callback = void (*)(void *);
  NativeJob(Callback run, Callback drop, void *state)
      : run_(run), drop_(drop), state_(state) {}
  void Run() {
    void *state = state_.get();
    state_ = nullptr;
    if (state)
      run_(state);
  }
  void Drop() {
    void *state = state_.get();
    state_ = nullptr;
    if (state)
      drop_(state);
  }

private:
  friend class base::RefCounted<NativeJob>;
  ~NativeJob() { CHECK(!state_); }
  const Callback run_;
  const Callback drop_;
  raw_ptr<void> state_;
};

// A native callback that runs program code: the context is the thread's
// entered one until it returns, and is kept alive that long. What else an
// entry owns -- its microtask scope -- depends on who calls, so each caller
// adds its own.
class Entry {
  STACK_ALLOCATED();

public:
  explicit Entry(NtsDomContext *context);
  ~Entry();

private:
  scoped_refptr<NtsDomContext> keep_alive_;
  raw_ptr<NtsDomContext> previous_;
};
Entry::Entry(NtsDomContext *context)
    : keep_alive_(context), previous_(entered) {
  entered = context;
}
Entry::~Entry() { entered = previous_; }

} // namespace nts_dom

// A DOM exception a member reported, until the program takes its message:
// the type dom_idl.h declares, opaque to C.
struct NtsDomException {
  blink::ExceptionCode code;
  blink::String message;
};

namespace nts_dom {
NtsDomException *Report(blink::ExceptionCode code,
                        const blink::String &message) {
  return new NtsDomException{code, message};
}
} // namespace nts_dom

using nts_dom::Entry;
using nts_dom::HeldListeners;
using nts_dom::ListenerSet;
using nts_dom::NativeJob;
using nts_dom::NtsFrame;
using nts_dom::NtsListener;
using nts_dom::HeldObjects;

namespace nts_dom {
void NtsListener::Invoke(blink::ExecutionContext *, blink::Event *event) {
  if (!callback_)
    return;
  context_->Dispatch(callback_, event, closure_.get());
}

void NtsFrame::Invoke(double time) {
  NtsDomContext *context = context_;
  const NtsDomFrameCallback callback = callback_;
  void *closure = nullptr;
  const NtsDomDestroy destroy = Take(closure);
  if (!context)
    return;
  context->listeners->frames.erase(this);
  context->RunFrame(callback, time, closure, destroy);
}
} // namespace nts_dom

NtsDomContext::NtsDomContext(blink::Document *document)
    : document(document),
      listeners(blink::MakeGarbageCollected<ListenerSet>()),
      event_loop(document->GetExecutionContext()->GetAgent()->event_loop()),
      v8_isolate(document->GetExecutionContext()->GetIsolate()) {}
NtsDomContext::~NtsDomContext() = default;

// A compiled listener's call: its own entry, as any native callback, and
// the program's environment entered by the host that owns the program.
void NtsDomContext::Dispatch(NtsDomCallback callback, blink::Event *event,
                             void *closure) {
  if (closed || !invoke)
    return;
  Entry entry(this);
  v8::HandleScope handles(v8_isolate);
  v8::MicrotasksScope microtasks(v8_isolate, event_loop->microtask_queue(),
                                 v8::MicrotasksScope::kRunMicrotasks);
  // On this stack for the call, as the program's own frames are: the event
  // is found here by Oilpan's stack scan, and is alive for the dispatch.
  struct Call {
    NtsDomCallback callback;
    raw_ptr<NtsDomEvent> event;
    raw_ptr<void> closure;
  } call{callback, HandleOf<NtsDomEvent>(event), closure};
  invoke(
      invoke_host.get(),
      [](void *state) {
        auto *call = static_cast<Call *>(state);
        call->callback(call->event.get(), call->closure.get());
      },
      &call);
}


void NtsDomContext::RunFrame(NtsDomFrameCallback callback, double time,
                             void *closure, NtsDomDestroy destroy) {
  if (closed || !invoke)
    return;
  Entry entry(this);
  v8::HandleScope handles(v8_isolate);
  v8::MicrotasksScope microtasks(v8_isolate, event_loop->microtask_queue(),
                                 v8::MicrotasksScope::kRunMicrotasks);
  struct Call {
    NtsDomFrameCallback callback;
    double time;
    raw_ptr<void> closure;
    NtsDomDestroy destroy;
  } call{callback, time, closure, destroy};
  invoke(
      invoke_host.get(),
      [](void *state) {
        auto *call = static_cast<Call *>(state);
        call->callback(call->time, call->closure.get());
        if (call->destroy)
          call->destroy(call->closure.get());
      },
      &call);
}

// Gives a closure back where the program's environment is entered.
void NtsDomContext::GiveBack(NtsDomDestroy destroy, void *closure) {
  if (!destroy)
    return;
  struct Back {
    NtsDomDestroy destroy;
    raw_ptr<void> closure;
  } back{destroy, closure};
  invoke(
      invoke_host.get(),
      [](void *state) {
        auto *back = static_cast<Back *>(state);
        back->destroy(back->closure.get());
      },
      &back);
}


// A job queued by native code: run inside the document's main-world script
// context with microtasks deferred to the end of the task, as a JS callback
// would be.
template <class Operation> void NtsDomContext::Call(Operation &&operation) {
  if (closed || !document->IsActive() || !document->GetFrame())
    return;
  auto *script = blink::ToScriptStateForMainWorld(document->GetFrame());
  if (!script || !script->ContextIsValid())
    return;
  Entry entry(this);
  blink::ScriptState::Scope scope(script);
  auto *isolate = script->GetIsolate();
  v8::MicrotasksScope microtasks(isolate, event_loop->microtask_queue(),
                                 v8::MicrotasksScope::kDoNotRunMicrotasks);
  v8::TryCatch caught(isolate);
  blink::ExceptionState exception(isolate);
  std::forward<Operation>(operation)(isolate, exception);
}


void NtsDomContext::Enqueue(NativeJob::Callback run, NativeJob::Callback drop, void *state,
             bool end_checkpoint) {
  auto job = base::MakeRefCounted<NativeJob>(run, drop, state);
  if (closed) {
    job->Drop();
    return;
  }
  jobs.push_back(job);
  auto callback = base::BindOnce(
      &NtsDomContext::RunJob, weak_factory.GetWeakPtr(), job, end_checkpoint);
  if (end_checkpoint)
    event_loop->EnqueueEndOfMicrotaskCheckpointTask(std::move(callback));
  else
    event_loop->EnqueueMicrotask(std::move(callback));
}


// Idle work runs between frames, as V8 and Oilpan schedule theirs; it
// is revoked with the document like any other queued job.
void NtsDomContext::PostIdle(NativeJob::Callback run, NativeJob::Callback drop,
              void *state) {
  auto job = base::MakeRefCounted<NativeJob>(run, drop, state);
  if (closed) {
    job->Drop();
    return;
  }
  jobs.push_back(job);
  blink::ThreadScheduler::Current()->PostIdleTask(
      FROM_HERE, base::BindOnce(&NtsDomContext::RunIdle,
                                weak_factory.GetWeakPtr(), job));
}


void NtsDomContext::RunIdle(scoped_refptr<NativeJob> job, base::TimeTicks) {
  if (!closed) {
    Entry entry(this);
    job->Run();
  }
  job->Drop();
  Forget(job);
}


void NtsDomContext::Forget(const scoped_refptr<NativeJob> &job) {
  for (blink::wtf_size_t i = 0; i < jobs.size(); ++i) {
    if (jobs[i] == job) {
      jobs.EraseAt(i);
      break;
    }
  }
}


void NtsDomContext::RunJob(scoped_refptr<NativeJob> job, bool end_checkpoint) {
  scoped_refptr<NtsDomContext> keep_alive(this);
  if (closed) {
    job->Drop();
    return;
  }
  Call([&](v8::Isolate *isolate, blink::ExceptionState &exception) {
    if (!end_checkpoint) {
      // Test instrumentation; the V8 oracle repeats these DOM mutations.
      auto *trace = document->getElementById(blink::AtomicString("native-jobs"));
      if (trace) {
        blink::CEReactionsScope reactions(isolate);
        const blink::AtomicString name("data-jobs");
        auto value = trace->getAttribute(name);
        const auto tag = blink::String::Number(++job_sequence);
        trace->setAttribute(name,
                            blink::AtomicString(value +
                                                (value.empty() ? "" : ",") +
                                                "native-" + tag),
                            exception);
      }
    }
    job->Run();
  });
  job->Drop(); // A realm that closed before execution still consumes state.
  Forget(job);
}


void NtsDomContext::Close() {
  // Every closure a listener still holds goes back while the program's
  // environment is still there to take it.
  blink::HeapVector<blink::Member<NtsListener>> remaining(listeners->set);
  listeners->set.clear();
  for (auto &listener : remaining) {
    void *closure = nullptr;
    if (auto destroy = listener->Detach(closure))
      GiveBack(destroy, closure);
  }
  blink::HeapVector<blink::Member<NtsFrame>> frames(listeners->frames);
  listeners->frames.clear();
  for (auto &frame : frames) {
    void *closure = nullptr;
    if (auto destroy = frame->Take(closure))
      GiveBack(destroy, closure);
  }
  closed = true;
  weak_factory.InvalidateWeakPtrs();
  for (auto &job : jobs)
    job->Drop();
  jobs.clear();
  atoms.clear();
  atom_ids.clear();
  literals.clear();
  names.clear();
  lent = blink::String();
}


// Text interned once for an id; a write from the table is a reference to
// the shared StringImpl, not a copy -- what V8 externalization gives page
// script for a repeated string. Ids are dense and never reused.
uint32_t NtsDomContext::Intern(const blink::String &text) {
  if (closed || text.IsNull())
    return 0;
  blink::AtomicString atom(text);
  const auto existing = atom_ids.find(atom);
  if (existing != atom_ids.end())
    return existing->value;
  CHECK_LT(atoms.size(), std::numeric_limits<uint32_t>::max());
  atoms.push_back(atom);
  atom_ids.insert(atom, atoms.size());
  return atoms.size();
}


const blink::AtomicString *NtsDomContext::Atom(uint32_t id) const {
  return id && id <= atoms.size() ? &atoms[id - 1] : nullptr;
}


namespace nts_chromium {
NtsDomContext *CreateDomContext(const blink::WebDocument &document) {
  CHECK(!document.IsNull());
  auto *context = new NtsDomContext(static_cast<blink::Document *>(document));
  context->AddRef();
  return context;
}
} // namespace nts_chromium

namespace {
// What page script's `e.name` would be: the DOMException's name, or the
// ECMAScript error a binding throws instead (TypeError, RangeError).
blink::String ExceptionName(blink::ExceptionCode code) {
  if (blink::IsDOMExceptionCode(code))
    return blink::DOMException::GetErrorName(
        static_cast<blink::DOMExceptionCode>(code));
  switch (static_cast<blink::ESErrorType>(code)) {
  case blink::ESErrorType::kRangeError:
    return "RangeError";
  case blink::ESErrorType::kReferenceError:
    return "ReferenceError";
  case blink::ESErrorType::kSyntaxError:
    return "SyntaxError";
  case blink::ESErrorType::kTypeError:
    return "TypeError";
  default:
    return "Error";
  }
}
} // namespace

extern "C" {
void nts_blink_dom_destroy(NtsDomContext *context) {
  context->Close();
  context->Release();
}
void nts_blink_dom_set_invoker(NtsDomContext *context, NtsDomInvoke invoke,
                               void *host) {
  context->invoke = invoke;
  context->invoke_host = host;
}
int32_t nts_blink_dom_entry(NtsDomContext *context, NativeJob::Callback run,
                            void *state) {
  Entry entry(context);
  if (context->closed || !context->document->IsActive())
    return 11; // InvalidStateError
  v8::HandleScope handles(context->v8_isolate);
  v8::MicrotasksScope microtasks(context->v8_isolate,
                                 context->event_loop->microtask_queue(),
                                 v8::MicrotasksScope::kRunMicrotasks);
  run(state);
  return 0;
}
NtsDomNode *nts_blink_dom_element_by_id(NtsDomContext *context,
                                        const char *id) {
  return HandleOf<NtsDomNode>(
      context->document->getElementById(blink::AtomicString(id)));
}
size_t nts_blink_dom_roots(void) { return HeldObjects().counts.size(); }
// The benchmark's controls (dom/abi/dom_testing.h), each inside an entry: a
// conservative collection now, as an allocation would trigger, and text from
// a prepared buffer at its width, the control for a program's own string.
void nts_dom_collect_for_testing(void) {
  nts_dom::AssertEntered();
  blink::ThreadState::Current()->CollectAllGarbageForTesting(
      blink::ThreadState::StackState::kMayContainHeapPointers);
}
static int32_t SetTextView(NtsDomNode *node, NtsStringView text) {
  NtsDomContext &context = nts_dom::Current();
  const auto value = context.Text(text);
  if (!node || value.IsNull())
    return 1000;
  blink::CEReactionsScope reactions(context.v8_isolate); // [CEReactions]
  NodeOf(node)->setTextContent(value);
  return 0;
}
void nts_blink_dom_callback(NtsDomContext *context, NativeJob::Callback run,
                            void *state) {
  scoped_refptr<NtsDomContext> keep_alive(context);
  if (context->closed)
    return;
  auto *script = blink::ToScriptStateForMainWorld(context->document->GetFrame());
  if (!script || !script->ContextIsValid())
    return;
  Entry entry(context);
  blink::ScriptState::Scope scope(script);
  // Match cleanup after a JavaScript event callback. An enclosing script's
  // existing run scope defers this checkpoint until that script returns.
  v8::MicrotasksScope microtasks(script->GetIsolate(),
                                 context->event_loop->microtask_queue(),
                                 v8::MicrotasksScope::kRunMicrotasks);
  run(state);
}
void nts_blink_dom_enqueue(NtsDomContext *context, NativeJob::Callback run,
                           NativeJob::Callback drop, void *state) {
  scoped_refptr<NtsDomContext> keep_alive(context);
  context->Enqueue(run, drop, state, false);
}
void nts_blink_dom_post_idle(NtsDomContext *context, NativeJob::Callback run,
                             NativeJob::Callback drop, void *state) {
  context->PostIdle(run, drop, state);
}
void nts_blink_dom_end_checkpoint(NtsDomContext *context,
                                  NativeJob::Callback run,
                                  NativeJob::Callback drop, void *state) {
  scoped_refptr<NtsDomContext> keep_alive(context);
  context->Enqueue(run, drop, state, true);
}

// The hand-written half of the DOM ABI (ffi/dom_abi.h); the members are
// generated (dom_idl.cc). Each runs inside an entry, whose context it finds
// itself, as the generated ones do.
void *nts_dom_retain(void *node) {
  HeldObjects().counts.insert(WrappableOf(node));
  return node;
}
void nts_dom_release(void *node) {
  // A release with no root to give back is a counting error in the
  // compiler, not anything a program can do: stop where it happened rather
  // than let a later release unroot a node someone still holds.
  auto &counts = HeldObjects().counts;
  const auto found = counts.find(WrappableOf(node));
  CHECK(found != counts.end());
  counts.erase(found);
}
NtsDomDocument *nts_dom_document(void) {
  return HandleOf<NtsDomDocument>(nts_dom::Current().document.Get());
}


char *nts_dom_exception_take_message(NtsDomException *exception) {
  std::unique_ptr<NtsDomException> owned(exception);
  const std::string text =
      blink::String(ExceptionName(owned->code) + ": " + owned->message).Utf8();
  // The compiler frees the message with free(), once thrown.
  char *message = static_cast<char *>(std::malloc(text.size() + 1));
  CHECK(message);
  std::memcpy(message, text.c_str(), text.size() + 1);
  return message;
}

NtsDomListener *nts_dom_listen(NtsDomEventTarget *target,
                               const NtsBorrowedString *type,
                               NtsDomCallback callback, void *closure,
                               NtsDomDestroy destroy) {
  NtsDomContext &context = nts_dom::Current();
  // A context with no invoker has no way into the program: the host that
  // owns the program installs one before running it.
  CHECK(context.invoke);
  const auto name = context.Name(nts_string_view(type));
  auto *listener = blink::MakeGarbageCollected<NtsListener>(
      &context, ObjectOf<blink::EventTarget>(target), name, callback, closure,
      destroy);
  ObjectOf<blink::EventTarget>(target)->addEventListener(name, listener);
  context.listeners->set.insert(listener);
  return reinterpret_cast<NtsDomListener *>(listener);
}
void nts_dom_unlisten(NtsDomListener *handle) {
  NtsDomContext &context = nts_dom::Current();
  auto *listener = reinterpret_cast<NtsListener *>(handle);
  context.listeners->set.erase(listener);
  void *closure = nullptr;
  // Inside the program's call: its environment is entered already.
  if (auto destroy = listener->Detach(closure))
    destroy(closure);
}
void *nts_dom_listener_retain(void *listener) {
  HeldListeners().counts.insert(reinterpret_cast<NtsListener *>(listener));
  return listener;
}
void nts_dom_listener_release(void *listener) {
  auto &counts = HeldListeners().counts;
  const auto found = counts.find(reinterpret_cast<NtsListener *>(listener));
  CHECK(found != counts.end());
  counts.erase(found);
}

int32_t nts_dom_request_animation_frame(NtsDomFrameCallback callback,
                                        void *closure, NtsDomDestroy destroy) {
  NtsDomContext &context = nts_dom::Current();
  CHECK(context.invoke);
  auto *frame = blink::MakeGarbageCollected<NtsFrame>(&context, callback,
                                                       closure, destroy);
  context.listeners->frames.insert(frame);
  return context.document->RequestAnimationFrame(
      frame, blink::FrameCallbackType::kWebExposed);
}
void nts_dom_cancel_animation_frame(int32_t id) {
  NtsDomContext &context = nts_dom::Current();
  for (auto &frame : context.listeners->frames) {
    if (frame->Id() != id)
      continue;
    context.document->CancelAnimationFrame(
        id, blink::FrameCallbackType::kWebExposed);
    NtsFrame *cancelled = frame.Get();
    context.listeners->frames.erase(cancelled);
    void *closure = nullptr;
    // Inside the program's call: its environment is entered already.
    if (auto destroy = cancelled->Take(closure))
      destroy(closure);
    return;
  }
}

int32_t nts_dom_set_text16(NtsDomNode *node, const uint16_t *text,
                           uint32_t length) {
  return SetTextView(node, {text, length, NTS_STRING_VIEW_WIDE});
}
int32_t nts_dom_set_text8(NtsDomNode *node, const uint8_t *text,
                          uint32_t length) {
  return SetTextView(node, {text, length, 0});
}
// And text interned for an id.
uint32_t nts_dom_intern(const NtsBorrowedString *text) {
  NtsDomContext &context = nts_dom::Current();
  return context.Intern(context.Text(nts_string_view(text)));
}
int32_t nts_dom_set_text_interned(NtsDomNode *node, uint32_t atom) {
  NtsDomContext &context = nts_dom::Current();
  const auto *text = context.Atom(atom);
  if (!text)
    return 1000;
  blink::CEReactionsScope reactions(context.v8_isolate);
  NodeOf(node)->setTextContent(*text);
  return 0;
}
} // extern "C"
