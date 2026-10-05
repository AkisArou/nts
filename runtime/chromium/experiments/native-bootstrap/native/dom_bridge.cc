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
#include "third_party/blink/renderer/core/dom/text.h"
#include "third_party/blink/renderer/core/execution_context/agent.h"
#include "third_party/blink/renderer/core/execution_context/execution_context.h"
#include "third_party/blink/renderer/core/html/custom/ce_reactions_scope.h"
#include "third_party/blink/renderer/core/html/html_element.h"
#include "third_party/blink/renderer/platform/bindings/exception_state.h"
#include "third_party/blink/renderer/platform/bindings/script_state.h"
#include "third_party/blink/renderer/platform/heap/collection_support/heap_hash_map.h"
#include "third_party/blink/renderer/platform/heap/collection_support/heap_vector.h"
#include "third_party/blink/renderer/platform/heap/persistent.h"
#include "third_party/blink/renderer/platform/heap/thread_state.h"
#include "third_party/blink/renderer/platform/scheduler/public/event_loop.h"
#include "third_party/blink/renderer/platform/scheduler/public/thread_scheduler.h"
#include "third_party/blink/renderer/platform/wtf/hash_map.h"
#include "third_party/blink/renderer/platform/wtf/text/atomic_string.h"
#include "third_party/blink/renderer/platform/wtf/text/string_impl.h"
#include "third_party/blink/renderer/platform/wtf/vector.h"
#include "v8/include/v8.h"

namespace {

// Both tables are traced. Lookup preserves canonical identity without a
// linear scan, and indexed handles are exact in a TypeScript number.
class NodeRegistry final : public blink::GarbageCollected<NodeRegistry> {
public:
  explicit NodeRegistry(blink::Document *document) : document(document) {}
  void Trace(blink::Visitor *visitor) const {
    visitor->Trace(document);
    visitor->Trace(nodes);
    visitor->Trace(identity);
  }
  blink::Member<blink::Document> document;
  blink::HeapVector<blink::Member<blink::Node>> nodes;
  blink::HeapHashMap<blink::Member<blink::Node>, uint32_t> identity;
};

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
      : roots(blink::MakeGarbageCollected<NodeRegistry>(document)),
        event_loop(document->GetExecutionContext()->GetAgent()->event_loop()),
        v8_isolate(document->GetExecutionContext()->GetIsolate()) {}

  // A handle is slot + 1 in its low 24 bits and the slot's generation above
  // them, so a released handle cannot name the slot's next node. The first
  // lease of a fresh slot has generation 0: the original API's index.
  static constexpr uint32_t kSlotBits = 24;
  static constexpr uint32_t kSlotMask = (1u << kSlotBits) - 1;
  static uint32_t Handle(uint32_t slot, uint8_t generation) {
    return (uint32_t{generation} << kSlotBits) | (slot + 1);
  }
  // The live slot a handle names, or kSlotMask if it names none.
  uint32_t Slot(uint32_t handle) const {
    const uint32_t slot = (handle & kSlotMask) - 1;
    return (handle & kSlotMask) && slot < roots->nodes.size() &&
                   roots->nodes[slot] &&
                   generations[slot] == handle >> kSlotBits
               ? slot
               : kSlotMask;
  }
  blink::Node *Lookup(uint32_t handle) {
    const uint32_t slot = Slot(handle);
    return slot == kSlotMask ? nullptr : roots->nodes[slot].Get();
  }
  // Ends one lease; the last one unroots the node and retires the handle.
  void ReleaseLease(uint32_t handle) {
    const uint32_t slot = Slot(handle);
    if (slot == kSlotMask || --leases[slot])
      return;
    roots->identity.erase(roots->nodes[slot]);
    roots->nodes[slot] = nullptr;
    ++generations[slot];
    free_slots.push_back(slot);
  }

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

  // An entered operation yielding a node: one lease for the caller, or 0 on
  // null or failure with the code kept for nts_dom_last_error.
  template <class Operation> uint32_t EnteredNode(Operation &&operation) {
    blink::Node *node = nullptr;
    last_error = Entered([&](blink::ExceptionState &exception) {
      return std::forward<Operation>(operation)(exception, node);
    });
    return last_error ? 0 : Bind(node);
  }

  uint32_t Bind(blink::Node *node) {
    if (closed) {
      status = 11;
      return 0;
    }
    if (!node)
      return 0;
    // Each returned handle is one lease; identity keeps it one handle.
    const auto existing = roots->identity.find(node);
    if (existing != roots->identity.end()) {
      ++leases[Slot(existing->value)];
      return existing->value;
    }
    uint32_t slot;
    if (free_slots.empty()) {
      CHECK_LT(roots->nodes.size(), kSlotMask - 1);
      slot = roots->nodes.size();
      roots->nodes.push_back(node);
      leases.push_back(1);
      generations.push_back(0);
    } else {
      slot = free_slots.back();
      free_slots.pop_back();
      roots->nodes[slot] = node;
      leases[slot] = 1;
    }
    const uint32_t handle = Handle(slot, generations[slot]);
    roots->identity.insert(node, handle);
    return handle;
  }

  blink::Node *Node(uint32_t id) {
    auto *node = Lookup(id);
    if (!node)
      status = 1000; // Experimental boundary TypeError, not a DOM legacy code.
    return node;
  }

  template <class Operation>
  void Invoke(v8::Isolate *isolate, Operation &&operation) {
    v8::TryCatch caught(isolate);
    {
      blink::ExceptionState exception(isolate);
      std::forward<Operation>(operation)(isolate, exception);
      if (exception.HadException()) {
        auto *dom =
            blink::V8DOMException::ToWrappable(isolate, caught.Exception());
        status = dom ? dom->code() : 1000;
      }
    }
    caught.Reset();
  }

  template <class Operation> void Call(Operation &&operation) {
    status = 0;
    if (closed) {
      status = 11;
      return;
    }
    if (!roots->document->IsActive() || !roots->document->GetFrame()) {
      status = 11;
      return;
    }
    auto *script =
        blink::ToScriptStateForMainWorld(roots->document->GetFrame());
    if (!script || !script->ContextIsValid()) {
      status = 11; // InvalidStateError
      return;
    }
    // A synchronous reaction can reenter from another realm. The lexical
    // entry saves setup only while its document context is actually current.
    if (native_entry_depth &&
        script->GetContext() == script->GetIsolate()->GetCurrentContext()) {
      Invoke(script->GetIsolate(), std::forward<Operation>(operation));
      return;
    }
    blink::ScriptState::Scope scope(script);
    auto *isolate = script->GetIsolate();
    // Native calls form part of the surrounding task. A V8 reaction must not
    // cause a checkpoint halfway through the compiled application's call.
    v8::MicrotasksScope microtasks(isolate, event_loop->microtask_queue(),
                                   v8::MicrotasksScope::kDoNotRunMicrotasks);
    Invoke(isolate, std::forward<Operation>(operation));
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
        auto *trace =
            roots->document->getElementById(blink::AtomicString("native-jobs"));
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
    closed = true;
    weak_factory.InvalidateWeakPtrs();
    for (auto &job : jobs)
      job->Drop();
    jobs.clear();
    roots->nodes.clear();
    roots->identity.clear();
    leases.clear();
    generations.clear();
    free_slots.clear();
    atoms.clear();
    atom_ids.clear();
    literals.clear();
  }

  // Names and literal text are interned once; operations then pass an id.
  // An AtomicString shares its StringImpl with String, so a text write from
  // the table is a reference, not a copy -- what V8 externalization gives
  // page script for a repeated string. Ids are dense and never reused.
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
  // Text from a program's string. A literal (NTS_STRING_VIEW_IMMORTAL) has
  // units that never move or change, so it is copied once per document and
  // shared after, keyed by their address: what interning gives a name, with
  // no id for the program to keep. The table is bounded by the program's
  // literals. Every other string is copied, once.
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
  const blink::AtomicString *Atom(uint32_t id) const {
    return id && id <= atoms.size() ? &atoms[id - 1] : nullptr;
  }

  blink::Persistent<NodeRegistry> roots;
  // The document's execution context may already be detached when the
  // observer closes. Capture its actual agent loop while the document lives;
  // queued callbacks still need explicit revocation because that loop is
  // shared.
  const scoped_refptr<blink::scheduler::EventLoop> event_loop;
  // The text read_text last lent, kept alive until the next read.
  blink::String read_text;
  blink::Vector<uint32_t> leases;
  blink::Vector<uint8_t> generations;
  blink::Vector<uint32_t> free_slots;
  int32_t last_error = 0;
  blink::Vector<blink::AtomicString> atoms;
  blink::HashMap<blink::AtomicString, uint32_t> atom_ids;
  blink::HashMap<const void *, blink::String> literals;
  int32_t status = 0;
  bool closed = false;
  uint32_t native_entry_depth = 0;
  const raw_ptr<v8::Isolate> v8_isolate;
  uint32_t entry_depth = 0;
  uint32_t job_sequence = 0;
  blink::Vector<scoped_refptr<NativeJob>> jobs;
  base::WeakPtrFactory<NtsDomContext> weak_factory{this};

private:
  friend class base::RefCounted<NtsDomContext>;
  ~NtsDomContext() = default;
};

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
void nts_blink_dom_native_scope(NtsDomContext *context, NativeJob::Callback run,
                                void *state) {
  scoped_refptr<NtsDomContext> keep_alive(context);
  if (context->closed || !context->roots->document->IsActive() ||
      !context->roots->document->GetFrame()) {
    context->status = 11;
    return;
  }
  auto *script =
      blink::ToScriptStateForMainWorld(context->roots->document->GetFrame());
  if (!script || !script->ContextIsValid()) {
    context->status = 11;
    return;
  }
  blink::ScriptState::Scope scope(script);
  v8::MicrotasksScope microtasks(script->GetIsolate(),
                                 context->event_loop->microtask_queue(),
                                 v8::MicrotasksScope::kDoNotRunMicrotasks);
  base::AutoReset<uint32_t> depth(&context->native_entry_depth,
                                  context->native_entry_depth + 1);
  run(state);
}
int32_t nts_blink_dom_entry(NtsDomContext *context, NativeJob::Callback run,
                            void *state) {
  scoped_refptr<NtsDomContext> keep_alive(context);
  if (context->closed || !context->roots->document->IsActive())
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
int32_t nts_blink_dom_set_text_view(NtsDomContext *context, uint32_t id,
                                    NtsStringView text) {
  return context->Entered([&](blink::ExceptionState &) {
    auto *node = context->Lookup(id);
    const auto value = context->Text(text);
    if (!node || value.IsNull())
      return 1000;
    blink::CEReactionsScope reactions(context->v8_isolate); // [CEReactions]
    node->setTextContent(value);
    return 0;
  });
}
uint32_t nts_blink_dom_intern(NtsDomContext *context, NtsStringView text) {
  return context->Intern(context->Text(text));
}
int32_t nts_blink_dom_set_text_atom(NtsDomContext *context, uint32_t id,
                                    uint32_t atom) {
  return context->Entered([&](blink::ExceptionState &) {
    auto *node = context->Lookup(id);
    const auto *text = context->Atom(atom);
    if (!node || !text)
      return 1000;
    blink::CEReactionsScope reactions(context->v8_isolate);
    node->setTextContent(*text);
    return 0;
  });
}
uint32_t nts_blink_dom_body(NtsDomContext *context) {
  scoped_refptr<NtsDomContext> keep_alive(context);
  uint32_t result = 0;
  context->Call([&](v8::Isolate *, blink::ExceptionState &) {
    result = context->Bind(context->roots->document->body());
  });
  return result;
}
uint32_t nts_blink_dom_query(NtsDomContext *context, NtsStringView selector) {
  scoped_refptr<NtsDomContext> keep_alive(context);
  uint32_t result = 0;
  context->Call([&](v8::Isolate *, blink::ExceptionState &exception) {
    auto *node = context->roots->document->querySelector(
        blink::AtomicString(context->Text(selector)), exception);
    if (!exception.HadException())
      result = context->Bind(node);
  });
  return result;
}
uint32_t nts_blink_dom_element(NtsDomContext *context, NtsStringView name) {
  scoped_refptr<NtsDomContext> keep_alive(context);
  uint32_t result = 0;
  context->Call([&](v8::Isolate *, blink::ExceptionState &exception) {
    auto *node = context->roots->document->CreateElementForBinding(
        blink::AtomicString(context->Text(name)), exception);
    if (!exception.HadException())
      result = context->Bind(node);
  });
  return result;
}
uint32_t nts_blink_dom_text(NtsDomContext *context, NtsStringView text) {
  scoped_refptr<NtsDomContext> keep_alive(context);
  uint32_t result = 0;
  context->Call([&](v8::Isolate *, blink::ExceptionState &) {
    result = context->Bind(
        context->roots->document->createTextNode(context->Text(text)));
  });
  return result;
}
uint32_t nts_blink_dom_append(NtsDomContext *context, uint32_t parent,
                              uint32_t child) {
  scoped_refptr<NtsDomContext> keep_alive(context);
  uint32_t result = 0;
  context->Call([&](v8::Isolate *isolate, blink::ExceptionState &exception) {
    blink::CEReactionsScope reactions(isolate);
    auto *p = context->Node(parent);
    auto *n = context->Node(child);
    if (!p || !n)
      return;
    auto *node = p->appendChild(n, exception);
    if (!exception.HadException())
      result = context->Bind(node);
  });
  return result;
}
uint32_t nts_blink_dom_remove(NtsDomContext *context, uint32_t parent,
                              uint32_t child) {
  scoped_refptr<NtsDomContext> keep_alive(context);
  uint32_t result = 0;
  context->Call([&](v8::Isolate *isolate, blink::ExceptionState &exception) {
    blink::CEReactionsScope reactions(isolate);
    auto *p = context->Node(parent);
    auto *n = context->Node(child);
    if (!p || !n)
      return;
    auto *node = p->removeChild(n, exception);
    if (!exception.HadException())
      result = context->Bind(node);
  });
  return result;
}
int32_t nts_blink_dom_set_text(NtsDomContext *context, uint32_t id,
                               NtsStringView text) {
  scoped_refptr<NtsDomContext> keep_alive(context);
  context->Call([&](v8::Isolate *isolate, blink::ExceptionState &) {
    blink::CEReactionsScope reactions(isolate);
    if (auto *node = context->Node(id))
      node->setTextContent(context->Text(text));
  });
  return context->status;
}
int32_t nts_blink_dom_set_attribute(NtsDomContext *context, uint32_t id,
                                    NtsStringView name, NtsStringView value) {
  scoped_refptr<NtsDomContext> keep_alive(context);
  context->Call([&](v8::Isolate *isolate, blink::ExceptionState &exception) {
    blink::CEReactionsScope reactions(isolate);
    auto *element = blink::DynamicTo<blink::Element>(context->Node(id));
    if (!element) {
      context->status = 1000;
      return;
    }
    element->setAttribute(blink::AtomicString(context->Text(name)),
                          blink::AtomicString(context->Text(value)), exception);
  });
  return context->status;
}
NtsStringView nts_blink_dom_read_text(NtsDomContext *context, uint32_t id) {
  scoped_refptr<NtsDomContext> keep_alive(context);
  context->read_text = blink::g_empty_string;
  context->Call([&](v8::Isolate *, blink::ExceptionState &) {
    if (auto *node = context->Node(id))
      context->read_text = node->textContentForBinding();
  });
  const auto &text = context->read_text;
  if (text.IsNull() || text.empty())
    return {"", 0, 0};
  if (text.Is8Bit())
    return {text.Span8().data(), text.length(), 0};
  return {text.Span16().data(), text.length(), NTS_STRING_VIEW_WIDE};
}
int32_t nts_blink_dom_status(NtsDomContext *context) {
  scoped_refptr<NtsDomContext> keep_alive(context);
  return context->status;
}
size_t nts_blink_dom_roots(NtsDomContext *context) {
  return context->roots->identity.size();
}
void nts_blink_dom_collect_for_testing(NtsDomContext *context) {
  scoped_refptr<NtsDomContext> keep_alive(context);
  blink::ThreadState::Current()->CollectAllGarbageForTesting(
      blink::ThreadState::StackState::kMayContainHeapPointers);
}
void nts_blink_dom_callback(NtsDomContext *context, NativeJob::Callback run,
                            void *state) {
  scoped_refptr<NtsDomContext> keep_alive(context);
  if (context->closed)
    return;
  auto *script =
      blink::ToScriptStateForMainWorld(context->roots->document->GetFrame());
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
uint32_t nts_dom_intern(NtsDomContext *context,
                        const NtsBorrowedString *text) {
  return nts_blink_dom_intern(context, nts_string_view(text));
}
void nts_dom_release(NtsDomContext *context, uint32_t node) {
  context->ReleaseLease(node);
}
int32_t nts_dom_last_error(NtsDomContext *context) {
  return context->last_error;
}
uint32_t nts_dom_document(NtsDomContext *context) {
  return context->EnteredNode(
      [&](blink::ExceptionState &, blink::Node *&result) {
        result = context->roots->document.Get();
        return 0;
      });
}
uint32_t nts_dom_query_atom(NtsDomContext *context, uint32_t root,
                            uint32_t selector) {
  return context->EnteredNode(
      [&](blink::ExceptionState &exception, blink::Node *&result) {
        auto *scope = blink::DynamicTo<blink::ContainerNode>(
            context->Lookup(root));
        const auto *text = context->Atom(selector);
        if (!scope || !text)
          return 1000;
        result = scope->QuerySelector(*text, exception);
        return 0;
      });
}
uint32_t nts_dom_create_element(NtsDomContext *context, uint32_t tag) {
  return context->EnteredNode(
      [&](blink::ExceptionState &exception, blink::Node *&result) {
        const auto *name = context->Atom(tag);
        if (!name)
          return 1000;
        result = context->roots->document->CreateElementForBinding(*name,
                                                                   exception);
        return 0;
      });
}
uint32_t nts_dom_create_text(NtsDomContext *context,
                             const NtsBorrowedString *text) {
  return context->EnteredNode(
      [&](blink::ExceptionState &, blink::Node *&result) {
        const auto value = context->Text(nts_string_view(text));
        if (value.IsNull())
          return 1000;
        result = context->roots->document->createTextNode(value);
        return 0;
      });
}
uint32_t nts_dom_clone(NtsDomContext *context, uint32_t node, int32_t deep) {
  return context->EnteredNode(
      [&](blink::ExceptionState &exception, blink::Node *&result) {
        auto *source = context->Lookup(node);
        if (!source)
          return 1000;
        // cloneNode is [CEReactions]: cloning a custom element upgrades it.
        blink::CEReactionsScope reactions(context->v8_isolate);
        result = source->cloneNode(deep != 0, exception);
        return 0;
      });
}
uint32_t nts_dom_first_child(NtsDomContext *context, uint32_t node) {
  return context->EnteredNode(
      [&](blink::ExceptionState &, blink::Node *&result) {
        auto *parent = context->Lookup(node);
        if (!parent)
          return 1000;
        result = parent->firstChild();
        return 0;
      });
}
uint32_t nts_dom_next_sibling(NtsDomContext *context, uint32_t node) {
  return context->EnteredNode(
      [&](blink::ExceptionState &, blink::Node *&result) {
        auto *self = context->Lookup(node);
        if (!self)
          return 1000;
        result = self->nextSibling();
        return 0;
      });
}
int32_t nts_dom_append_child(NtsDomContext *context, uint32_t parent,
                             uint32_t child) {
  return context->Entered([&](blink::ExceptionState &exception) {
    auto *p = context->Lookup(parent);
    auto *c = context->Lookup(child);
    if (!p || !c)
      return 1000;
    blink::CEReactionsScope reactions(context->v8_isolate);
    p->appendChild(c, exception);
    return 0;
  });
}
int32_t nts_dom_insert_before(NtsDomContext *context, uint32_t parent,
                              uint32_t child, uint32_t reference) {
  return context->Entered([&](blink::ExceptionState &exception) {
    auto *p = context->Lookup(parent);
    auto *c = context->Lookup(child);
    auto *r = reference ? context->Lookup(reference) : nullptr;
    if (!p || !c || (reference && !r))
      return 1000;
    blink::CEReactionsScope reactions(context->v8_isolate);
    p->insertBefore(c, r, exception);
    return 0;
  });
}
int32_t nts_dom_remove_node(NtsDomContext *context, uint32_t node) {
  return context->Entered([&](blink::ExceptionState &exception) {
    auto *self = context->Lookup(node);
    if (!self)
      return 1000;
    blink::CEReactionsScope reactions(context->v8_isolate);
    self->remove(exception);
    return 0;
  });
}
int32_t nts_dom_set_text_value(NtsDomContext *context, uint32_t node,
                               const NtsBorrowedString *text) {
  return nts_blink_dom_set_text_view(context, node, nts_string_view(text));
}
int32_t nts_dom_set_text_interned(NtsDomContext *context, uint32_t node,
                                  uint32_t atom) {
  return nts_blink_dom_set_text_atom(context, node, atom);
}
int32_t nts_dom_set_attribute_interned(NtsDomContext *context,
                                       uint32_t element, uint32_t name,
                                       uint32_t value) {
  return context->Entered([&](blink::ExceptionState &exception) {
    auto *target = blink::DynamicTo<blink::Element>(context->Lookup(element));
    const auto *n = context->Atom(name);
    const auto *v = context->Atom(value);
    if (!target || !n || !v)
      return 1000;
    blink::CEReactionsScope reactions(context->v8_isolate);
    target->setAttribute(*n, *v, exception);
    return 0;
  });
}
} // extern "C"
