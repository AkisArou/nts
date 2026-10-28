/* The traced callback enumerates edges, never owns their destruction. The
 * generic control differs only in its descriptor's callback pointers. */
#include "nts_runtime.h"
#include <stdio.h>

typedef struct Node {
  NtsHeader header;
  struct Node *left;
  struct Node *right;
  NtsValue value;
  void *foreign;
} Node;

typedef struct Holder {
  NtsHeader node;
  Node *held;
  Node *owner;
  uint64_t epoch;
  uintptr_t native_count;
  bool enumerated;
} Holder;

static int failures;
static size_t traces, releases, severed, finalized, handles_released;
static void check(const char *name, bool holds) {
  printf("%s %s\n", holds ? "ok" : "FAIL", name);
  failures += !holds;
}

static void trace_fields(NtsHeader *object, void (*visit)(NtsHeader *)) {
  Node *node = (Node *)object;
  traces++;
  if (node->foreign) {
    Holder *holder = node->foreign;
    check("holder edges precede typed managed fields", holder->enumerated);
    holder->enumerated = false;
  }
  if (node->left)
    visit(&node->left->header);
  if (node->right)
    visit(&node->right->header);
  if (NTS_TAG_IS_MANAGED(nts_value_tag(node->value)) &&
      nts_value_reference(node->value))
    visit(nts_value_reference(node->value));
}

static void release_fields(NtsHeader *object) {
  Node *node = (Node *)object;
  releases++;
  if (node->left)
    nts_release(&node->left->header);
  if (node->right)
    nts_release(&node->right->header);
  if (NTS_TAG_IS_MANAGED(nts_value_tag(node->value)) &&
      nts_value_reference(node->value))
    nts_release(nts_value_reference(node->value));
}

static const uint32_t references[] = {offsetof(Node, left),
                                      offsetof(Node, right)};
static const uint32_t erased[] = {offsetof(Node, value)};
static const NtsDescriptor typed = {.kind = NTS_KIND_OBJECT,
                                    .size = sizeof(Node),
                                    .references = 2,
                                    .cyclic = 1,
                                    .offsets = references,
                                    .name = "typed-trace",
                                    .erased = 1,
                                    .erased_offsets = erased,
                                    .release_fields = release_fields,
                                    .trace_fields = trace_fields};
static const NtsDescriptor generic = {.kind = NTS_KIND_OBJECT,
                                      .size = sizeof(Node),
                                      .references = 2,
                                      .cyclic = 1,
                                      .offsets = references,
                                      .name = "generic-trace",
                                      .erased = 1,
                                      .erased_offsets = erased};
static const NtsDescriptor refs = {.kind = NTS_KIND_ARRAY,
                                   .size = sizeof(NtsHeader *),
                                   .references = 1,
                                   .cyclic = 1,
                                   .element = NTS_ARRAY_REFERENCE};

_Static_assert(offsetof(NtsDescriptor, trace_fields) ==
                   offsetof(NtsDescriptor, release_fields) + sizeof(void *),
               "tracing appends a pointer without moving owned cleanup");

static Node *make(const NtsDescriptor *descriptor) {
  return (Node *)nts_object_new(descriptor);
}

static void anchored_and_dead(const NtsDescriptor *descriptor) {
  size_t before = nts_live_count(), bytes = nts_live_bytes();
  size_t called = traces, deaths = releases;
  Node *a = make(descriptor), *b = make(descriptor);
  a->left = b;
  a->right = b;
  a->value = nts_value_of_reference(&b->header, NTS_TAG_OBJECT);
  nts_retain(&b->header);
  nts_retain(&b->header);
  nts_retain(&b->header);
  b->left = a;
  nts_retain(&a->header);
  b->value = nts_value_of_reference(
      (NtsHeader *)nts_string_from_utf8("child", 5), NTS_TAG_STRING);
  nts_release(&b->header); /* a is the only external root. */
  nts_collect_cycles();
  check("trial deletion restores each duplicate edge and external root",
        a->header.reserved == 2 && b->header.reserved == 3 &&
            nts_value_reference(b->value)->reserved == 1);
  check("the installed callback executes in a live collection",
        descriptor == &typed ? traces > called : traces == called);
  check("tracing never calls owned cleanup", releases == deaths);
  called = traces;
  nts_release(&a->header);
  nts_collect_cycles();
  check("the installed callback executes in dead-cycle reclamation",
        descriptor == &typed ? traces > called : traces == called);
  check("dead cycles and their acyclic child balance bytes and objects",
        nts_live_count() == before && nts_live_bytes() == bytes);
  check("cycle reclamation still bypasses owned cleanup", releases == deaths);
}

static void ordinary_death(void) {
  size_t before = nts_live_count(), bytes = nts_live_bytes(), called = traces;
  size_t deaths = releases;
  Node *a = make(&typed), *b = make(&typed);
  a->left = b; /* transfer b's initial reference */
  a->value =
      nts_value_of_reference((NtsHeader *)nts_bigint_box(123), NTS_TAG_BIGINT);
  nts_release(&a->header);
  check("ordinary death calls owned cleanup but never tracing",
        traces == called && releases == deaths + 2);
  NtsDescriptor trace_only = typed;
  trace_only.release_fields = NULL;
  a = make(&trace_only);
  a->left = make(&trace_only);
  nts_release(&a->header);
  check("generic owned fallback also never calls tracing", traces == called);
  check("ordinary cleanup balances boxed bigint and object storage",
        nts_live_count() == before && nts_live_bytes() == bytes);
}

static void erased_tags(void) {
  size_t before = nts_live_count(), bytes = nts_live_bytes();
  size_t handles_before = handles_released;
  int native_handle = 0;
  for (int tag = 0; tag < 4; tag++) {
    Node *a = make(&typed);
    a->left = a;
    nts_retain(&a->header);
    if (tag == 0)
      a->value = nts_value_of_number(42);
    else if (tag == 1)
      a->value = nts_value_of_reference(NULL, NTS_TAG_OBJECT);
    else if (tag == 2)
      a->value = nts_value_of_reference((NtsHeader *)nts_bigint_box(456),
                                        NTS_TAG_BIGINT);
    else {
      /* This non-null native pointer is not a managed header. */
      a->value = nts_value_of_undefined();
      a->value.tag = NTS_TAG_HANDLE_OBJC;
      a->value.as.native = &native_handle;
    }
    nts_release(&a->header);
    nts_collect_cycles();
    check("erased scalar, null, bigint and foreign tags trace precisely",
          nts_live_count() == before && nts_live_bytes() == bytes);
  }
  check("an erased native handle is finalized once and never traced",
        handles_released == handles_before + 1 && native_handle == 1);
}

static void handle_keep(void *object) { (void)object; }
static void handle_release(void *object) {
  (*(int *)object)++;
  handles_released++;
}

static NtsHeader *holder_node(void *object) {
  Holder *holder = object;
  holder->enumerated = true;
  if (holder->epoch != nts_collection_epoch()) {
    holder->epoch = nts_collection_epoch();
    holder->node = (NtsHeader){.descriptor = &nts_holder_descriptor,
                               .reserved = holder->native_count,
                               .length = NTS_FAMILY_GOBJECT};
  }
  return &holder->node;
}
static void holder_each(NtsHeader *object, void (*visit)(NtsHeader *)) {
  Holder *holder = (Holder *)object;
  if (holder->held)
    visit(&holder->held->header);
}
static void holder_fallen(void (*root)(NtsHeader *)) { (void)root; }
static void holder_sever(NtsHeader *object) {
  Holder *holder = (Holder *)object;
  Node *held = holder->held;
  holder->held = NULL;
  severed++;
  nts_release(&held->header); /* already DYING, and therefore ignored */
}
static void *foreign_keep(void *object) { return object; }
static void foreign_release(void *object) {
  Holder *holder = object;
  check("holder sever precedes cleared-slot foreign finalization",
        holder->held == NULL && holder->owner->foreign == NULL);
  holder->native_count--;
  finalized++;
}
static const NtsHolders holders = {holder_node, holder_each, holder_fallen,
                                   holder_sever};
static const NtsFamilyOps foreign_ops = {foreign_keep, foreign_release};
static const NtsForeignSlot foreign_slots[] = {
    {offsetof(Node, foreign), NTS_FAMILY_GOBJECT, &foreign_ops}};

static void foreign_holder(const NtsDescriptor *descriptor) {
  size_t before = nts_live_count(), bytes = nts_live_bytes();
  size_t was_severed = severed, was_finalized = finalized;
  NtsDescriptor with_holder = *descriptor;
  with_holder.foreign = 1;
  with_holder.foreign_slots = foreign_slots;
  Node *a = make(&with_holder);
  Holder holder = {
      .held = a, .owner = a, .epoch = UINT64_MAX, .native_count = 1};
  a->foreign = &holder;
  nts_retain(&a->header); /* the foreign object's lent reference */
  nts_release(&a->header);
  nts_collect_cycles();
  check("foreign holder and typed fields remain in the same traced graph",
        severed == was_severed + 1 && finalized == was_finalized + 1 &&
            holder.native_count == 0);
  check("foreign cycles balance ordinary managed storage",
        nts_live_count() == before && nts_live_bytes() == bytes);
}

static void runtime_array(void) {
  size_t before = nts_live_count(), bytes = nts_live_bytes(), called = traces;
  NtsArray *a = nts_array_new(&refs, 0);
  nts_retain(&a->header);
  nts_array_push_ref(a, a);
  nts_release(&a->header);
  nts_collect_cycles();
  check("runtime-sized arrays retain the generic collector fallback",
        traces == called && nts_live_count() == before &&
            nts_live_bytes() == bytes);
}

static void undefined_reference(void) {
  size_t before = nts_live_count(), bytes = nts_live_bytes();
  NtsHeader *undefined = NTS_UNDEFINED_REFERENCE;
  const NtsDescriptor *descriptor = undefined->descriptor;
  check("undefined has a real identity distinct from null", undefined != NULL);
  check("undefined has no user fields or traced edges",
        descriptor->references == 0 && descriptor->erased == 0 &&
            descriptor->cyclic == 0);
  for (size_t i = 0; i < 100; i++) {
    nts_retain(undefined);
    nts_release(undefined);
  }
  NtsArray *a = nts_array_new(&refs, 0);
  nts_array_push_ref(a, undefined);
  nts_array_push_ref(a, NULL);
  nts_array_push_ref(a, undefined);
  nts_retain(&a->header);
  nts_array_push_ref(a, a);
  /* A non-final decrement buffers the still-anchored cycle, so this pass
   * really trial-deletes and restores its children, including undefined. */
  nts_retain(&a->header);
  nts_release(&a->header);
  check("the anchored cycle is buffered before trial deletion",
        nts_cycle_candidates() != 0);
  uint64_t epoch = nts_collection_epoch();
  nts_collect_cycles();
  check("the anchored cycle was scanned and its outside root restored",
        nts_collection_epoch() > epoch && a->header.reserved == 2);
  check("an anchored cycle keeps undefined and null as distinct references",
        nts_array_at_ref(a, 0) == undefined && nts_array_at_ref(a, 1) == NULL &&
            nts_array_at_ref(a, 2) == undefined);
  nts_release(&a->header);
  nts_collect_cycles();
  check("undefined survives trial deletion and dead-cycle reclamation",
        undefined->descriptor == descriptor &&
            undefined->reserved == NTS_IMMORTAL &&
            undefined->flags == NTS_BLACK && undefined->length == 0);
  check("the dead cycle is reclaimed and undefined adds no managed storage",
        nts_live_count() == before && nts_live_bytes() == bytes);
}

int main(void) {
  nts_register_holders(NTS_FAMILY_GOBJECT, &holders);
  nts_handle_family_register(NTS_TAG_HANDLE_OBJC, handle_keep, handle_release,
                             "typed-trace-test");
  anchored_and_dead(&typed);
  anchored_and_dead(&generic);
  ordinary_death();
  erased_tags();
  foreign_holder(&typed);
  foreign_holder(&generic);
  runtime_array();
  undefined_reference();
  nts_collect_cycles();
  check("all typed trace storage is reclaimed",
        nts_live_count() == 0 && nts_live_bytes() == 0);
  return failures != 0;
}
