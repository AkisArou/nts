/* The typed contents walk changes dispatch, never ownership or death order.
 * Its generic twin has exactly the same slots and differs only in callback. */
#include "nts_runtime.h"
#include <stdio.h>

typedef struct Node {
  NtsHeader header;
  struct Node *left;
  struct Node *right;
  NtsValue value;
  void *foreign;
} Node;

static int failures;
static size_t callbacks;
static int foreign_calls;
static void check(const char *name, bool holds) {
  printf("%s %s\n", holds ? "ok" : "FAIL", name);
  failures += !holds;
}

static void release_fields(NtsHeader *object) {
  Node *node = (Node *)object;
  callbacks++;
  if (node->left) {
    nts_release((NtsHeader *)node->left);
  }
  if (node->right) {
    nts_release((NtsHeader *)node->right);
  }
  if (NTS_TAG_IS_MANAGED(nts_value_tag(node->value)) &&
      nts_value_reference(node->value)) {
    nts_release(nts_value_reference(node->value));
  }
}

typedef struct Foreign {
  Node *owner;
  bool erased;
} Foreign;

static void *keep(void *object) { return object; }
static void keep_handle(void *object) { (void)object; }
static void dispose(void *object) {
  Foreign *foreign = (Foreign *)object;
  foreign_calls++;
  check("a foreign slot is cleared before finalization",
        foreign->erased ? foreign->owner->value.tag == NTS_TAG_UNDEFINED
                        : foreign->owner->foreign == NULL);
  /* Reentry must meet the existing DYING guard, not run the callback again. */
  nts_release(&foreign->owner->header);
}
static const NtsFamilyOps ops = {.retain = keep, .release = dispose};
static const NtsForeignSlot foreign[] = {
    {offsetof(Node, foreign), NTS_FAMILY_NONE, &ops}};
static const uint32_t references[] = {offsetof(Node, left),
                                      offsetof(Node, right)};
static const uint32_t erased[] = {offsetof(Node, value)};
static const NtsDescriptor typed = {.kind = NTS_KIND_OBJECT,
                                    .size = sizeof(Node),
                                    .references = 2,
                                    .cyclic = 1,
                                    .offsets = references,
                                    .name = "typed",
                                    .erased = 1,
                                    .erased_offsets = erased,
                                    .foreign = 1,
                                    .foreign_slots = foreign,
                                    .release_fields = release_fields};
static const NtsDescriptor generic = {.kind = NTS_KIND_OBJECT,
                                      .size = sizeof(Node),
                                      .references = 2,
                                      .cyclic = 1,
                                      .offsets = references,
                                      .name = "generic",
                                      .erased = 1,
                                      .erased_offsets = erased,
                                      .foreign = 1,
                                      .foreign_slots = foreign};
static const NtsDescriptor leaf = {
    .kind = NTS_KIND_OBJECT, .size = sizeof(NtsHeader), .name = "leaf"};
static const NtsDescriptor refs = {.kind = NTS_KIND_ARRAY,
                                   .size = sizeof(NtsHeader *),
                                   .references = 1,
                                   .element = NTS_ARRAY_REFERENCE,
                                   .name = "refs"};

_Static_assert(offsetof(NtsDescriptor, release_fields) ==
                   offsetof(NtsDescriptor, function_name) + sizeof(void *),
               "the callback is the descriptor's trailing pointer");

static Node *make(const NtsDescriptor *descriptor) {
  return (Node *)nts_object_new(descriptor);
}

static void shared_and_erased(const NtsDescriptor *descriptor) {
  size_t before = nts_live_count(), bytes = nts_live_bytes();
  size_t calls = callbacks;
  Node *owner = make(descriptor);
  NtsHeader *child = nts_object_new(&leaf);
  owner->left = (Node *)child;
  owner->right = (Node *)child;
  owner->value = nts_value_of_reference(child, NTS_TAG_OBJECT);
  nts_retain(child);
  nts_retain(child);
  nts_retain(child); /* three owned slots, plus the external control */
  nts_release(&owner->header);
  check("typed and generic death preserve a shared external child",
        nts_live_count() == before + 1 && child->reserved == 1);
  check("ordinary death selects only the installed callback",
        callbacks == calls + (descriptor == &typed));
  nts_release(child);
  check("shared and erased fields balance objects and bytes",
        nts_live_count() == before && nts_live_bytes() == bytes);

  owner = make(descriptor);
  owner->value = nts_value_of_number(3.25);
  nts_release(&owner->header);
  check("scalar and null slots do not release payload bits",
        nts_live_count() == before && nts_live_bytes() == bytes);

  owner = make(descriptor);
  owner->value = nts_value_of_reference(
      (NtsHeader *)nts_string_from_utf8("kept", 4), NTS_TAG_STRING);
  nts_release(&owner->header);
  check("an erased managed string is released exactly once",
        nts_live_count() == before && nts_live_bytes() == bytes);
}

static void foreign_order(const NtsDescriptor *descriptor) {
  size_t before = nts_live_count(), bytes = nts_live_bytes();
  size_t calls = callbacks;
  int finalized = foreign_calls;
  Node *owner = make(descriptor);
  Foreign direct = {owner, false}, tagged = {owner, true};
  owner->foreign = &direct;
  owner->value = nts_value_of_undefined();
  owner->value.tag = NTS_TAG_HANDLE_OBJC;
  owner->value.as.native = &tagged;
  nts_release(&owner->header);
  check("direct and erased foreign edges each finalize once",
        foreign_calls == finalized + 2);
  check("foreign reentry does not repeat managed cleanup",
        callbacks == calls + (descriptor == &typed));
  check("foreign cleanup balances the managed owner",
        nts_live_count() == before && nts_live_bytes() == bytes);
}

static void buffered_death(void) {
  size_t before = nts_live_count(), bytes = nts_live_bytes(), calls = callbacks;
  Node *owner = make(&typed);
  nts_retain(&owner->header);
  nts_release(&owner->header); /* candidate, then ordinary zero-count death */
  nts_release(&owner->header);
  nts_collect_cycles();
  check("buffered zero-count death invokes typed cleanup once",
        callbacks == calls + 1 && nts_live_count() == before &&
            nts_live_bytes() == bytes);
}

static void white_cycle_does_not_release_fields(void) {
  size_t before = nts_live_count(), bytes = nts_live_bytes(), calls = callbacks;
  Node *a = make(&typed), *b = make(&typed);
  a->left = b;
  b->value = nts_value_of_reference(&a->header, NTS_TAG_OBJECT);
  nts_retain(&b->header);
  nts_retain(&a->header);
  nts_release(&a->header);
  nts_release(&b->header);
  nts_collect_cycles();
  check("white-cycle reclamation never calls the owned-edge callback",
        callbacks == calls);
  check("typed descriptors remain traceable through pointer and erased edges",
        nts_live_count() == before && nts_live_bytes() == bytes);
}

static void deep_chain(void) {
  size_t before = nts_live_count(), bytes = nts_live_bytes(), calls = callbacks;
  Node *head = NULL;
  for (size_t i = 0; i < 50000; i++) {
    Node *next = make(&typed);
    next->left = head; /* transfer the previous root, no extra count */
    head = next;
  }
  nts_release((NtsHeader *)head);
  check("typed destruction keeps the iterative drain for deep graphs",
        callbacks == calls + 50000 && nts_live_count() == before &&
            nts_live_bytes() == bytes);
}

static void runtime_array_fallback(void) {
  size_t before = nts_live_count(), bytes = nts_live_bytes(), calls = callbacks;
  NtsArray *array = nts_array_new(&refs, 0);
  nts_array_push_ref(array, make(&typed));
  nts_array_push_ref(array, make(&typed));
  nts_release(&array->header);
  check("runtime arrays keep the generic walk and dispatch child cleanup",
        callbacks == calls + 2 && nts_live_count() == before &&
            nts_live_bytes() == bytes);
}

int main(void) {
  nts_handle_family_register(NTS_TAG_HANDLE_OBJC, keep_handle, dispose,
                             "typed-release-test");
  shared_and_erased(&typed);
  shared_and_erased(&generic);
  foreign_order(&typed);
  foreign_order(&generic);
  buffered_death();
  white_cycle_does_not_release_fields();
  deep_chain();
  runtime_array_fallback();
  nts_collect_cycles();
  check("all typed release fixture storage is reclaimed",
        nts_live_count() == 0 && nts_live_bytes() == 0);
  return failures != 0;
}
