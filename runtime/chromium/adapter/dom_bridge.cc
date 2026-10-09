#include "nts/dom_context.h"

#include <algorithm>
#include <cstdlib>
#include <limits>
#include <string>
#include <optional>

#include "base/check.h"
#include "base/memory/raw_ptr_exclusion.h"
#include "base/message_loop/message_pump.h"
#include "base/numerics/clamped_math.h"
#include "base/logging.h"
#include "third_party/blink/public/common/features.h"
#include "third_party/blink/public/common/scheduler/web_scheduler_tracked_feature.h"
#include "third_party/blink/public/mojom/devtools/console_message.mojom-blink.h"
#include "third_party/blink/renderer/core/dom/abort_signal.h"
#include "third_party/blink/renderer/core/dom/dom_exception.h"
#include "third_party/blink/renderer/core/dom/events/add_event_listener_options_resolved.h"
#include "third_party/blink/renderer/core/dom/mutation_observer.h"
#include "third_party/blink/renderer/core/dom/mutation_record.h"
#include "third_party/blink/renderer/bindings/core/v8/v8_intersection_observer_init.h"
#include "third_party/blink/renderer/core/intersection_observer/intersection_observer.h"
#include "third_party/blink/renderer/core/intersection_observer/intersection_observer_delegate.h"
#include "third_party/blink/renderer/core/intersection_observer/intersection_observer_entry.h"
#include "third_party/blink/renderer/core/resize_observer/resize_observer.h"
#include "third_party/blink/renderer/core/resize_observer/resize_observer_entry.h"
#include "third_party/blink/renderer/bindings/core/v8/v8_idle_request_options.h"
#include "third_party/blink/renderer/core/frame/local_dom_window.h"
#include "third_party/blink/renderer/core/scheduler/idle_deadline.h"
#include "third_party/blink/renderer/core/scheduler/scripted_idle_task_controller.h"
#include "third_party/blink/renderer/platform/bindings/exception_code.h"
#include "third_party/blink/renderer/platform/bindings/wrapper_type_info.h"
#include "third_party/blink/renderer/platform/heap/prefinalizer.h"
#include "third_party/blink/renderer/platform/timer.h"
#include "third_party/blink/renderer/platform/wtf/text/strcat.h"

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

// Sequences the program keeps off the stack, as Roots for objects.
class SequenceRoots final : public blink::GarbageCollected<SequenceRoots> {
public:
  void Trace(blink::Visitor *visitor) const { visitor->Trace(counts); }
  blink::HeapHashCountedSet<blink::Member<nts_dom::NtsSequence>> counts;
};
SequenceRoots &HeldSequences() {
  DEFINE_STATIC_LOCAL(blink::Persistent<SequenceRoots>, roots,
                      (blink::MakeGarbageCollected<SequenceRoots>()));
  return *roots;
}

// PlainPointers: what a listener, frame, timer, held closure or job keeps of
// the context and of the program's closure is a plain pointer. These are
// made and dropped per DOM operation, and a raw_ptr in them was a
// BackupRefPtr acquire and release on each -- 18% of addEventListener plus
// removeEventListener in the per-call event kernel. Blink's core component
// is excluded from raw_ptr for the same reason
// (tools/clang/raw_ptr_plugin/RawPtrManualPathsToIgnore.cpp: "for perf
// reasons"). Neither can dangle while held: Close() takes every one of them
// back before the context goes, and the closure is the program's, given back
// exactly once (the members are cleared as they are handed over).

// A compiled closure listening on a target: Blink's own native listener,
// which the target holds. It keeps the closure as C keeps one (callback,
// context, destroy) until it is removed or the document goes, and gives it
// back once -- never from a destructor, which Oilpan runs while sweeping.
class NtsListener final : public blink::NativeEventListener {
public:
  NtsListener(NtsDomContext *context, blink::EventTarget *target,
              const blink::AtomicString &type, bool capture,
              NtsDomCallback callback, void *closure, NtsDomDestroy destroy)
      : context_(context), target_(target), type_(type), capture_(capture),
        callback_(callback), closure_(closure), destroy_(destroy) {}
  // An event handler attribute's value (`onclick`): no target or type of
  // its own -- Blink's attribute setter registers it where the attribute
  // says, the window for body's `onblur` -- and `cancel` set when the
  // closure answers whether the event goes on.
  NtsListener(NtsDomContext *context, NtsDomCallback callback,
              NtsDomCancelCallback cancel, void *closure,
              NtsDomDestroy destroy)
      : context_(context), capture_(false), handler_(true),
        callback_(callback), cancel_(cancel), closure_(closure),
        destroy_(destroy) {}

  // Whether this is the listener addEventListener(type, closure, capture)
  // on its target names: the DOM's own equality, with the closure's native
  // context standing for the function -- one per closure object. A handler
  // is never one.
  bool Is(const blink::AtomicString &type, bool capture,
          const void *closure) const {
    return !handler_ && callback_ && type_ == type && capture_ == capture &&
           closure_ == closure;
  }
  blink::EventTarget *target() const { return target_.Get(); }
  // The closure it calls: null once detached.
  void *closure() const { return closure_; }

  // `{once: true}`: removed before its first call, as the DOM says. Blink
  // would remove it without telling this listener, which would keep its
  // closure, and its place in the context's index, until the document ends.
  void SetOnce() { once_ = true; }
  // `{signal}`: aborting the signal removes the listener. The algorithm is
  // this adapter's, for the same reason as `once`; removing the listener
  // otherwise withdraws it.
  void Watch(blink::AbortSignal *signal);

  void Invoke(blink::ExecutionContext *, blink::Event *event) override;
  bool IsEventHandler() const override { return handler_; }
  // The program's handlers are their own world (nts_dom::accessing_handler).
  bool BelongsToTheCurrentWorld(blink::ExecutionContext *) const override {
    return handler_ && nts_dom::accessing_handler;
  }

  // Takes the listener off its target and hands back what gives the
  // closure back; the caller runs it where the program's environment is
  // entered. Nothing the second time. A handler stays where Blink keeps
  // it, stopped: a later write replaces it there, and page script's never
  // finds it. Detached during its own run -- `el.onclick = null` inside the
  // handler, a listener removing itself -- it hands back nothing: the
  // closure may be the only reference to what that run still reads, so it
  // goes back when the outermost run returns (Invoke).
  NtsDomDestroy Detach(void *&closure) {
    if (!callback_ && !cancel_)
      return nullptr;
    if (!handler_)
      target_->removeEventListener(type_, this, capture_);
    if (signal_)
      signal_->RemoveAlgorithm(std::exchange(abort_, nullptr));
    signal_ = nullptr;
    callback_ = nullptr;
    cancel_ = nullptr;
    if (running_) {
      detached_while_running_ = true;
      return nullptr;
    }
    context_ = nullptr;
    closure = std::exchange(closure_, nullptr);
    return std::exchange(destroy_, nullptr);
  }

  void Trace(blink::Visitor *visitor) const override {
    visitor->Trace(target_);
    visitor->Trace(signal_);
    visitor->Trace(abort_);
    blink::NativeEventListener::Trace(visitor);
  }

private:
  RAW_PTR_EXCLUSION NtsDomContext *context_; // see PlainPointers
  blink::Member<blink::EventTarget> target_;
  blink::AtomicString type_;
  bool capture_;
  bool handler_ = false;
  NtsDomCallback callback_;
  NtsDomCancelCallback cancel_ = nullptr;
  // Runs of this listener under way (a dispatch can nest), and whether it
  // was detached from inside one.
  int running_ = 0;
  bool detached_while_running_ = false;
  bool once_ = false;
  blink::Member<blink::AbortSignal> signal_;
  blink::Member<blink::AbortSignal::AlgorithmHandle> abort_;
  RAW_PTR_EXCLUSION void *closure_; // see PlainPointers
  NtsDomDestroy destroy_;
};

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
    closure = std::exchange(closure_, nullptr);
    return std::exchange(destroy_, nullptr);
  }

private:
  RAW_PTR_EXCLUSION NtsDomContext *context_; // see PlainPointers
  NtsDomFrameCallback callback_;
  RAW_PTR_EXCLUSION void *closure_; // see PlainPointers
  NtsDomDestroy destroy_;
};

// A compiled closure to run in an idle period -- or once its timeout passes
// -- in the queue page script's requestIdleCallback uses
// (ScriptedIdleTaskController). It runs once and gives the closure back; a
// cancelled one, or one the document's end leaves, gives it back unrun.
class NtsIdle final : public blink::IdleTask {
public:
  NtsIdle(NtsDomContext *context, NtsDomIdleCallback callback, void *closure,
          NtsDomDestroy destroy)
      : context_(context), callback_(callback), closure_(closure),
        destroy_(destroy) {}

  void invoke(blink::IdleDeadline *deadline) override;
  void set_id(int32_t id) { id_ = id; }
  int32_t id() const { return id_; }

  // What gives the closure back, once; nothing after.
  NtsDomDestroy Take(void *&closure) {
    if (!callback_)
      return nullptr;
    callback_ = nullptr;
    context_ = nullptr;
    closure = std::exchange(closure_, nullptr);
    return std::exchange(destroy_, nullptr);
  }

private:
  RAW_PTR_EXCLUSION NtsDomContext *context_; // see PlainPointers
  NtsDomIdleCallback callback_;
  RAW_PTR_EXCLUSION void *closure_; // see PlainPointers
  NtsDomDestroy destroy_;
  int32_t id_ = 0;
};

// A promise the program was answered, until Blink's settles it: the
// program's NtsPromise, on which the adapter holds one reference. Settling
// gives that reference back inside the program's environment; so does the
// document's end, unsettled. Kept in the context's set until then.
class NtsPendingPromise final
    : public blink::GarbageCollected<NtsPendingPromise> {
public:
  NtsPendingPromise(NtsDomContext *context, NtsPromise *promise)
      : context_(context), promise_(promise) {}
  void Trace(blink::Visitor *) const {}

  // `name` null: fulfilled -- with `text` or `handle` when one is not null.
  void Settle(const char *name, const char *message,
              const NtsStringView *text = nullptr, void *handle = nullptr);
  // The promise, unsettled, for the document's end; null after either.
  NtsPromise *Take() {
    context_ = nullptr;
    return std::exchange(promise_, nullptr);
  }

private:
  RAW_PTR_EXCLUSION NtsDomContext *context_; // see PlainPointers
  RAW_PTR_EXCLUSION NtsPromise *promise_;    // see PlainPointers
};

// Blink's promise's reactions, each settling the program's.
class NtsPromiseFulfilled final
    : public blink::ThenCallable<blink::IDLUndefined, NtsPromiseFulfilled> {
public:
  explicit NtsPromiseFulfilled(NtsPendingPromise *pending) : pending_(pending) {}
  void React(blink::ScriptState *) { pending_->Settle(nullptr, nullptr); }
  void Trace(blink::Visitor *visitor) const override {
    visitor->Trace(pending_);
    ThenCallable::Trace(visitor);
  }

private:
  blink::Member<NtsPendingPromise> pending_;
};
// Fulfilled with text: the program's own string, copied from Blink's.
template <typename IDLText>
class NtsPromiseFulfilledText final
    : public blink::ThenCallable<IDLText, NtsPromiseFulfilledText<IDLText>> {
public:
  explicit NtsPromiseFulfilledText(NtsPendingPromise *pending)
      : pending_(pending) {}
  void React(blink::ScriptState *, blink::String text) {
    NtsStringView view{"", 0, 0};
    if (!text.empty() && text.Is8Bit())
      view = {text.Span8().data(), text.length(), 0};
    else if (!text.empty())
      view = {text.Span16().data(), text.length(), NTS_STRING_VIEW_WIDE};
    pending_->Settle(nullptr, nullptr, &view);
  }
  void Trace(blink::Visitor *visitor) const override {
    visitor->Trace(pending_);
    blink::ThenCallable<IDLText, NtsPromiseFulfilledText<IDLText>>::Trace(
        visitor);
  }

private:
  blink::Member<NtsPendingPromise> pending_;
};
// Fulfilled with a Blink object: its handle, which the program's promise
// holds. A value that is not a wrapper fulfils with nothing.
class NtsPromiseFulfilledWrappable final
    : public blink::ThenCallable<blink::IDLAny, NtsPromiseFulfilledWrappable> {
public:
  explicit NtsPromiseFulfilledWrappable(NtsPendingPromise *pending)
      : pending_(pending) {}
  void React(blink::ScriptState *script_state, blink::ScriptValue value) {
    v8::Local<v8::Value> settled = value.V8Value();
    blink::ScriptWrappable *wrappable =
        settled->IsObject()
            ? blink::ToAnyScriptWrappable(script_state->GetIsolate(),
                                          settled.As<v8::Object>())
            : nullptr;
    pending_->Settle(nullptr, nullptr, nullptr, wrappable);
  }
  void Trace(blink::Visitor *visitor) const override {
    visitor->Trace(pending_);
    ThenCallable::Trace(visitor);
  }

private:
  blink::Member<NtsPendingPromise> pending_;
};
class NtsPromiseRejected final
    : public blink::ThenCallable<blink::IDLAny, NtsPromiseRejected> {
public:
  explicit NtsPromiseRejected(NtsPendingPromise *pending) : pending_(pending) {}
  // What page script's `catch (e)` would read as e.name and e.message: a
  // DOMException's own; an ECMAScript error's `name` and `message`; any
  // other reason, an Error whose message is its text.
  void React(blink::ScriptState *script_state, blink::ScriptValue reason) {
    v8::Isolate *isolate = script_state->GetIsolate();
    v8::Local<v8::Value> value = reason.V8Value();
    blink::String name = "Error";
    blink::String message;
    if (auto *exception = blink::V8DOMException::ToWrappable(isolate, value)) {
      name = exception->name();
      message = exception->message();
    } else if (value->IsNativeError()) {
      v8::Local<v8::Context> v8_context = script_state->GetContext();
      v8::Local<v8::Object> error = value.As<v8::Object>();
      v8::Local<v8::Value> field;
      if (error->Get(v8_context, blink::V8AtomicString(isolate, "name")).ToLocal(&field) && field->IsString())
        name = blink::ToCoreString(isolate, field.As<v8::String>());
      if (error->Get(v8_context, blink::V8AtomicString(isolate, "message")).ToLocal(&field) && field->IsString())
        message = blink::ToCoreString(isolate, field.As<v8::String>());
    } else {
      v8::TryCatch try_catch(isolate);
      v8::Local<v8::String> text;
      if (value->ToString(script_state->GetContext()).ToLocal(&text))
        message = blink::ToCoreString(isolate, text);
    }
    pending_->Settle(name.Utf8().c_str(), message.Utf8().c_str());
  }
  void Trace(blink::Visitor *visitor) const override {
    visitor->Trace(pending_);
    ThenCallable::Trace(visitor);
  }

private:
  blink::Member<NtsPendingPromise> pending_;
};

// A compiled closure to run after a delay, once or every interval: HTML's
// timer initialization steps as DOMTimer runs them (core/scheduler/
// dom_timer.cc), whose coordinator is private to it -- so the program's
// timers are their own id space and nest among themselves, as its event
// handlers are their own world. Blink's TimerBase posts on the timer task
// queues page script's timers use. A timer stays in the context's map while
// it can still run; its closure goes back when it has run once (a timeout),
// when it is cleared, or when the document ends -- and a timer cleared from
// inside its own run gives the closure back only once that run returns.
class NtsTimer final : public blink::GarbageCollected<NtsTimer>,
                       public blink::TimerBase {
  USING_PRE_FINALIZER(NtsTimer, Dispose);

public:
  // HTML's "nesting level greater than 5", counted from 1 as DOMTimer does.
  static constexpr int kMaxNesting = 6;
  static constexpr base::TimeDelta kMinimumInterval = base::Milliseconds(4);

  NtsTimer(NtsDomContext *context, int32_t id, int nesting,
           NtsDomTimerCallback callback, void *closure, NtsDomDestroy destroy)
      : TimerBase(nullptr), context_(context), id_(id), nesting_(nesting),
        callback_(callback), closure_(closure), destroy_(destroy) {}

  int32_t id() const { return id_; }
  int nesting() const { return nesting_; }

  // Each run, once the context has entered the program's environment.
  void Run() {
    running_ = true;
    callback_(closure_);
    running_ = false;
    if (!RepeatInterval() || cleared_)
      GiveBackNow();
  }

  // Stops the timer and hands back what gives the closure back, for the
  // caller to run where the program's environment is entered; nothing the
  // second time, or while the timer's own run is under way (that run gives
  // it back when it returns).
  NtsDomDestroy Take(void *&closure) {
    Stop();
    if (!callback_ || cleared_)
      return nullptr;
    if (running_) {
      cleared_ = true;
      return nullptr;
    }
    callback_ = nullptr;
    context_ = nullptr;
    closure = std::exchange(closure_, nullptr);
    return std::exchange(destroy_, nullptr);
  }

  void Dispose() { Stop(); }
  void Trace(blink::Visitor *) const {}

private:
  void Fired() override;
  void GiveBackNow() {
    callback_ = nullptr;
    context_ = nullptr;
    if (auto destroy = std::exchange(destroy_, nullptr))
      destroy(std::exchange(closure_, nullptr));
  }

  RAW_PTR_EXCLUSION NtsDomContext *context_; // see PlainPointers
  const int32_t id_;
  int nesting_;
  NtsDomTimerCallback callback_;
  RAW_PTR_EXCLUSION void *closure_; // see PlainPointers
  NtsDomDestroy destroy_;
  bool running_ = false;
  bool cleared_ = false;
};

// A compiled closure a native delegate calls back -- an observer's -- held
// for the program until the document ends, as long as page script's observer
// can be reached. It is given back once, and never while a call of it is
// under way: a give-back asked for during one happens as it returns.
class NtsHeldClosure final : public blink::GarbageCollected<NtsHeldClosure> {
public:
  using AnyCallback = void (*)();
  NtsHeldClosure(NtsDomContext *context, AnyCallback callback, void *closure,
                 NtsDomDestroy destroy)
      : context_(context), callback_(callback), closure_(closure),
        destroy_(destroy) {}

  NtsDomContext *context() const { return context_; }
  template <class Callback> Callback callback() const {
    return reinterpret_cast<Callback>(callback_);
  }
  void *closure() const { return closure_; }
  bool live() const { return callback_ && context_; }

  // `call(state)` as the program's entry (NtsDomContext::RunCallback).
  void Run(void (*call)(void *), void *state);

  NtsDomDestroy Take(void *&closure) {
    if (!callback_)
      return nullptr;
    callback_ = nullptr;
    if (running_) {
      taken_while_running_ = true;
      return nullptr;
    }
    context_ = nullptr;
    closure = std::exchange(closure_, nullptr);
    return std::exchange(destroy_, nullptr);
  }
  void Trace(blink::Visitor *) const {}

private:
  RAW_PTR_EXCLUSION NtsDomContext *context_; // see PlainPointers
  AnyCallback callback_;
  RAW_PTR_EXCLUSION void *closure_; // see PlainPointers
  NtsDomDestroy destroy_;
  int running_ = 0;
  bool taken_while_running_ = false;
};

// `new MutationObserver(callback)`: Blink's own observer, with a native
// delegate where page script's has V8's.
class NtsMutationDelegate final : public blink::MutationObserver::Delegate {
public:
  using Callback = void (*)(NtsDomMutationRecordSequence *,
                            NtsDomMutationObserver *, void *);
  explicit NtsMutationDelegate(NtsHeldClosure *held) : held_(held) {}
  blink::ExecutionContext *GetExecutionContext() const override {
    return held_->context() ? held_->context()->document->GetExecutionContext()
                            : nullptr;
  }
  void Deliver(const blink::MutationRecordVector &records,
               blink::MutationObserver &observer) override;
  void Trace(blink::Visitor *visitor) const override {
    visitor->Trace(held_);
    blink::MutationObserver::Delegate::Trace(visitor);
  }

private:
  blink::Member<NtsHeldClosure> held_;
};

// `new ResizeObserver(callback)`: delivered in the rendering steps, after
// layout, with the entries and the observer, as page script's is.
class NtsResizeDelegate final : public blink::ResizeObserver::Delegate {
public:
  using Callback = void (*)(NtsDomResizeObserverEntrySequence *,
                            NtsDomResizeObserver *, void *);
  explicit NtsResizeDelegate(NtsHeldClosure *held) : held_(held) {}
  void Watch(blink::ResizeObserver *observer) { observer_ = observer; }
  void OnResize(const blink::HeapVector<blink::Member<blink::ResizeObserverEntry>>
                    &entries) override;
  void Trace(blink::Visitor *visitor) const override {
    visitor->Trace(held_);
    visitor->Trace(observer_);
    blink::ResizeObserver::Delegate::Trace(visitor);
  }

private:
  blink::Member<NtsHeldClosure> held_;
  blink::Member<blink::ResizeObserver> observer_;
};

// `new IntersectionObserver(callback)`: delivered by a posted task, as page
// script's is, with the entries and the observer.
class NtsIntersectionDelegate final
    : public blink::IntersectionObserverDelegate {
public:
  using Callback = void (*)(NtsDomIntersectionObserverEntrySequence *,
                            NtsDomIntersectionObserver *, void *);
  explicit NtsIntersectionDelegate(NtsHeldClosure *held) : held_(held) {}
  blink::IntersectionObserver::DeliveryBehavior
  GetDeliveryBehavior() const override {
    return blink::IntersectionObserver::kPostTaskToDeliver;
  }
  blink::ExecutionContext *GetExecutionContext() const override {
    return held_->context() ? held_->context()->document->GetExecutionContext()
                            : nullptr;
  }
  void Deliver(const blink::HeapVector<
                   blink::Member<blink::IntersectionObserverEntry>> &entries,
               blink::IntersectionObserver &observer) override;
  void Trace(blink::Visitor *visitor) const override {
    visitor->Trace(held_);
    blink::IntersectionObserverDelegate::Trace(visitor);
  }

private:
  blink::Member<NtsHeldClosure> held_;
};

// What a context's program has asked Blink to call -- listeners until each is
// removed, frames until each runs -- and so what gives every closure back
// when the document goes.
// One target's addEventListener listeners, for the DOM's equality check:
// a lookup costs what the target has, not what the document has.
class TargetListeners final : public blink::GarbageCollected<TargetListeners> {
public:
  void Trace(blink::Visitor *visitor) const { visitor->Trace(listeners); }
  blink::HeapVector<blink::Member<NtsListener>> listeners;
};

class ListenerSet final : public blink::GarbageCollected<ListenerSet> {
public:
  void Trace(blink::Visitor *visitor) const {
    visitor->Trace(set);
    visitor->Trace(frames);
    visitor->Trace(idle);
    visitor->Trace(by_target);
    visitor->Trace(handlers);
    visitor->Trace(timers);
    visitor->Trace(held);
    visitor->Trace(promises);
  }
  // The listener added for (type, closure, capture) on `target`, or null.
  NtsListener *Find(blink::EventTarget *target, const blink::AtomicString &type,
                    bool capture, const void *closure) const {
    const auto found = by_target.find(target);
    if (found == by_target.end())
      return nullptr;
    for (const auto &listener : found->value->listeners) {
      if (listener->Is(type, capture, closure))
        return listener.Get();
    }
    return nullptr;
  }
  void Forget(NtsListener *listener) {
    set.erase(listener);
    const auto found = by_target.find(listener->target());
    if (found == by_target.end())
      return;
    auto &listeners = found->value->listeners;
    const auto at = listeners.Find(listener);
    if (at != blink::kNotFound)
      listeners.EraseAt(at);
    if (listeners.empty())
      by_target.erase(found);
  }
  blink::HeapHashSet<blink::Member<NtsListener>> set;
  blink::HeapHashSet<blink::Member<NtsFrame>> frames;
  // Idle callbacks that can still run.
  blink::HeapHashSet<blink::Member<NtsIdle>> idle;
  blink::HeapHashMap<blink::Member<blink::EventTarget>,
                     blink::Member<TargetListeners>>
      by_target;
  // The handlers in `set`, by the EventListener an attribute's getter
  // answers, so a getter's value is looked up rather than cast.
  blink::HeapHashMap<blink::Member<blink::EventListener>,
                     blink::Member<NtsListener>>
      handlers;
  // Timers that can still run, by id.
  blink::HeapHashMap<int32_t, blink::Member<NtsTimer>> timers;
  // Closures native delegates hold -- observers' -- until the document ends.
  blink::HeapHashSet<blink::Member<NtsHeldClosure>> held;
  // Promises the program was answered that Blink has not settled yet.
  blink::HeapHashSet<blink::Member<NtsPendingPromise>> promises;
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
    void *state = state_;
    state_ = nullptr;
    if (state)
      run_(state);
  }
  void Drop() {
    void *state = state_;
    state_ = nullptr;
    if (state)
      drop_(state);
  }

private:
  friend class base::RefCounted<NativeJob>;
  ~NativeJob() { CHECK(!state_); }
  const Callback run_;
  const Callback drop_;
  RAW_PTR_EXCLUSION void *state_; // see PlainPointers
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
  NtsDomContext *previous_; // STACK_ALLOCATED: no BackupRefPtr per entry
};
Entry::Entry(NtsDomContext *context)
    : keep_alive_(context), previous_(entered) {
  entered = context;
}
Entry::~Entry() { entered = previous_; }

// Everything a native callback that runs the program holds: the context as
// the thread's entered one; the main world's V8 context, entered, with a
// handle scope -- Blink code a DOM call reaches may ask for the current world
// (Text::splitText's wrapper lookup does), as it may when page script's
// bindings call it; and a microtask scope that checkpoints as the outermost
// entry returns, as V8 does after a callback.
class ProgramScope {
  STACK_ALLOCATED();

public:
  explicit ProgramScope(NtsDomContext *context)
      : entry_(context), script_(context->MainWorld()),
        microtasks_(context->v8_isolate.get(),
                    context->event_loop->microtask_queue(),
                    v8::MicrotasksScope::kRunMicrotasks) {}

private:
  Entry entry_;
  blink::ScriptState::Scope script_;
  v8::MicrotasksScope microtasks_;
};

// Settles the program's promise inside its environment, as a callback
// enters it, and gives the adapter's reference back; nothing once the
// document has ended (Close dropped it).
void NtsPendingPromise::Settle(const char *name, const char *message,
                               const NtsStringView *text, void *handle) {
  NtsDomContext *context = context_;
  NtsPromise *promise = Take();
  if (!context || !promise || context->closed)
    return;
  context->listeners->promises.erase(this);
  ProgramScope scope(context);
  struct Call {
    RAW_PTR_EXCLUSION const NtsDomPromiseOps *ops; // see PlainPointers
    RAW_PTR_EXCLUSION void *state;                 // see PlainPointers
    RAW_PTR_EXCLUSION NtsPromise *promise;         // see PlainPointers
    RAW_PTR_EXCLUSION const char *name;            // see PlainPointers
    RAW_PTR_EXCLUSION const char *message;         // see PlainPointers
    RAW_PTR_EXCLUSION const NtsStringView *text;   // see PlainPointers
    RAW_PTR_EXCLUSION void *handle;                // see PlainPointers
  } call{context->promise_ops.get(), context->promise_state.get(), promise,
         name, message, text, handle};
  context->invoke(
      context->invoke_host.get(),
      [](void *state) {
        auto *call = static_cast<Call *>(state);
        if (call->name)
          call->ops->reject(call->state, call->promise, call->name,
                            call->message);
        else if (call->text)
          call->ops->fulfil_string(call->state, call->promise, call->text);
        else if (call->handle)
          call->ops->fulfil_handle(call->state, call->promise, call->handle);
        else
          call->ops->fulfil(call->state, call->promise);
      },
      &call);
}

} // namespace nts_dom

// A DOM exception a member reported, until the program takes its message:
// the type dom_idl.h declares, opaque to C.
struct NtsDomException {
  blink::ExceptionCode code;
  blink::String message;
};

namespace nts_dom {
void WarnInvalidEnum(NtsDomContext &context, const char *value,
                     const char *enum_name) {
  // The text bindings' FormatInvalidEnumValueMessage writes.
  context.document->GetExecutionContext()->AddConsoleMessage(
      blink::mojom::blink::ConsoleMessageSource::kJavaScript,
      blink::mojom::blink::ConsoleMessageLevel::kWarning,
      blink::StrCat({"The provided value '", blink::String::FromUtf8(std::string_view(value)),
                     "' is not a valid enum value of type ", enum_name,
                     "."}));
}
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
  if (!callback_ && !cancel_)
    return;
  // The context outlives this run even if the run ends the document.
  scoped_refptr<NtsDomContext> context(context_);
  const NtsDomCallback callback = callback_;
  const NtsDomCancelCallback cancel = cancel_;
  ++running_;
  if (once_) {
    // Removed before it is called; its closure goes back once the call
    // returns, below.
    context->listeners->Forget(this);
    void *ignored = nullptr;
    Detach(ignored);
  }
  context->Dispatch(callback, cancel, event, closure_);
  if (--running_ || !detached_while_running_)
    return;
  detached_while_running_ = false;
  context_ = nullptr;
  context->GiveBack(std::exchange(destroy_, nullptr),
                    std::exchange(closure_, nullptr));
}

void NtsHeldClosure::Run(void (*call)(void *), void *state) {
  if (!live())
    return;
  scoped_refptr<NtsDomContext> context(context_);
  ++running_;
  context->RunCallback(call, state);
  if (--running_ || !taken_while_running_)
    return;
  taken_while_running_ = false;
  context_ = nullptr;
  context->GiveBack(std::exchange(destroy_, nullptr),
                    std::exchange(closure_, nullptr));
}

// An observer's delivery, on this stack for the call, where Oilpan's scan
// finds what it holds: the entries, the observer, and the closure.
template <class Callback, class Entries, class Observer> struct DeliveryCall {
  STACK_ALLOCATED();

public:
  Callback callback;
  Entries *entries;
  Observer *observer;
  void *closure;
  static void Run(void *state) {
    auto *call = static_cast<DeliveryCall *>(state);
    call->callback(call->entries, call->observer, call->closure);
  }
};

void NtsMutationDelegate::Deliver(const blink::MutationRecordVector &records,
                                  blink::MutationObserver &observer) {
  if (!held_->live())
    return;
  DeliveryCall<Callback, NtsDomMutationRecordSequence, NtsDomMutationObserver> call{
      held_->callback<Callback>(),
      reinterpret_cast<NtsDomMutationRecordSequence *>(Sequence(records)),
      HandleOf<NtsDomMutationObserver>(&observer), held_->closure()};
  held_->Run(decltype(call)::Run, &call);
}

void NtsResizeDelegate::OnResize(
    const blink::HeapVector<blink::Member<blink::ResizeObserverEntry>> &entries) {
  if (!held_->live() || !observer_)
    return;
  DeliveryCall<Callback, NtsDomResizeObserverEntrySequence, NtsDomResizeObserver>
      call{held_->callback<Callback>(),
           reinterpret_cast<NtsDomResizeObserverEntrySequence *>(
               Sequence(entries)),
           HandleOf<NtsDomResizeObserver>(observer_.Get()), held_->closure()};
  held_->Run(decltype(call)::Run, &call);
}

void NtsIntersectionDelegate::Deliver(
    const blink::HeapVector<blink::Member<blink::IntersectionObserverEntry>>
        &entries,
    blink::IntersectionObserver &observer) {
  if (!held_->live())
    return;
  DeliveryCall<Callback, NtsDomIntersectionObserverEntrySequence,
           NtsDomIntersectionObserver>
      call{held_->callback<Callback>(),
           reinterpret_cast<NtsDomIntersectionObserverEntrySequence *>(
               Sequence(entries)),
           HandleOf<NtsDomIntersectionObserver>(&observer), held_->closure()};
  held_->Run(decltype(call)::Run, &call);
}

void NtsTimer::Fired() {
  NtsDomContext *context = context_;
  if (!context || !callback_)
    return;
  if (RepeatInterval()) {
    // An interval's every run nests one deeper; past the limit it runs no
    // more often than every 4 ms, on the queue for deeply nested timers.
    nesting_ = base::ClampAdd(nesting_, 1);
    if (nesting_ == kMaxNesting + 1) {
      if (*RepeatInterval() < kMinimumInterval)
        AugmentRepeatInterval(kMinimumInterval - *RepeatInterval());
      MoveToNewTaskRunner(context->document->GetTaskRunner(
          blink::TaskType::kJavascriptTimerDelayedHighNesting));
    }
  } else {
    // A timeout leaves the map before it runs, as DOMTimer leaves its
    // coordinator: clearing its own id from inside does nothing more.
    context->listeners->timers.erase(id_);
  }
  context->RunTimer(this);
}

void NtsListener::Watch(blink::AbortSignal *signal) {
  signal_ = signal;
  abort_ = signal->AddAlgorithm(blink::BindOnce(
      [](NtsListener *listener) {
        if (!listener || !listener->context_)
          return;
        // This algorithm is the one running: nothing to withdraw.
        listener->signal_ = nullptr;
        listener->abort_ = nullptr;
        scoped_refptr<NtsDomContext> context(listener->context_);
        context->listeners->Forget(listener);
        void *closure = nullptr;
        if (auto destroy = listener->Detach(closure))
          context->GiveBack(destroy, closure);
      },
      blink::WrapWeakPersistent(this)));
}

void NtsIdle::invoke(blink::IdleDeadline *deadline) {
  NtsDomContext *context = context_;
  const NtsDomIdleCallback callback = callback_;
  void *closure = nullptr;
  const NtsDomDestroy destroy = Take(closure);
  if (!context)
    return;
  context->listeners->idle.erase(this);
  context->RunIdleCallback(callback, deadline, closure, destroy);
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
void NtsDomContext::Dispatch(NtsDomCallback callback,
                             NtsDomCancelCallback cancel, blink::Event *event,
                             void *closure) {
  if (closed || !invoke)
    return;
  nts_dom::ProgramScope scope(this);
  // On this stack for the call, as the program's own frames are: the event
  // is found here by Oilpan's stack scan, and is alive for the dispatch.
  struct Call {
    STACK_ALLOCATED();

  public:
    NtsDomCallback callback;
    NtsDomCancelCallback cancel;
    NtsDomEvent *event;
    void *closure;
    bool proceed;
  } call{callback, cancel, HandleOf<NtsDomEvent>(event), closure, true};
  invoke(
      invoke_host.get(),
      [](void *state) {
        auto *call = static_cast<Call *>(state);
        if (call->cancel)
          call->proceed = call->cancel(call->event, call->closure);
        else
          call->callback(call->event, call->closure);
      },
      &call);
  if (!call.proceed)
    event->preventDefault();
}

blink::EventListener *NtsDomContext::Handler(NtsDomCallback callback,
                                             NtsDomCancelCallback cancel,
                                             void *closure,
                                             NtsDomDestroy destroy) {
  CHECK(invoke);
  auto *handler = blink::MakeGarbageCollected<NtsListener>(
      this, callback, cancel, closure, destroy);
  listeners->set.insert(handler);
  listeners->handlers.insert(handler, handler);
  return handler;
}

void *NtsDomContext::HandlerClosure(blink::EventListener *listener) {
  if (!listener)
    return nullptr;
  const auto found = listeners->handlers.find(listener);
  if (found == listeners->handlers.end())
    return nullptr;
  void *closure = found->value->closure();
  if (closure) {
    CHECK(retain);
    retain(closure);
  }
  return closure;
}

void NtsDomContext::Replaced(blink::EventListener *previous) {
  if (!previous)
    return;
  // A compiled handler is one of this context's listeners; page script's,
  // or another context's, is not.
  const auto found = listeners->handlers.find(previous);
  if (found == listeners->handlers.end())
    return;
  NtsListener *handler = found->value.Get();
  listeners->handlers.erase(found);
  listeners->set.erase(handler);
  void *closure = nullptr;
  // Inside the program's call: its environment is entered already.
  if (auto destroy = handler->Detach(closure))
    destroy(closure);
}


void NtsDomContext::RunFrame(NtsDomFrameCallback callback, double time,
                             void *closure, NtsDomDestroy destroy) {
  if (closed || !invoke)
    return;
  nts_dom::ProgramScope scope(this);
  struct Call {
    NtsDomFrameCallback callback;
    double time;
    RAW_PTR_EXCLUSION void *closure; // see PlainPointers
    NtsDomDestroy destroy;
  } call{callback, time, closure, destroy};
  invoke(
      invoke_host.get(),
      [](void *state) {
        auto *call = static_cast<Call *>(state);
        call->callback(call->time, call->closure);
        if (call->destroy)
          call->destroy(call->closure);
      },
      &call);
}

void NtsDomContext::RunIdleCallback(NtsDomIdleCallback callback,
                                    blink::IdleDeadline *deadline,
                                    void *closure, NtsDomDestroy destroy) {
  if (closed || !invoke)
    return;
  nts_dom::ProgramScope scope(this);
  // On this stack for the call: the deadline is found here by Oilpan's scan.
  struct Call {
    STACK_ALLOCATED();

  public:
    NtsDomIdleCallback callback;
    blink::IdleDeadline *deadline;
    void *closure;
    NtsDomDestroy destroy;
  } call{callback, deadline, closure, destroy};
  invoke(
      invoke_host.get(),
      [](void *state) {
        auto *call = static_cast<Call *>(state);
        call->callback(HandleOf<NtsDomIdleDeadline>(call->deadline),
                       call->closure);
        if (call->destroy)
          call->destroy(call->closure);
      },
      &call);
}

int32_t NtsDomContext::SetTimer(NtsDomTimerCallback callback, void *closure,
                                NtsDomDestroy destroy, double timeout,
                                bool repeat) {
  CHECK(invoke);
  // WebIDL's `long timeout`: ToInt32, as page script's binding converts it.
  blink::DummyExceptionStateForTesting conversion;
  int32_t milliseconds = blink::NativeValueTraits<blink::IDLLong>::NativeValue(
      v8_isolate.get(), v8::Number::New(v8_isolate.get(), timeout),
      conversion);
  // HTML's timer initialization steps, in DOMTimer's order: a negative
  // timeout is 0; the nesting level grows before it is read; past level 5 a
  // timeout under 4 ms is 4 ms.
  base::TimeDelta delay = base::Milliseconds(std::max(milliseconds, 0));
  const int nesting = base::ClampAdd(timer_nesting, 1);
  if (nesting > nts_dom::NtsTimer::kMaxNesting &&
      delay < nts_dom::NtsTimer::kMinimumInterval)
    delay = nts_dom::NtsTimer::kMinimumInterval;
  blink::TaskType task_type =
      nesting > nts_dom::NtsTimer::kMaxNesting
          ? blink::TaskType::kJavascriptTimerDelayedHighNesting
      : delay.is_zero() ? blink::TaskType::kJavascriptTimerImmediate
                        : blink::TaskType::kJavascriptTimerDelayedLowNesting;
  // An interval runs at most once a millisecond, as DOMTimer clamps one.
  if (repeat && !blink::features::IsSetIntervalWithoutClampEnabled())
    delay = std::max(delay, base::Milliseconds(1));
  // A short timeout runs as close to on time as it can; a long one may be
  // aligned with other wake-ups, as DOMTimer's are.
  const base::TimeDelta high_resolution =
      base::MessagePump::GetAlignWakeUpsEnabled() &&
              base::FeatureList::IsEnabled(
                  blink::features::kLowerHighResolutionTimerThreshold)
          ? base::Milliseconds(4)
          : base::Milliseconds(32);
  const bool precise = delay < high_resolution ||
                       blink::scheduler::IsAlignWakeUpsDisabledForProcess();
  // The next id the program's timers do not use, from 1, wrapping.
  int32_t id;
  do {
    timer_sequence = timer_sequence == std::numeric_limits<int32_t>::max()
                         ? 1
                         : timer_sequence + 1;
    id = timer_sequence;
  } while (listeners->timers.Contains(id));
  auto *timer = blink::MakeGarbageCollected<nts_dom::NtsTimer>(
      this, id, nesting, callback, closure, destroy);
  timer->MoveToNewTaskRunner(document->GetTaskRunner(task_type));
  listeners->timers.insert(id, timer);
  if (repeat)
    timer->StartRepeating(delay, FROM_HERE, precise);
  else
    timer->StartOneShot(delay, FROM_HERE, precise);
  return id;
}

void NtsDomContext::ClearTimer(double id) {
  // WebIDL's `long id`: ToInt32, as page script's binding converts it.
  blink::DummyExceptionStateForTesting conversion;
  const int32_t timer_id = blink::NativeValueTraits<blink::IDLLong>::NativeValue(
      v8_isolate.get(), v8::Number::New(v8_isolate.get(), id), conversion);
  // Ids start at 1: 0 and below name no timer, and are the map's reserved
  // keys (NaN and an omitted id convert to 0).
  if (timer_id <= 0)
    return;
  const auto found = listeners->timers.find(timer_id);
  if (found == listeners->timers.end())
    return;
  nts_dom::NtsTimer *timer = found->value.Get();
  listeners->timers.erase(found);
  void *closure = nullptr;
  // Inside the program's call: its environment is entered already.
  if (auto destroy = timer->Take(closure))
    destroy(closure);
}

void NtsDomContext::RunCallback(void (*call)(void *), void *state) {
  if (closed || !invoke)
    return;
  nts_dom::ProgramScope scope(this);
  invoke(invoke_host.get(), call, state);
}

void NtsDomContext::RunTimer(nts_dom::NtsTimer *timer) {
  if (closed || !invoke)
    return;
  nts_dom::ProgramScope scope(this);
  // The timer is on this stack for the run, where Oilpan's scan finds it.
  timer_nesting = timer->nesting();
  invoke(
      invoke_host.get(),
      [](void *state) { static_cast<nts_dom::NtsTimer *>(state)->Run(); },
      timer);
  timer_nesting = 0;
}

// Gives a closure back where the program's environment is entered.
void NtsDomContext::GiveBack(NtsDomDestroy destroy, void *closure) {
  if (!destroy)
    return;
  struct Back {
    NtsDomDestroy destroy;
    RAW_PTR_EXCLUSION void *closure; // see PlainPointers
  } back{destroy, closure};
  invoke(
      invoke_host.get(),
      [](void *state) {
        auto *back = static_cast<Back *>(state);
        back->destroy(back->closure);
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
  listeners->by_target.clear();
  listeners->handlers.clear();
  for (auto &listener : remaining) {
    void *closure = nullptr;
    if (auto destroy = listener->Detach(closure))
      GiveBack(destroy, closure);
  }
  blink::HeapVector<blink::Member<nts_dom::NtsTimer>> timers;
  for (auto &entry : listeners->timers)
    timers.push_back(entry.value);
  listeners->timers.clear();
  for (auto &timer : timers) {
    void *closure = nullptr;
    if (auto destroy = timer->Take(closure))
      GiveBack(destroy, closure);
  }
  blink::HeapVector<blink::Member<nts_dom::NtsHeldClosure>> held(
      listeners->held);
  listeners->held.clear();
  for (auto &closure_holder : held) {
    void *closure = nullptr;
    if (auto destroy = closure_holder->Take(closure))
      GiveBack(destroy, closure);
  }
  blink::HeapVector<blink::Member<NtsFrame>> frames(listeners->frames);
  listeners->frames.clear();
  for (auto &frame : frames) {
    void *closure = nullptr;
    if (auto destroy = frame->Take(closure))
      GiveBack(destroy, closure);
  }
  blink::HeapVector<blink::Member<nts_dom::NtsIdle>> idle(listeners->idle);
  listeners->idle.clear();
  for (auto &task : idle) {
    if (auto *window = document->domWindow())
      blink::ScriptedIdleTaskController::From(*window).CancelCallback(
          task->id());
    void *closure = nullptr;
    if (auto destroy = task->Take(closure))
      GiveBack(destroy, closure);
  }
  // The program's promises Blink never settled: their adapter references,
  // given back unsettled while the environment is still there.
  blink::HeapVector<blink::Member<nts_dom::NtsPendingPromise>> pending(
      listeners->promises);
  listeners->promises.clear();
  for (auto &entry : pending) {
    if (NtsPromise *promise = entry->Take()) {
      struct Drop {
        RAW_PTR_EXCLUSION const NtsDomPromiseOps *ops; // see PlainPointers
        RAW_PTR_EXCLUSION void *state;                 // see PlainPointers
        RAW_PTR_EXCLUSION NtsPromise *promise;         // see PlainPointers
      } drop{promise_ops.get(), promise_state.get(), promise};
      invoke(
          invoke_host.get(),
          [](void *state) {
            auto *drop = static_cast<Drop *>(state);
            drop->ops->drop(drop->state, drop->promise);
          },
          &drop);
    }
  }
  closed = true;
  main_world_.Clear();
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

namespace nts_dom {
NtsPromise *Rejected(NtsDomContext &context, const Rejections &rejections) {
  CHECK(context.promise_ops);
  NtsPromise *answer = context.promise_ops->make(context.promise_state.get());
  context.promise_ops->reject(context.promise_state.get(), answer, ExceptionName(rejections.Code()).Utf8().c_str(),
                              rejections.Message().Utf8().c_str());
  return answer;
}
namespace {
// Blink's promise with its reactions subscribed: the program's, pending.
template <typename IDLType, typename Fulfilled>
NtsPromise *Subscribe(NtsDomContext &context, blink::ScriptState *script_state,
                      const Rejections &rejections,
                      blink::ScriptPromise<IDLType> promise) {
  if (rejections.HadException() || promise.IsEmpty())
    return Rejected(context, rejections);
  CHECK(context.promise_ops);
  NtsPromise *answer = context.promise_ops->make(context.promise_state.get());
  auto *pending =
      blink::MakeGarbageCollected<NtsPendingPromise>(&context, answer);
  context.listeners->promises.insert(pending);
  promise.Then(script_state, blink::MakeGarbageCollected<Fulfilled>(pending),
               blink::MakeGarbageCollected<NtsPromiseRejected>(pending));
  return answer;
}
} // namespace
NtsPromise *Answer(NtsDomContext &context, blink::ScriptState *script_state,
                   const Rejections &rejections,
                   blink::ScriptPromise<blink::IDLUndefined> promise) {
  return Subscribe<blink::IDLUndefined, NtsPromiseFulfilled>(
      context, script_state, rejections, promise);
}
NtsPromise *Answer(NtsDomContext &context, blink::ScriptState *script_state,
                   const Rejections &rejections,
                   blink::ScriptPromise<blink::IDLUSVString> promise) {
  return Subscribe<blink::IDLUSVString,
                   NtsPromiseFulfilledText<blink::IDLUSVString>>(
      context, script_state, rejections, promise);
}
NtsPromise *AnswerWrappable(NtsDomContext &context,
                            blink::ScriptState *script_state,
                            const Rejections &rejections,
                            v8::Local<v8::Promise> promise) {
  if (promise.IsEmpty())
    return Rejected(context, rejections);
  return Subscribe<blink::IDLAny, NtsPromiseFulfilledWrappable>(
      context, script_state, rejections,
      blink::ScriptPromise<blink::IDLAny>::FromV8Promise(
          script_state->GetIsolate(), promise));
}
NtsPromise *Answer(NtsDomContext &context, blink::ScriptState *script_state,
                   const Rejections &rejections,
                   blink::ScriptPromise<blink::IDLString> promise) {
  return Subscribe<blink::IDLString, NtsPromiseFulfilledText<blink::IDLString>>(
      context, script_state, rejections, promise);
}
} // namespace nts_dom

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
void nts_blink_dom_set_retain(NtsDomContext *context, NtsDomRetain retain) {
  context->retain = retain;
}

void nts_blink_dom_set_promise_ops(NtsDomContext *context,
                                   const NtsDomPromiseOps *ops, void *state) {
  context->promise_ops = ops;
  context->promise_state = state;
}
int32_t nts_blink_dom_entry(NtsDomContext *context, NativeJob::Callback run,
                            void *state) {
  if (context->closed || !context->document->IsActive())
    return 11; // InvalidStateError
  nts_dom::ProgramScope scope(context);
  run(state);
  return 0;
}
NtsDomNode *nts_blink_dom_element_by_id(NtsDomContext *context,
                                        const char *id) {
  return HandleOf<NtsDomNode>(
      context->document->getElementById(blink::AtomicString(id)));
}
size_t nts_blink_dom_pending_promises(NtsDomContext *context) {
  return context->listeners->promises.size();
}
size_t nts_blink_dom_held_closures(NtsDomContext *context) {
  return context->listeners->set.size() + context->listeners->frames.size() +
         context->listeners->idle.size() +
         context->listeners->timers.size() +
         context->listeners->held.size();
}
size_t nts_blink_dom_roots(void) { return HeldObjects().counts.size(); }
// Logs each root left, as "Interface xcount": what a handle the program
// never released was.
void nts_blink_dom_log_roots(void) {
  for (const auto &entry : HeldObjects().counts) {
    LOG(INFO) << "NTS_DOM_ROOT "
              << blink::ToWrapperTypeInfo(entry.key.Get())->interface_name
              << " x" << entry.value;
  }
}
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
void *nts_dom_sequence_retain(void *sequence) {
  nts_dom::HeldSequences().counts.insert(static_cast<nts_dom::NtsSequence *>(sequence));
  return sequence;
}
void nts_dom_sequence_release(void *sequence) {
  auto &counts = nts_dom::HeldSequences().counts;
  const auto found = counts.find(static_cast<nts_dom::NtsSequence *>(sequence));
  CHECK(found != counts.end());
  counts.erase(found);
}
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
NtsDomWindow *nts_dom_window(void) {
  return HandleOf<NtsDomWindow>(nts_dom::Current().document->domWindow());
}


char *nts_dom_exception_take_message(NtsDomException *exception) {
  std::unique_ptr<NtsDomException> owned(exception);
  const std::string text =
      blink::String(ExceptionName(owned->code) + ": " + owned->message).Utf8();
  // The compiler frees the message with free(), once thrown.
  char *message = static_cast<char *>(std::malloc(text.size() + 1));
  CHECK(message);
  // The allocation is exactly the text and its terminator.
  auto out = UNSAFE_BUFFERS(base::span(message, text.size() + 1));
  out.first(text.size()).copy_from(base::span(text));
  out[text.size()] = '\0';
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
      &context, ObjectOf<blink::EventTarget>(target), name, /*capture=*/false,
      callback, closure, destroy);
  ObjectOf<blink::EventTarget>(target)->addEventListener(name, listener);
  context.listeners->set.insert(listener);
  return reinterpret_cast<NtsDomListener *>(listener);
}
}  // extern "C"

namespace {

// `target.addEventListener(type, f, {capture, once, signal, passive})` as the
// DOM defines it: adding the listener an equal one already is does nothing --
// and the closure reference the call brought goes straight back, since
// nothing keeps it. `passive` left out is Blink's to default: true for touch
// and wheel listeners on the window, the document and its root and body.
void AddEventListener(NtsDomEventTarget *handle, const NtsBorrowedString *type,
                      NtsDomCallback callback, void *closure,
                      NtsDomDestroy destroy, bool capture, bool once,
                      NtsDomAbortSignal *signal_handle,
                      std::optional<bool> passive) {
  NtsDomContext &context = nts_dom::Current();
  CHECK(context.invoke);
  auto *target = ObjectOf<blink::EventTarget>(handle);
  const auto name = context.Name(nts_string_view(type));
  auto *signal = signal_handle ? ObjectOf<blink::AbortSignal>(signal_handle)
                               : nullptr;
  // An aborted signal adds nothing, and an equal listener is already there:
  // either way the closure reference the call brought goes straight back.
  // Inside the program's call: its environment is entered already.
  if ((signal && signal->aborted()) ||
      context.listeners->Find(target, name, capture, closure)) {
    if (destroy)
      destroy(closure);
    return;
  }
  auto *listener = blink::MakeGarbageCollected<NtsListener>(
      &context, target, name, capture, callback, closure, destroy);
  if (once)
    listener->SetOnce();
  auto *options =
      blink::MakeGarbageCollected<blink::AddEventListenerOptionsResolved>();
  options->setCapture(capture);
  if (passive)
    options->setPassive(*passive);
  target->addEventListener(name, listener, options);
  if (signal)
    listener->Watch(signal);
  context.listeners->set.insert(listener);
  auto &bucket = context.listeners->by_target.insert(target, nullptr).stored_value->value;
  if (!bucket)
    bucket = blink::MakeGarbageCollected<nts_dom::TargetListeners>();
  bucket->listeners.push_back(listener);
}

}  // namespace

extern "C" {

void nts_dom_add_event_listener(NtsDomEventTarget *handle,
                                const NtsBorrowedString *type,
                                NtsDomCallback callback, void *closure,
                                NtsDomDestroy destroy, bool capture, bool once,
                                NtsDomAbortSignal *signal) {
  AddEventListener(handle, type, callback, closure, destroy, capture, once,
                   signal, std::nullopt);
}
void nts_dom_add_event_listener_passive(NtsDomEventTarget *handle,
                                        const NtsBorrowedString *type,
                                        NtsDomCallback callback, void *closure,
                                        NtsDomDestroy destroy, bool capture,
                                        bool once, NtsDomAbortSignal *signal,
                                        bool passive) {
  AddEventListener(handle, type, callback, closure, destroy, capture, once,
                   signal, passive);
}
// `target.removeEventListener(type, f, capture)`: the listener added with
// the same closure, if any, comes off and gives its closure back.
void nts_dom_remove_event_listener(NtsDomEventTarget *handle,
                                   const NtsBorrowedString *type,
                                   NtsDomCallback, void *closure,
                                   bool capture) {
  NtsDomContext &context = nts_dom::Current();
  auto *listener = context.listeners->Find(
      ObjectOf<blink::EventTarget>(handle),
      context.Name(nts_string_view(type)), capture, closure);
  if (!listener)
    return;
  context.listeners->Forget(listener);
  void *held = nullptr;
  if (auto destroy = listener->Detach(held))
    destroy(held);
}
void nts_dom_unlisten(NtsDomListener *handle) {
  NtsDomContext &context = nts_dom::Current();
  auto *listener = reinterpret_cast<NtsListener *>(handle);
  context.listeners->Forget(listener);
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
// The closure an observer's delegate holds, in the context's set.
static nts_dom::NtsHeldClosure *Hold(NtsDomContext &context,
                                     nts_dom::NtsHeldClosure::AnyCallback callback,
                                     void *closure, NtsDomDestroy destroy) {
  CHECK(context.invoke);
  auto *held = blink::MakeGarbageCollected<nts_dom::NtsHeldClosure>(
      &context, callback, closure, destroy);
  context.listeners->held.insert(held);
  return held;
}

NtsDomMutationObserver *nts_dom_new_mutation_observer(
    nts_dom::NtsMutationDelegate::Callback callback, void *closure,
    NtsDomDestroy destroy) {
  NtsDomContext &context = nts_dom::Current();
  auto *delegate = blink::MakeGarbageCollected<nts_dom::NtsMutationDelegate>(
      Hold(context, reinterpret_cast<nts_dom::NtsHeldClosure::AnyCallback>(callback),
           closure, destroy));
  return HandleOf<NtsDomMutationObserver>(
      blink::MutationObserver::Create(delegate));
}

NtsDomResizeObserver *nts_dom_new_resize_observer(
    nts_dom::NtsResizeDelegate::Callback callback, void *closure,
    NtsDomDestroy destroy) {
  NtsDomContext &context = nts_dom::Current();
  auto *delegate = blink::MakeGarbageCollected<nts_dom::NtsResizeDelegate>(
      Hold(context, reinterpret_cast<nts_dom::NtsHeldClosure::AnyCallback>(callback),
           closure, destroy));
  auto *observer =
      blink::ResizeObserver::Create(context.document->domWindow(), delegate);
  delegate->Watch(observer);
  return HandleOf<NtsDomResizeObserver>(observer);
}

NtsDomIntersectionObserver *nts_dom_new_intersection_observer(
    nts_dom::NtsIntersectionDelegate::Callback callback, void *closure,
    NtsDomDestroy destroy) {
  NtsDomContext &context = nts_dom::Current();
  auto *delegate =
      blink::MakeGarbageCollected<nts_dom::NtsIntersectionDelegate>(
          Hold(context, reinterpret_cast<nts_dom::NtsHeldClosure::AnyCallback>(callback),
               closure, destroy));
  // The defaults page script's `new IntersectionObserver(callback)` gets:
  // the viewport, no margin, threshold 0.
  return HandleOf<NtsDomIntersectionObserver>(blink::IntersectionObserver::Create(
      blink::IntersectionObserverInit::Create(context.v8_isolate),
      *delegate, std::nullopt));
}

int32_t nts_dom_set_timeout(NtsDomTimerCallback callback, void *closure,
                            NtsDomDestroy destroy, double timeout) {
  return nts_dom::Current().SetTimer(callback, closure, destroy, timeout,
                                     /*repeat=*/false);
}
int32_t nts_dom_set_interval(NtsDomTimerCallback callback, void *closure,
                             NtsDomDestroy destroy, double timeout) {
  return nts_dom::Current().SetTimer(callback, closure, destroy, timeout,
                                     /*repeat=*/true);
}
int32_t nts_dom_set_timeout_default(NtsDomTimerCallback callback,
                                    void *closure, NtsDomDestroy destroy) {
  return nts_dom_set_timeout(callback, closure, destroy, 0);
}
int32_t nts_dom_set_interval_default(NtsDomTimerCallback callback,
                                     void *closure, NtsDomDestroy destroy) {
  return nts_dom_set_interval(callback, closure, destroy, 0);
}
// HTML's clearTimeout and clearInterval clear from one list: either clears
// either kind.
void nts_dom_clear_timeout(double id) { nts_dom::Current().ClearTimer(id); }
void nts_dom_clear_interval(double id) { nts_dom::Current().ClearTimer(id); }

// `requestIdleCallback(callback, {timeout})`, in the queue page script's
// uses; the id cancelIdleCallback takes. WebIDL's `unsigned long timeout`
// is ToUint32, as page script's binding converts it; 0 is no timeout.
int32_t nts_dom_request_idle_callback(NtsDomIdleCallback callback,
                                      void *closure, NtsDomDestroy destroy,
                                      double timeout) {
  NtsDomContext &context = nts_dom::Current();
  CHECK(context.invoke);
  blink::LocalDOMWindow *window = context.document->domWindow();
  CHECK(window);
  blink::DummyExceptionStateForTesting conversion;
  auto *options = blink::IdleRequestOptions::Create(context.v8_isolate.get());
  options->setTimeout(
      blink::NativeValueTraits<blink::IDLUnsignedLong>::NativeValue(
          context.v8_isolate.get(),
          v8::Number::New(context.v8_isolate.get(), timeout), conversion));
  auto *task = blink::MakeGarbageCollected<nts_dom::NtsIdle>(
      &context, callback, closure, destroy);
  context.listeners->idle.insert(task);
  const int32_t id =
      blink::ScriptedIdleTaskController::From(*window).RegisterCallback(
          task, options);
  task->set_id(id);
  return id;
}
int32_t nts_dom_request_idle_callback_default(NtsDomIdleCallback callback,
                                              void *closure,
                                              NtsDomDestroy destroy) {
  return nts_dom_request_idle_callback(callback, closure, destroy, 0);
}
void nts_dom_cancel_idle_callback(int32_t id) {
  NtsDomContext &context = nts_dom::Current();
  for (auto &task : context.listeners->idle) {
    if (task->id() != id)
      continue;
    if (auto *window = context.document->domWindow())
      blink::ScriptedIdleTaskController::From(*window).CancelCallback(id);
    nts_dom::NtsIdle *cancelled = task.Get();
    context.listeners->idle.erase(cancelled);
    void *closure = nullptr;
    // Inside the program's call: its environment is entered already.
    if (auto destroy = cancelled->Take(closure))
      destroy(closure);
    return;
  }
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
