// What the bindings generated from Blink's IDL (dom_idl.cc) share with the
// hand-written bridge (dom_bridge.cc): the context a call finds itself
// entered in, and how a program's handles and strings become Blink's. Not
// an ABI; the program sees dom_abi.h and dom_idl.h. Everything else of the
// adapter -- roots, listeners, jobs, entries -- is the bridge's own.
#ifndef NTS_CHROMIUM_DOM_CONTEXT_H_
#define NTS_CHROMIUM_DOM_CONTEXT_H_

#include "nts/dom_bridge_bindings.h"
#include "nts/dom_abi.h"

#include <cmath>
#include <limits>
#include <optional>
#include <string_view>
#include <utility>

#include "base/auto_reset.h"
#include "base/check.h"
#include "base/compiler_specific.h"
#include "base/containers/span.h"
#include "base/functional/bind.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/ref_counted.h"
#include "base/memory/weak_ptr.h"
#include "third_party/blink/renderer/bindings/core/v8/frozen_array.h"
#include "third_party/blink/renderer/bindings/core/v8/native_value_traits_impl.h"
#include "third_party/blink/renderer/bindings/core/v8/script_promise.h"
#include "third_party/blink/renderer/bindings/core/v8/v8_binding_for_core.h"
#include "third_party/blink/renderer/bindings/core/v8/v8_dom_exception.h"
#include "third_party/blink/renderer/core/dom/container_node.h"
#include "third_party/blink/renderer/core/dom/document.h"
#include "third_party/blink/renderer/core/dom/dom_exception.h"
#include "third_party/blink/renderer/core/dom/element.h"
#include "third_party/blink/renderer/core/dom/events/event.h"
#include "third_party/blink/renderer/core/dom/events/native_event_listener.h"
#include "third_party/blink/renderer/core/dom/frame_request_callback_collection.h"
#include "third_party/blink/renderer/core/dom/text.h"
#include "third_party/blink/renderer/core/execution_context/agent.h"
#include "third_party/blink/renderer/core/execution_context/execution_context.h"
#include "third_party/blink/renderer/core/html/custom/ce_reactions_scope.h"
#include "third_party/blink/renderer/core/html/html_element.h"
#include "third_party/blink/renderer/platform/bindings/enumeration_base.h"
#include "third_party/blink/renderer/platform/bindings/exception_state.h"
#include "third_party/blink/renderer/platform/bindings/script_state.h"
#include "third_party/blink/renderer/platform/heap/collection_support/heap_hash_counted_set.h"
#include "third_party/blink/renderer/platform/heap/collection_support/heap_hash_set.h"
#include "third_party/blink/renderer/platform/heap/persistent.h"
#include "third_party/blink/renderer/platform/heap/thread_state.h"
#include "third_party/blink/renderer/platform/scheduler/public/event_loop.h"
#include "third_party/blink/renderer/platform/scheduler/public/thread_scheduler.h"
#include "third_party/blink/renderer/platform/wtf/hash_map.h"
#include "third_party/blink/renderer/platform/wtf/std_lib_extras.h"
#include "third_party/blink/renderer/platform/wtf/text/atomic_string.h"
#include "third_party/blink/renderer/platform/wtf/text/string_impl.h"
#include "third_party/blink/renderer/platform/wtf/vector.h"
#include "v8/include/v8.h"

namespace blink {
class IdleDeadline;
} // namespace blink

namespace nts_dom {

// The context of the entry running on this thread: what every DOM call the
// program makes is part of, so no call carries it. Set by each native
// callback that runs program code (an Entry, dom_bridge.cc), restored when it
// returns, so a nested entry -- a listener dispatched by the program's own
// click() -- is its own and gives the outer one back.
inline constinit thread_local NtsDomContext *entered = nullptr;

class ListenerSet;
class NativeJob;
class NtsTimer;
using NtsDomCallback = void (*)(NtsDomEvent *, void *);
using NtsDomCancelCallback = bool (*)(NtsDomEvent *, void *);
using NtsDomDestroy = void (*)(void *);
using NtsDomFrameCallback = void (*)(double, void *);
using NtsDomIdleCallback = void (*)(NtsDomIdleDeadline *, void *);
using NtsDomTimerCallback = void (*)(void *);

// Whether the program is reading or writing an event handler attribute
// (HandlerAccess). The program's handlers are their own world, as an
// isolated world's are: Blink finds the attribute's current handler by
// asking each listener whether it belongs to the current world, and a
// compiled one does only during the program's access -- so the program
// reads back and replaces its own handler in place, and page script's
// `onclick` never sees it (nor the program page script's).
inline constinit thread_local bool accessing_handler = false;
class HandlerAccess {
  STACK_ALLOCATED();

public:
  HandlerAccess() : previous_(std::exchange(accessing_handler, true)) {}
  ~HandlerAccess() { accessing_handler = previous_; }

private:
  bool previous_;
};

// A handle is the object's address as a ScriptWrappable, whatever interface
// it is typed as: NtsDomElement * and NtsDomNode * name one object, as
// Element * and Node * do, and an event, a token list or a style declaration
// is the same kind of thing -- an object Oilpan owns and finds on the native
// stack. Every conversion goes through ScriptWrappable, so no base's offset
// is assumed: the handle's type says which class it is.
inline blink::ScriptWrappable *WrappableOf(const void *handle) {
  return static_cast<blink::ScriptWrappable *>(const_cast<void *>(handle));
}
template <class T> T *ObjectOf(const void *handle) {
  return static_cast<T *>(WrappableOf(handle));
}
inline blink::Node *NodeOf(const void *handle) {
  return ObjectOf<blink::Node>(handle);
}
template <class Handle> Handle *HandleOf(blink::ScriptWrappable *object) {
  return reinterpret_cast<Handle *>(object);
}
// A member answering a reference (`classList()` is a DOMTokenList&).
template <class Handle> Handle *HandleOf(blink::ScriptWrappable &object) {
  return HandleOf<Handle>(&object);
}

inline blink::String CopyUtf16(const uint16_t *data, size_t length) {
  CHECK(data || length == 0);
  CHECK_LE(length, std::numeric_limits<uint32_t>::max());
  if (!length)
    return blink::g_empty_string;
  // Copy straight into owned Blink storage. Byte spans avoid aliasing a
  // uint16_t array as UChar; no temporary vector or second character copy.
  static_assert(sizeof(UChar) == sizeof(uint16_t));
  const auto units = UNSAFE_BUFFERS(base::span(data, length));
  base::span<UChar> destination;
  auto impl = blink::StringImpl::CreateUninitialized(length, destination);
  base::as_writable_bytes(destination).copy_from(base::as_bytes(units));
  return blink::String(std::move(impl));
}

// Blink keeps one-byte text one byte wide, as NTS does: no widening.
inline blink::String CopyLatin1(const uint8_t *data, size_t length) {
  CHECK(data || length == 0);
  CHECK_LE(length, std::numeric_limits<uint32_t>::max());
  if (!length)
    return blink::g_empty_string;
  const auto units = UNSAFE_BUFFERS(base::span(data, length));
  base::span<blink::LChar> destination;
  auto impl = blink::StringImpl::CreateUninitialized(length, destination);
  base::as_writable_bytes(destination).copy_from(units);
  return blink::String(std::move(impl));
}

// A program's string at its own width: Latin-1 stays 8-bit and UTF-16 stays
// 16-bit, as Blink stores them, so the one copy is a memcpy and nothing is
// decoded. A null view (`StringView | null` given null) is a null String.
inline blink::String CopyView(NtsStringView view) {
  if (!view.units)
    return blink::String();
  if (view.flags & NTS_STRING_VIEW_WIDE)
    return CopyUtf16(static_cast<const uint16_t *>(view.units), view.length);
  return CopyLatin1(static_cast<const uint8_t *>(view.units), view.length);
}

// A `sequence<T>` a member answered, as the program holds it: the vector
// Blink answered, read by index (dom_idl.cc's `TSequence` accessors). Its
// handle is its address; the program roots it like a node
// (nts_dom_sequence_retain) when it keeps one off the stack.
class NtsSequence final : public blink::GarbageCollected<NtsSequence> {
public:
  template <class T>
  explicit NtsSequence(const blink::HeapVector<blink::Member<T>> &items) {
    items_.reserve(items.size());
    for (const auto &item : items)
      items_.push_back(item.Get());
  }
  double length() const { return items_.size(); }
  // WebIDL's `unsigned long index`: ToUint32, then null past the end.
  blink::ScriptWrappable *item(double index) const {
    double whole = std::isfinite(index) ? std::trunc(index) : 0;
    whole = std::fmod(whole, 4294967296.0);
    if (whole < 0)
      whole += 4294967296.0;
    return whole < items_.size() ? items_[static_cast<blink::wtf_size_t>(whole)].Get()
                                 : nullptr;
  }
  void Trace(blink::Visitor *visitor) const { visitor->Trace(items_); }

private:
  blink::HeapVector<blink::Member<blink::ScriptWrappable>> items_;
};
template <class T>
NtsSequence *Sequence(const blink::HeapVector<blink::Member<T>> &items) {
  return blink::MakeGarbageCollected<NtsSequence>(items);
}
// A FrozenArray<T> member (ResizeObserverEntry's box sizes): its vector.
template <class IDLType>
NtsSequence *Sequence(const blink::FrozenArray<IDLType> &array) {
  return Sequence(array.AsVector());
}

} // namespace nts_dom

using nts_dom::CopyView;
using nts_dom::HandleOf;
using nts_dom::ListenerSet;
using nts_dom::NativeJob;
using nts_dom::NodeOf;
using nts_dom::ObjectOf;
using nts_dom::WrappableOf;
using nts_dom::NtsDomCallback;
using nts_dom::NtsDomCancelCallback;
using nts_dom::NtsDomDestroy;
using nts_dom::NtsDomFrameCallback;
using nts_dom::NtsDomIdleCallback;
using nts_dom::NtsDomTimerCallback;


struct NtsDomContext : public base::RefCounted<NtsDomContext> {
  explicit NtsDomContext(blink::Document *document);

  // A compiled listener's call: its own entry, as any native callback, and
  // the program's environment entered by the host that owns the program.
  // An event handler whose closure answers a boolean (`cancel`) cancels the
  // event when it answers false, as HTML's event handler processing does.
  void Dispatch(NtsDomCallback callback, NtsDomCancelCallback cancel,
                blink::Event *event, void *closure);
  // An event handler attribute's value for a compiled closure (`onclick`):
  // `callback` or `cancel`, the other null. It holds the closure until a
  // later write replaces it or the document ends.
  blink::EventListener *Handler(NtsDomCallback callback,
                                NtsDomCancelCallback cancel, void *closure,
                                NtsDomDestroy destroy);
  // The value an event handler attribute held before the program's write:
  // a compiled handler stops and gives its closure back.
  void Replaced(blink::EventListener *previous);
  // An event handler attribute's value read back (`el.onclick`): the
  // closure this context's compiled handler holds, retained for the caller;
  // NULL for none, page script's or another context's.
  void *HandlerClosure(blink::EventListener *listener);
  // A compiled frame callback's call, its own entry like a dispatch; the
  // closure goes back once it has run.
  void RunFrame(NtsDomFrameCallback callback, double time, void *closure,
                NtsDomDestroy destroy);
  // A compiled idle callback's call, the same with the IdleDeadline.
  void RunIdleCallback(NtsDomIdleCallback callback,
                       blink::IdleDeadline *deadline, void *closure,
                       NtsDomDestroy destroy);
  // `setTimeout`/`setInterval` for a compiled closure, as HTML's timer
  // initialization steps run them (dom_bridge.cc); the id clearTimer takes.
  int32_t SetTimer(NtsDomTimerCallback callback, void *closure,
                   NtsDomDestroy destroy, double timeout, bool repeat);
  // `clearTimeout`/`clearInterval`: the timer stops and its closure goes
  // back -- after its own run, when it is the one running.
  void ClearTimer(double id);
  // A number as WebIDL's `long` takes it: ToInt32, as page script's binding
  // converts it (a timeout, a timer's or a callback's id).
  int32_t IdlLong(double value);
  // A timer's run: its own entry, like a frame callback's.
  void RunTimer(nts_dom::NtsTimer *timer);
  // A native callback into the program -- an observer's delivery -- as its
  // own entry: `call(state)` runs where the program's environment is
  // entered, and the microtasks it queues run as it returns.
  void RunCallback(void (*call)(void *), void *state);
  // Gives a closure back where the program's environment is entered.
  void GiveBack(NtsDomDestroy destroy, void *closure);
  // The document's main-world script state: what a member Blink's IDL marks
  // [CallWith=ScriptState] is given, the one page script's binding passes.
  // The generated call enters it for that call only (dom_idl.cc).
  // The document's main-world script state, looked up once: it is the
  // document's for as long as the document is (a navigation makes a new
  // document and a new context).
  blink::ScriptState *MainWorld() const {
    if (!main_world_) {
      main_world_ = blink::ToScriptStateForMainWorld(document->GetFrame());
      CHECK(main_world_);
    }
    CHECK(main_world_->ContextIsValid());
    return main_world_.Get();
  }
  // A job queued by native code, run as a microtask or at the end of the
  // checkpoint; idle work, between frames. Each revoked with the document.
  void Enqueue(void (*run)(void *), void (*drop)(void *), void *state,
               bool end_checkpoint);
  void PostIdle(void (*run)(void *), void (*drop)(void *), void *state);
  // Gives every closure back, drops every job, and refuses new ones.
  void Close();
  // Text interned once for an id (the benchmark's control); 0 is none.
  uint32_t Intern(const blink::String &text);
  const blink::AtomicString *Atom(uint32_t id) const;

  // Blink's own text lent to the program: kept here until the next read,
  // so the view below stays valid while the compiler copies it. A null
  // String is `null` where the IDL type is nullable, and "" where it is not,
  // as V8's conversion of one makes it.
  const NtsStringView *Lend(blink::String text, bool nullable) {
    if (text.IsNull() && nullable)
      return nullptr;
    lent = std::move(text);
    if (lent.empty())
      lent_view = {"", 0, 0};
    else if (lent.Is8Bit())
      lent_view = {lent.Span8().data(), lent.length(), 0};
    else
      lent_view = {lent.Span16().data(), lent.length(), NTS_STRING_VIEW_WIDE};
    return &lent_view;
  }

  // Text from a program's string. A literal (NTS_STRING_VIEW_IMMORTAL) has
  // units that never move or change, so it is copied once per document and
  // shared after, keyed by their address. The table is bounded by the
  // program's literals. Every other string is copied, once.
  blink::String Text(NtsStringView view) {
    if (!view.units || !(view.flags & NTS_STRING_VIEW_IMMORTAL))
      return CopyView(view);
    const auto found = literals.find(view.units);
    if (found != literals.end())
      return found->value;
    auto text = CopyView(view);
    if (!closed)
      literals.insert(view.units, text);
    return text;
  }
  // A name -- a tag, an attribute, a selector -- as Blink takes one. A literal
  // becomes its AtomicString once per document, found after by its address:
  // what an interned id gave, with no id for the program to keep.
  blink::AtomicString Name(NtsStringView view) {
    if (!view.units || !(view.flags & NTS_STRING_VIEW_IMMORTAL))
      return blink::AtomicString(CopyView(view));
    const auto found = names.find(view.units);
    if (found != names.end())
      return found->value;
    blink::AtomicString name(CopyView(view));
    if (!closed)
      names.insert(view.units, name);
    return name;
  }

  blink::Persistent<blink::Document> document;
  mutable blink::Persistent<blink::ScriptState> main_world_;
  blink::Persistent<ListenerSet> listeners;
  NtsDomInvoke invoke = nullptr;
  raw_ptr<void> invoke_host;
  // How the program's promises are made and settled (nts_blink_dom_set_
  // promise_ops); a member answering a promise CHECKs it is installed.
  raw_ptr<const NtsDomPromiseOps> promise_ops;
  raw_ptr<void> promise_state;
  // How an object of the program's handed back is retained
  // (nts_blink_dom_set_retain).
  NtsDomRetain retain = nullptr;
  // The document's execution context may already be detached when the
  // observer closes. Capture its actual agent loop while the document lives;
  // queued callbacks still need explicit revocation because that loop is
  // shared.
  const scoped_refptr<blink::scheduler::EventLoop> event_loop;
  blink::String lent;
  NtsStringView lent_view{};
  blink::Vector<blink::AtomicString> atoms;
  blink::HashMap<blink::AtomicString, uint32_t> atom_ids;
  blink::HashMap<const void *, blink::String> literals;
  blink::HashMap<const void *, blink::AtomicString> names;
  bool closed = false;
  const raw_ptr<v8::Isolate> v8_isolate;
  uint32_t job_sequence = 0;
  // The program's timers are their own id space, apart from page script's,
  // and nest among themselves: the nesting level of the timer running now,
  // 0 outside one (HTML's timer nesting level).
  int32_t timer_sequence = 0;
  int timer_nesting = 0;
  blink::Vector<scoped_refptr<NativeJob>> jobs;
  base::WeakPtrFactory<NtsDomContext> weak_factory{this};

private:
  friend class base::RefCounted<NtsDomContext>;
  ~NtsDomContext();
  template <class Operation> void Call(Operation &&operation);
  void RunIdle(scoped_refptr<NativeJob> job, base::TimeTicks);
  void Forget(const scoped_refptr<NativeJob> &job);
  void RunJob(scoped_refptr<NativeJob> job, bool end_checkpoint);
};

namespace nts_dom {
// The entered context, for a call that needs it: its caches, its isolate.
// Program code runs only inside an entry, so a call outside one is the
// embedder's error, and stops here.
inline NtsDomContext &Current() {
  CHECK(entered) << "a DOM call outside an entry";
  return *entered;
}
// For a call that needs nothing from the context -- a node's parent, a
// downcast -- the same rule, checked in debug builds.
inline void AssertEntered() { DCHECK(entered); }

// A program's string as a Blink member takes one: `String` for text,
// `AtomicString` for a name, whichever its parameter is -- each a single
// conversion, so overload resolution has one answer. A literal comes from
// the context's caches either way, and NULL is the null string. A USVString
// has its lone surrogates replaced by U+FFFD, as V8's conversion does.
class NtsText {
  STACK_ALLOCATED();

public:
  NtsText(NtsDomContext &context, const NtsBorrowedString *string,
          bool scalar_values = false)
      : context_(&context), string_(string), scalar_values_(scalar_values) {}
  operator blink::String() const { return Text(); }
  // The text as a String, explicitly: `blink::String(text)` could reach a
  // String through the AtomicString conversion, interning the whole text on
  // every call.
  blink::String Text() const {
    if (!string_)
      return blink::String();
    blink::String text = context_->Text(nts_string_view(string_));
    return scalar_values_ ? blink::ReplaceUnmatchedSurrogates(std::move(text))
                          : text;
  }
  operator blink::AtomicString() const {
    if (!string_)
      return blink::g_null_atom;
    if (scalar_values_)
      return blink::AtomicString(Text());
    return context_->Name(nts_string_view(string_));
  }

private:
  // Plain pointers, as STACK_ALLOCATED allows: a raw_ptr here is a
  // BackupRefPtr count taken and dropped on every DOM call.
  NtsDomContext *context_;
  const NtsBorrowedString *string_;
  bool scalar_values_;
};

// A program's string as a ByteString parameter or member takes it: the
// text, refused with page script's TypeError when a unit is above 0xFF (as
// NativeValueTraits<IDLByteString> refuses it), and Blink is not called.
inline blink::String ByteText(NtsDomContext &context,
                              const NtsBorrowedString *string,
                              blink::ExceptionState &exception_state) {
  blink::String text = NtsText(context, string).Text();
  if (!text.ContainsOnlyLatin1OrEmpty()) {
    exception_state.ThrowTypeError("String contains non ISO-8859-1 code point.");
    return blink::String();
  }
  return text;
}

// A text result as Blink's implementation answers it. A union the IDL
// declares with one string member (`(DOMString or TrustedScript)?`) is that
// string -- the only member the generator binds such a result for -- and a
// union holding another member stops here rather than read as text.
inline const blink::String &AsString(const blink::String &text) { return text; }
template <class Union> blink::String AsString(const Union *value) {
  if (!value)
    return blink::String();
  // The string member is named for its IDL type (`(File or USVString)`).
  if constexpr (requires { value->IsUSVString(); }) {
    CHECK(value->IsUSVString());
    return value->GetAsUSVString();
  } else {
    CHECK(value->IsString());
    return value->GetAsString();
  }
}
// The same union, answered already converted to V8 (an OptimizedReturnProxy,
// `script.text`): its string, read back out.
template <class Union>
blink::String AsString(blink::bindings::OptimizedReturnProxy<Union> value) {
  if (value.IsNull())
    return blink::String();
  const v8::Local<v8::Value> converted = value.ToV8();
  CHECK(converted->IsString());
  return blink::ToCoreString(v8::Isolate::GetCurrent(),
                             converted.As<v8::String>());
}

// An IDL enum's value as the program receives it: the enum's own static
// literal, ASCII, NUL-terminated.
inline const char *EnumText(const blink::bindings::EnumerationBase &value) {
  return value.AsCStr();
}

// IDL enums. A value crosses as the program's string -- a literal union in
// TypeScript, a C string here -- and is matched against the enum's own table:
// a few comparisons, no String made. A value matching nothing goes through V8,
// where the enum's Create throws the TypeError page script's binding
// throws, word for word.
template <class E> std::optional<E> EnumFrom(const char *value) {
  const std::string_view wanted(value);
  for (size_t i = 0; i < E::kEnumSize; ++i) {
    const E candidate(static_cast<typename E::Enum>(i));
    if (std::string_view(candidate.AsCStr()) == wanted)
      return candidate;
  }
  return std::nullopt;
}
template <class E>
void ThrowInvalidEnum(NtsDomContext &context, const char *value,
                      blink::ExceptionState &exception_state) {
  v8::Isolate *isolate = context.v8_isolate.get();
  E::Create(isolate, blink::V8String(isolate, blink::String::FromUtf8(std::string_view(value))),
            exception_state);
}
// An attribute set to a value outside its enum keeps its value, and the
// console says so, as page script's binding does
// (bindings::ReportInvalidEnumSetToAttribute).
void WarnInvalidEnum(NtsDomContext &context, const char *value,
                     const char *enum_name);

// A DOM exception a member reported, for the program to throw
// (nts_dom_exception_take_message).
NtsDomException *Report(blink::ExceptionCode code, const blink::String &message);

// The ExceptionState of a member that may throw: Blink records the code and
// message without V8 (DummyExceptionStateForTesting is an ExceptionState with
// no isolate), and what it recorded is reported through the program's error
// slot (@ntsThrows), which the compiler reads after the call and throws. A
// NULL slot ignores it, as C's GError convention does.
class Throws {
  STACK_ALLOCATED();

public:
  explicit Throws(NtsDomException **error) : error_(error) {}
  ~Throws() {
    if (state_.HadException() && error_ && !*error_)
      *error_ = Report(state_.Code(), state_.Message());
  }
  operator blink::ExceptionState &() { return state_; }

private:
  blink::DummyExceptionStateForTesting state_;
  NtsDomException **error_; // STACK_ALLOCATED: no BackupRefPtr per call
};
// What a member answering a promise reports instead of throwing, as V8's
// binding of one turns an exception into a rejected promise: the exception
// state the call and its argument conversions are given, read by Answer.
class Rejections {
  STACK_ALLOCATED();

public:
  operator blink::ExceptionState &() { return state_; }
  bool HadException() const { return state_.HadException(); }
  blink::ExceptionCode Code() const { return state_.Code(); }
  const blink::String &Message() const { return state_.Message(); }

private:
  blink::DummyExceptionStateForTesting state_;
};

// The program's promise for Blink's `promise`, which it settles: fulfilled
// when Blink's fulfils, rejected with an Error named as page script's `e.name`
// would read when it rejects. Already rejected if the call, or converting its
// arguments, reported an exception. Inside the program's call.
NtsPromise *Answer(NtsDomContext &context, blink::ScriptState *script_state,
                   const Rejections &rejections,
                   blink::ScriptPromise<blink::IDLUndefined> promise);
// The same, fulfilled with Blink's text.
NtsPromise *Answer(NtsDomContext &context, blink::ScriptState *script_state,
                   const Rejections &rejections,
                   blink::ScriptPromise<blink::IDLUSVString> promise);
NtsPromise *Answer(NtsDomContext &context, blink::ScriptState *script_state,
                   const Rejections &rejections,
                   blink::ScriptPromise<blink::IDLString> promise);
// The same, fulfilled with a Blink object: the program's promise holds it as
// a DOM handle (`animation.finished` answers the Animation).
NtsPromise *AnswerWrappable(NtsDomContext &context,
                            blink::ScriptState *script_state,
                            const Rejections &rejections,
                            v8::Local<v8::Promise> promise);
template <typename T>
  requires std::is_base_of_v<blink::ScriptWrappable, T>
NtsPromise *Answer(NtsDomContext &context, blink::ScriptState *script_state,
                   const Rejections &rejections,
                   blink::ScriptPromise<T> promise) {
  return AnswerWrappable(context, script_state, rejections,
                         promise.IsEmpty() ? v8::Local<v8::Promise>()
                                           : promise.V8Promise());
}
// A promise already rejected with what `rejections` holds: a member whose
// arguments failed to convert, before Blink is called.
NtsPromise *Rejected(NtsDomContext &context, const Rejections &rejections);
} // namespace nts_dom
using nts_dom::Throws;
using nts_dom::NtsText;

#endif  // NTS_CHROMIUM_DOM_CONTEXT_H_
