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

namespace {

// The nodes the program keeps off the stack, one count per root it holds
// (nts_dom_retain / nts_dom_release, which the compiler calls). A node the
// program only passes along is never here: Oilpan finds it on the native
// stack, where it is a raw pointer like any other in Blink's own frames.
// One set per thread, held by one Persistent, so a root is one traced
// member and costs a hash only when the program keeps a node.
class NodeRoots final : public blink::GarbageCollected<NodeRoots> {
public:
  void Trace(blink::Visitor *visitor) const { visitor->Trace(counts); }
  blink::HeapHashCountedSet<blink::Member<blink::Node>> counts;
};

NodeRoots &Roots() {
  DEFINE_STATIC_LOCAL(blink::Persistent<NodeRoots>, roots,
                      (blink::MakeGarbageCollected<NodeRoots>()));
  return *roots;
}

using NtsDomCallback = void (*)(NtsDomNode *, void *);
using NtsDomDestroy = void (*)(void *);

// A compiled closure listening on a target: Blink's own native listener,
// which the target holds. It keeps the closure as C keeps one (callback,
// context, destroy) until it is removed or the document goes, and gives it
// back once -- never from a destructor, which Oilpan runs while sweeping.
class NtsListener final : public blink::NativeEventListener {
public:
  NtsListener(NtsDomContext *context, blink::Node *target,
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
  blink::Member<blink::Node> target_;
  blink::AtomicString type_;
  NtsDomCallback callback_;
  raw_ptr<void> closure_;
  NtsDomDestroy destroy_;
};

// The listeners a context has registered, until each is removed: what gives
// every closure back when the document goes.
class ListenerSet final : public blink::GarbageCollected<ListenerSet> {
public:
  void Trace(blink::Visitor *visitor) const { visitor->Trace(set); }
  blink::HeapHashSet<blink::Member<NtsListener>> set;
};

// Listener handles the program keeps off the stack, as NodeRoots for nodes.
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

// A handle is the node's address, whatever it is typed as: NtsDomElement *
// and NtsDomNode * name one object, as Element * and Node * do, because
// Node is every DOM class's first base.
blink::Node *NodeOf(const void *handle) {
  return static_cast<blink::Node *>(const_cast<void *>(handle));
}
template <class Handle> Handle *HandleOf(blink::Node *node) {
  return reinterpret_cast<Handle *>(node);
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

blink::String CopyUtf16(const uint16_t *data, size_t length) {
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
blink::String CopyLatin1(const uint8_t *data, size_t length) {
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
blink::String CopyView(NtsStringView view) {
  if (!view.units)
    return blink::String();
  if (view.flags & NTS_STRING_VIEW_WIDE)
    return CopyUtf16(static_cast<const uint16_t *>(view.units), view.length);
  return CopyLatin1(static_cast<const uint8_t *>(view.units), view.length);
}

} // namespace

struct NtsDomContext : public base::RefCounted<NtsDomContext> {
  explicit NtsDomContext(blink::Document *document)
      : document(document),
        listeners(blink::MakeGarbageCollected<ListenerSet>()),
        event_loop(document->GetExecutionContext()->GetAgent()->event_loop()),
        v8_isolate(document->GetExecutionContext()->GetIsolate()) {}

  // An entered operation. The entry holds the context alive and owns the
  // microtask scope; the operation owns only what its IDL member requires.
  // DummyExceptionStateForTesting is the ExceptionState that records a code
  // with no isolate: nothing is thrown into V8, so nothing needs catching.
  template <class Operation> int32_t Entered(Operation &&operation) {
    if (!entry_depth)
      return kNtsDomNoEntry;
    if (closed)
      return 11; // InvalidStateError
    blink::DummyExceptionStateForTesting exception;
    const int32_t result = std::forward<Operation>(operation)(exception);
    return exception.HadException() ? static_cast<int32_t>(exception.Code())
                                    : result;
  }

  // An entered operation yielding a node: its address, or NULL on null or
  // failure with the code kept for nts_dom_last_error.
  template <class Handle, class Operation>
  Handle *EnteredNode(Operation &&operation) {
    blink::Node *node = nullptr;
    last_error = Entered([&](blink::ExceptionState &exception) {
      return std::forward<Operation>(operation)(exception, node);
    });
    return last_error ? nullptr : HandleOf<Handle>(node);
  }

  // A compiled listener's call: its own entry, as any native callback, and
  // the program's environment entered by the host that owns the program.
  void Dispatch(NtsDomCallback callback, blink::Node *target, void *closure) {
    if (closed || !invoke)
      return;
    scoped_refptr<NtsDomContext> keep_alive(this);
    v8::HandleScope handles(v8_isolate);
    v8::MicrotasksScope microtasks(v8_isolate, event_loop->microtask_queue(),
                                   v8::MicrotasksScope::kRunMicrotasks);
    base::AutoReset<uint32_t> depth(&entry_depth, entry_depth + 1);
    // On this stack for the call: the target is found here by Oilpan's
    // stack scan, as the program's own frames find it.
    struct Call {
      NtsDomCallback callback;
      raw_ptr<NtsDomNode> target;
      raw_ptr<void> closure;
    } call{callback, HandleOf<NtsDomNode>(target), closure};
    invoke(
        invoke_host.get(),
        [](void *state) {
          auto *call = static_cast<Call *>(state);
          call->callback(call->target.get(), call->closure.get());
        },
        &call);
  }

  // Gives a closure back where the program's environment is entered.
  void GiveBack(NtsDomDestroy destroy, void *closure) {
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

  // Blink's own text lent to the program: kept here until the next read,
  // so the view below stays valid while the compiler copies it.
  const NtsStringView *Lend(blink::String text) {
    if (text.IsNull())
      return nullptr;
    lent = std::move(text);
    if (lent.Is8Bit())
      lent_view = {lent.Span8().data(), lent.length(), 0};
    else
      lent_view = {lent.Span16().data(), lent.length(), NTS_STRING_VIEW_WIDE};
    return &lent_view;
  }

  // A job queued by native code: run inside the document's main-world script
  // context with microtasks deferred to the end of the task, as a JS callback
  // would be.
  template <class Operation> void Call(Operation &&operation) {
    if (closed || !document->IsActive() || !document->GetFrame())
      return;
    auto *script = blink::ToScriptStateForMainWorld(document->GetFrame());
    if (!script || !script->ContextIsValid())
      return;
    blink::ScriptState::Scope scope(script);
    auto *isolate = script->GetIsolate();
    v8::MicrotasksScope microtasks(isolate, event_loop->microtask_queue(),
                                   v8::MicrotasksScope::kDoNotRunMicrotasks);
    v8::TryCatch caught(isolate);
    blink::ExceptionState exception(isolate);
    std::forward<Operation>(operation)(isolate, exception);
  }

  void Enqueue(NativeJob::Callback run, NativeJob::Callback drop, void *state,
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
  void PostIdle(NativeJob::Callback run, NativeJob::Callback drop,
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
  void RunIdle(scoped_refptr<NativeJob> job, base::TimeTicks) {
    scoped_refptr<NtsDomContext> keep_alive(this);
    if (!closed)
      job->Run();
    job->Drop();
    Forget(job);
  }
  void Forget(const scoped_refptr<NativeJob> &job) {
    for (blink::wtf_size_t i = 0; i < jobs.size(); ++i) {
      if (jobs[i] == job) {
        jobs.EraseAt(i);
        break;
      }
    }
  }
  void RunJob(scoped_refptr<NativeJob> job, bool end_checkpoint) {
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
  void Close() {
    // Every closure a listener still holds goes back while the program's
    // environment is still there to take it.
    blink::HeapVector<blink::Member<NtsListener>> remaining(listeners->set);
    listeners->set.clear();
    for (auto &listener : remaining) {
      void *closure = nullptr;
      if (auto destroy = listener->Detach(closure))
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
  uint32_t Intern(const blink::String &text) {
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
  const blink::AtomicString *Atom(uint32_t id) const {
    return id && id <= atoms.size() ? &atoms[id - 1] : nullptr;
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
  int32_t last_error = 0;
  blink::Vector<blink::AtomicString> atoms;
  blink::HashMap<blink::AtomicString, uint32_t> atom_ids;
  blink::HashMap<const void *, blink::String> literals;
  blink::HashMap<const void *, blink::AtomicString> names;
  bool closed = false;
  const raw_ptr<v8::Isolate> v8_isolate;
  uint32_t entry_depth = 0;
  uint32_t job_sequence = 0;
  blink::Vector<scoped_refptr<NativeJob>> jobs;
  base::WeakPtrFactory<NtsDomContext> weak_factory{this};

private:
  friend class base::RefCounted<NtsDomContext>;
  ~NtsDomContext() = default;
};

void NtsListener::Invoke(blink::ExecutionContext *, blink::Event *event) {
  if (!callback_)
    return;
  blink::EventTarget *target = event->target();
  context_->Dispatch(callback_, target ? target->ToNode() : nullptr,
                     closure_.get());
}

namespace nts_chromium {
NtsDomContext *CreateDomContext(const blink::WebDocument &document) {
  CHECK(!document.IsNull());
  auto *context = new NtsDomContext(static_cast<blink::Document *>(document));
  context->AddRef();
  return context;
}
} // namespace nts_chromium

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
  scoped_refptr<NtsDomContext> keep_alive(context);
  if (context->closed || !context->document->IsActive())
    return 11;
  v8::HandleScope handles(context->v8_isolate);
  v8::MicrotasksScope microtasks(context->v8_isolate,
                                 context->event_loop->microtask_queue(),
                                 v8::MicrotasksScope::kRunMicrotasks);
  base::AutoReset<uint32_t> depth(&context->entry_depth,
                                  context->entry_depth + 1);
  run(state);
  return 0;
}
size_t nts_blink_dom_roots(void) { return Roots().counts.size(); }
void nts_blink_dom_collect_for_testing(NtsDomContext *context) {
  scoped_refptr<NtsDomContext> keep_alive(context);
  blink::ThreadState::Current()->CollectAllGarbageForTesting(
      blink::ThreadState::StackState::kMayContainHeapPointers);
}
int32_t nts_blink_dom_set_text_view(NtsDomContext *context, NtsDomNode *node,
                                    NtsStringView text) {
  return context->Entered([&](blink::ExceptionState &) {
    const auto value = context->Text(text);
    if (!node || value.IsNull())
      return 1000;
    blink::CEReactionsScope reactions(context->v8_isolate); // [CEReactions]
    NodeOf(node)->setTextContent(value);
    return 0;
  });
}
uint32_t nts_blink_dom_intern(NtsDomContext *context, NtsStringView text) {
  return context->Intern(context->Text(text));
}
void nts_blink_dom_callback(NtsDomContext *context, NativeJob::Callback run,
                            void *state) {
  scoped_refptr<NtsDomContext> keep_alive(context);
  if (context->closed)
    return;
  auto *script = blink::ToScriptStateForMainWorld(context->document->GetFrame());
  if (!script || !script->ContextIsValid())
    return;
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

// The entered DOM ABI (ffi/dom_abi.h). Operations follow their IDL members:
// [CEReactions] members open a reaction scope, the rest do not; nothing here
// enters a V8 context or creates a V8 exception.
void *nts_dom_retain(void *node) {
  Roots().counts.insert(NodeOf(node));
  return node;
}
void nts_dom_release(void *node) {
  // A release with no root to give back is a counting error in the
  // compiler, not anything a program can do: stop where it happened rather
  // than let a later release unroot a node someone still holds.
  auto &counts = Roots().counts;
  const auto found = counts.find(NodeOf(node));
  CHECK(found != counts.end());
  counts.erase(found);
}
int32_t nts_dom_last_error(NtsDomContext *context) {
  return context->last_error;
}
NtsDomDocument *nts_dom_document(NtsDomContext *context) {
  return context->EnteredNode<NtsDomDocument>(
      [&](blink::ExceptionState &, blink::Node *&result) {
        result = context->document.Get();
        return 0;
      });
}
NtsDomElement *nts_dom_query(NtsDomContext *context, NtsDomNode *root,
                             const NtsBorrowedString *selectors) {
  return context->EnteredNode<NtsDomElement>(
      [&](blink::ExceptionState &exception, blink::Node *&result) {
        auto *scope = blink::DynamicTo<blink::ContainerNode>(NodeOf(root));
        if (!scope)
          return 1000;
        result = scope->querySelector(
            context->Name(nts_string_view(selectors)), exception);
        return 0;
      });
}
NtsDomElement *nts_dom_create_element(NtsDomContext *context,
                                      const NtsBorrowedString *tag) {
  return context->EnteredNode<NtsDomElement>(
      [&](blink::ExceptionState &exception, blink::Node *&result) {
        result = context->document->CreateElementForBinding(
            context->Name(nts_string_view(tag)), exception);
        return 0;
      });
}
NtsDomText *nts_dom_create_text(NtsDomContext *context,
                                const NtsBorrowedString *text) {
  return context->EnteredNode<NtsDomText>(
      [&](blink::ExceptionState &, blink::Node *&result) {
        const auto value = context->Text(nts_string_view(text));
        if (value.IsNull())
          return 1000;
        result = context->document->createTextNode(value);
        return 0;
      });
}
NtsDomNode *nts_dom_clone(NtsDomContext *context, NtsDomNode *node,
                          int32_t deep) {
  return context->EnteredNode<NtsDomNode>(
      [&](blink::ExceptionState &exception, blink::Node *&result) {
        // cloneNode is [CEReactions]: cloning a custom element upgrades it.
        blink::CEReactionsScope reactions(context->v8_isolate);
        result = NodeOf(node)->cloneNode(deep != 0, exception);
        return 0;
      });
}
NtsDomElement *nts_dom_clone_element(NtsDomContext *context,
                                     NtsDomElement *element, int32_t deep) {
  return reinterpret_cast<NtsDomElement *>(
      nts_dom_clone(context, reinterpret_cast<NtsDomNode *>(element), deep));
}
NtsDomNode *nts_dom_first_child(NtsDomContext *context, NtsDomNode *node) {
  return context->EnteredNode<NtsDomNode>(
      [&](blink::ExceptionState &, blink::Node *&result) {
        result = NodeOf(node)->firstChild();
        return 0;
      });
}
NtsDomNode *nts_dom_next_sibling(NtsDomContext *context, NtsDomNode *node) {
  return context->EnteredNode<NtsDomNode>(
      [&](blink::ExceptionState &, blink::Node *&result) {
        result = NodeOf(node)->nextSibling();
        return 0;
      });
}
NtsDomElement *nts_dom_as_element(NtsDomContext *context, NtsDomNode *node) {
  return context->EnteredNode<NtsDomElement>(
      [&](blink::ExceptionState &, blink::Node *&result) {
        result = blink::DynamicTo<blink::Element>(NodeOf(node));
        return 0;
      });
}
NtsDomText *nts_dom_as_text(NtsDomContext *context, NtsDomNode *node) {
  return context->EnteredNode<NtsDomText>(
      [&](blink::ExceptionState &, blink::Node *&result) {
        result = blink::DynamicTo<blink::Text>(NodeOf(node));
        return 0;
      });
}
int32_t nts_dom_append_child(NtsDomContext *context, NtsDomNode *parent,
                             NtsDomNode *child) {
  return context->Entered([&](blink::ExceptionState &exception) {
    blink::CEReactionsScope reactions(context->v8_isolate);
    NodeOf(parent)->appendChild(NodeOf(child), exception);
    return 0;
  });
}
int32_t nts_dom_insert_before(NtsDomContext *context, NtsDomNode *parent,
                              NtsDomNode *child, NtsDomNode *reference) {
  return context->Entered([&](blink::ExceptionState &exception) {
    blink::CEReactionsScope reactions(context->v8_isolate);
    NodeOf(parent)->insertBefore(NodeOf(child),
                                 reference ? NodeOf(reference) : nullptr,
                                 exception);
    return 0;
  });
}
int32_t nts_dom_remove_child(NtsDomContext *context, NtsDomNode *parent,
                             NtsDomNode *child) {
  return context->Entered([&](blink::ExceptionState &exception) {
    blink::CEReactionsScope reactions(context->v8_isolate);
    NodeOf(parent)->removeChild(NodeOf(child), exception);
    return 0;
  });
}
int32_t nts_dom_remove(NtsDomContext *context, NtsDomNode *node) {
  return context->Entered([&](blink::ExceptionState &exception) {
    blink::CEReactionsScope reactions(context->v8_isolate);
    NodeOf(node)->remove(exception);
    return 0;
  });
}
int32_t nts_dom_set_text_content(NtsDomContext *context, NtsDomNode *node,
                                 const NtsBorrowedString *text) {
  return nts_blink_dom_set_text_view(context, node, nts_string_view(text));
}
int32_t nts_dom_set_attribute(NtsDomContext *context, NtsDomElement *element,
                              const NtsBorrowedString *name,
                              const NtsBorrowedString *value) {
  return context->Entered([&](blink::ExceptionState &exception) {
    auto *target = blink::DynamicTo<blink::Element>(NodeOf(element));
    if (!target)
      return 1000;
    blink::CEReactionsScope reactions(context->v8_isolate);
    target->setAttribute(context->Name(nts_string_view(name)),
                         context->Name(nts_string_view(value)), exception);
    return 0;
  });
}
const NtsStringView *nts_dom_text_content(NtsDomContext *context,
                                          NtsDomNode *node) {
  blink::String text;
  context->last_error = context->Entered([&](blink::ExceptionState &) {
    text = NodeOf(node)->textContent();
    return 0;
  });
  return context->last_error ? nullptr : context->Lend(std::move(text));
}
const NtsStringView *nts_dom_get_attribute(NtsDomContext *context,
                                           NtsDomElement *element,
                                           const NtsBorrowedString *name) {
  blink::String value;
  context->last_error = context->Entered([&](blink::ExceptionState &) {
    auto *target = blink::DynamicTo<blink::Element>(NodeOf(element));
    if (!target)
      return 1000;
    value = target->getAttribute(context->Name(nts_string_view(name)));
    return 0;
  });
  return context->last_error ? nullptr : context->Lend(std::move(value));
}
NtsDomListener *nts_dom_listen(NtsDomContext *context, NtsDomNode *target,
                               const NtsBorrowedString *type,
                               NtsDomCallback callback, void *closure,
                               NtsDomDestroy destroy) {
  NtsListener *listener = nullptr;
  context->last_error = context->Entered([&](blink::ExceptionState &) {
    if (!context->invoke || !target || !callback)
      return 1000;
    const auto name = context->Name(nts_string_view(type));
    listener = blink::MakeGarbageCollected<NtsListener>(
        context, NodeOf(target), name, callback, closure, destroy);
    if (!NodeOf(target)->addEventListener(name, listener))
      return 1000;
    context->listeners->set.insert(listener);
    return 0;
  });
  if (context->last_error) {
    // Nothing keeps the closure, so it goes back now -- the program's own
    // call, its environment entered.
    if (destroy)
      destroy(closure);
    return nullptr;
  }
  return reinterpret_cast<NtsDomListener *>(listener);
}
int32_t nts_dom_unlisten(NtsDomContext *context, NtsDomListener *handle) {
  void *closure = nullptr;
  NtsDomDestroy destroy = nullptr;
  const int32_t status = context->Entered([&](blink::ExceptionState &) {
    auto *listener = reinterpret_cast<NtsListener *>(handle);
    if (!listener)
      return 1000;
    context->listeners->set.erase(listener);
    destroy = listener->Detach(closure);
    return 0;
  });
  // Inside the program's call: its environment is entered already.
  if (destroy)
    destroy(closure);
  return status;
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
int32_t nts_dom_click(NtsDomContext *context, NtsDomElement *element) {
  return context->Entered([&](blink::ExceptionState &) {
    auto *target = blink::DynamicTo<blink::HTMLElement>(NodeOf(element));
    if (!target)
      return 1000;
    target->click();
    return 0;
  });
}
uint32_t nts_dom_intern(NtsDomContext *context,
                        const NtsBorrowedString *text) {
  return nts_blink_dom_intern(context, nts_string_view(text));
}
int32_t nts_dom_set_text_interned(NtsDomContext *context, NtsDomNode *node,
                                  uint32_t atom) {
  return context->Entered([&](blink::ExceptionState &) {
    const auto *text = context->Atom(atom);
    if (!text)
      return 1000;
    blink::CEReactionsScope reactions(context->v8_isolate);
    NodeOf(node)->setTextContent(*text);
    return 0;
  });
}
} // extern "C"
