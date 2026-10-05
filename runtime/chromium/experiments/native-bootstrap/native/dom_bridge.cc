#include "nts/dom_bridge_bindings.h"

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

blink::String CopyStringVector(NtsDomString input) {
  CHECK(input.data || input.length == 0);
  // The C ABI caller supplies length live uint16_t elements for this call.
  // Span construction is the sole unchecked memory boundary; String copies.
  const auto units = UNSAFE_BUFFERS(base::span(input.data, input.length));
  blink::Vector<UChar> copy;
  CHECK_LE(input.length, std::numeric_limits<uint32_t>::max());
  copy.ReserveInitialCapacity(static_cast<uint32_t>(input.length));
  for (uint16_t unit : units)
    copy.push_back(static_cast<UChar>(unit));
  return copy.empty() ? blink::g_empty_string : blink::String(copy);
}

blink::String CopyString(NtsDomString input) {
  CHECK(input.data || input.length == 0);
  CHECK_LE(input.length, std::numeric_limits<uint32_t>::max());
  if (!input.length)
    return blink::g_empty_string;
  // Copy straight into owned Blink storage. Byte spans avoid aliasing a
  // uint16_t array as UChar; no temporary vector or second character copy.
  static_assert(sizeof(UChar) == sizeof(uint16_t));
  const auto units = UNSAFE_BUFFERS(base::span(input.data, input.length));
  base::span<UChar> destination;
  auto impl = blink::StringImpl::CreateUninitialized(input.length, destination);
  base::as_writable_bytes(destination).copy_from(base::as_bytes(units));
  return blink::String(std::move(impl));
}

} // namespace

struct NtsDomContext : public base::RefCounted<NtsDomContext> {
  explicit NtsDomContext(blink::Document *document)
      : roots(blink::MakeGarbageCollected<NodeRegistry>(document)),
        event_loop(document->GetExecutionContext()->GetAgent()->event_loop()) {}

  uint32_t Bind(blink::Node *node) {
    if (closed) {
      status = 11;
      return 0;
    }
    if (!node)
      return 0;
    const auto existing = roots->identity.find(node);
    if (existing != roots->identity.end())
      return existing->value;
    CHECK_LT(roots->nodes.size(), std::numeric_limits<uint32_t>::max());
    roots->nodes.push_back(node);
    const uint32_t handle = roots->nodes.size();
    roots->identity.insert(node, handle);
    return handle;
  }

  blink::Node *Node(uint32_t id) {
    if (!id || id > roots->nodes.size()) {
      status = 1000; // Experimental boundary TypeError, not a DOM legacy code.
      return nullptr;
    }
    return roots->nodes[id - 1].Get();
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
    for (blink::wtf_size_t i = 0; i < jobs.size(); ++i) {
      if (jobs[i] == job) {
        jobs.EraseAt(i);
        break;
      }
    }
  }
  void Close() {
    closed = true;
    weak_factory.InvalidateWeakPtrs();
    for (auto &job : jobs)
      job->Drop();
    jobs.clear();
    roots->nodes.clear();
    roots->identity.clear();
  }

  blink::Persistent<NodeRegistry> roots;
  // The document's execution context may already be detached when the
  // observer closes. Capture its actual agent loop while the document lives;
  // queued callbacks still need explicit revocation because that loop is
  // shared.
  const scoped_refptr<blink::scheduler::EventLoop> event_loop;
  blink::Vector<uint16_t> read_buffer;
  int32_t status = 0;
  bool closed = false;
  uint32_t native_entry_depth = 0;
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
int32_t nts_blink_dom_set_text_vector_for_benchmark(NtsDomContext *context,
                                                    uint32_t id,
                                                    NtsDomString text) {
  scoped_refptr<NtsDomContext> keep_alive(context);
  context->Call([&](v8::Isolate *isolate, blink::ExceptionState &) {
    blink::CEReactionsScope reactions(isolate);
    if (auto *node = context->Node(id))
      node->setTextContent(CopyStringVector(text));
  });
  return context->status;
}
uint32_t nts_blink_dom_body(NtsDomContext *context) {
  scoped_refptr<NtsDomContext> keep_alive(context);
  uint32_t result = 0;
  context->Call([&](v8::Isolate *, blink::ExceptionState &) {
    result = context->Bind(context->roots->document->body());
  });
  return result;
}
uint32_t nts_blink_dom_query(NtsDomContext *context, NtsDomString selector) {
  scoped_refptr<NtsDomContext> keep_alive(context);
  uint32_t result = 0;
  context->Call([&](v8::Isolate *, blink::ExceptionState &exception) {
    auto *node = context->roots->document->querySelector(
        blink::AtomicString(CopyString(selector)), exception);
    if (!exception.HadException())
      result = context->Bind(node);
  });
  return result;
}
uint32_t nts_blink_dom_element(NtsDomContext *context, NtsDomString name) {
  scoped_refptr<NtsDomContext> keep_alive(context);
  uint32_t result = 0;
  context->Call([&](v8::Isolate *, blink::ExceptionState &exception) {
    auto *node = context->roots->document->CreateElementForBinding(
        blink::AtomicString(CopyString(name)), exception);
    if (!exception.HadException())
      result = context->Bind(node);
  });
  return result;
}
uint32_t nts_blink_dom_text(NtsDomContext *context, NtsDomString text) {
  scoped_refptr<NtsDomContext> keep_alive(context);
  uint32_t result = 0;
  context->Call([&](v8::Isolate *, blink::ExceptionState &) {
    result = context->Bind(
        context->roots->document->createTextNode(CopyString(text)));
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
                               NtsDomString text) {
  scoped_refptr<NtsDomContext> keep_alive(context);
  context->Call([&](v8::Isolate *isolate, blink::ExceptionState &) {
    blink::CEReactionsScope reactions(isolate);
    if (auto *node = context->Node(id))
      node->setTextContent(CopyString(text));
  });
  return context->status;
}
int32_t nts_blink_dom_set_attribute(NtsDomContext *context, uint32_t id,
                                    NtsDomString name, NtsDomString value) {
  scoped_refptr<NtsDomContext> keep_alive(context);
  context->Call([&](v8::Isolate *isolate, blink::ExceptionState &exception) {
    blink::CEReactionsScope reactions(isolate);
    auto *element = blink::DynamicTo<blink::Element>(context->Node(id));
    if (!element) {
      context->status = 1000;
      return;
    }
    element->setAttribute(blink::AtomicString(CopyString(name)),
                          blink::AtomicString(CopyString(value)), exception);
  });
  return context->status;
}
NtsDomString nts_blink_dom_read_text(NtsDomContext *context, uint32_t id) {
  scoped_refptr<NtsDomContext> keep_alive(context);
  context->read_buffer.clear();
  context->Call([&](v8::Isolate *, blink::ExceptionState &) {
    auto *node = context->Node(id);
    if (!node)
      return;
    const auto text = node->textContentForBinding();
    context->read_buffer.ReserveInitialCapacity(text.length());
    for (unsigned i = 0; i < text.length(); ++i)
      context->read_buffer.push_back(text[i]);
  });
  return {context->read_buffer.data(), context->read_buffer.size()};
}
int32_t nts_blink_dom_status(NtsDomContext *context) {
  scoped_refptr<NtsDomContext> keep_alive(context);
  return context->status;
}
size_t nts_blink_dom_roots(NtsDomContext *context) {
  return context->roots->nodes.size();
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
void nts_blink_dom_end_checkpoint(NtsDomContext *context,
                                  NativeJob::Callback run,
                                  NativeJob::Callback drop, void *state) {
  scoped_refptr<NtsDomContext> keep_alive(context);
  context->Enqueue(run, drop, state, true);
}
} // extern "C"
