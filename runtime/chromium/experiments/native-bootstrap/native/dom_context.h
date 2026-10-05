// What the bindings generated from Blink's IDL (dom_idl.cc) share with the
// hand-written bridge (dom_bridge.cc): the context a call finds itself
// entered in, and how a program's handles and strings become Blink's. Not
// an ABI; the program sees dom_abi.h and dom_idl.h. Everything else of the
// adapter -- roots, listeners, jobs, entries -- is the bridge's own.
#ifndef NTS_CHROMIUM_DOM_CONTEXT_H_
#define NTS_CHROMIUM_DOM_CONTEXT_H_

#include "nts/dom_bridge_bindings.h"
#include "nts/dom_abi.h"

#include <limits>
#include <utility>

#include "base/auto_reset.h"
#include "base/check.h"
#include "base/compiler_specific.h"
#include "base/containers/span.h"
#include "base/functional/bind.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/ref_counted.h"
#include "base/memory/weak_ptr.h"
#include "third_party/blink/renderer/bindings/core/v8/v8_binding_for_core.h"
#include "third_party/blink/renderer/bindings/core/v8/v8_dom_exception.h"
#include "third_party/blink/renderer/core/dom/container_node.h"
#include "third_party/blink/renderer/core/dom/document.h"
#include "third_party/blink/renderer/core/dom/dom_exception.h"
#include "third_party/blink/renderer/core/dom/element.h"
#include "third_party/blink/renderer/core/dom/events/event.h"
#include "third_party/blink/renderer/core/dom/events/native_event_listener.h"
#include "third_party/blink/renderer/core/dom/text.h"
#include "third_party/blink/renderer/core/execution_context/agent.h"
#include "third_party/blink/renderer/core/execution_context/execution_context.h"
#include "third_party/blink/renderer/core/html/custom/ce_reactions_scope.h"
#include "third_party/blink/renderer/core/html/html_element.h"
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

namespace nts_dom {

// The context of the entry running on this thread: what every DOM call the
// program makes is part of, so no call carries it. Set by each native
// callback that runs program code (an Entry, dom_bridge.cc), restored when it
// returns, so a nested entry -- a listener dispatched by the program's own
// click() -- is its own and gives the outer one back.
inline constinit thread_local NtsDomContext *entered = nullptr;

class ListenerSet;
class NativeJob;
using NtsDomCallback = void (*)(NtsDomEvent *, void *);
using NtsDomDestroy = void (*)(void *);

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

} // namespace nts_dom

using nts_dom::CopyView;
using nts_dom::HandleOf;
using nts_dom::ListenerSet;
using nts_dom::NativeJob;
using nts_dom::NodeOf;
using nts_dom::ObjectOf;
using nts_dom::WrappableOf;
using nts_dom::NtsDomCallback;
using nts_dom::NtsDomDestroy;


struct NtsDomContext : public base::RefCounted<NtsDomContext> {
  explicit NtsDomContext(blink::Document *document);

  // A compiled listener's call: its own entry, as any native callback, and
  // the program's environment entered by the host that owns the program.
  void Dispatch(NtsDomCallback callback, blink::Event *event, void *closure);
  // Gives a closure back where the program's environment is entered.
  void GiveBack(NtsDomDestroy destroy, void *closure);
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
  blink::Persistent<ListenerSet> listeners;
  NtsDomInvoke invoke = nullptr;
  raw_ptr<void> invoke_host;
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
  operator blink::String() const {
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
      return blink::AtomicString(static_cast<blink::String>(*this));
    return context_->Name(nts_string_view(string_));
  }

private:
  raw_ptr<NtsDomContext> context_;
  raw_ptr<const NtsBorrowedString> string_;
  bool scalar_values_;
};

// A text result as Blink's implementation answers it. A union the IDL
// declares with one string member (`(DOMString or TrustedScript)?`) is that
// string -- the only member the generator binds such a result for -- and a
// union holding another member stops here rather than read as text.
inline const blink::String &AsString(const blink::String &text) { return text; }
template <class Union> blink::String AsString(const Union *value) {
  if (!value)
    return blink::String();
  CHECK(value->IsString());
  return value->GetAsString();
}

// A DOM exception a member reported, for the program to throw
// (nts_dom_exception_take_message).
NtsDomException *Report(blink::ExceptionCode code, const blink::String &message);
} // namespace nts_dom
using nts_dom::NtsText;

#endif  // NTS_CHROMIUM_DOM_CONTEXT_H_
