/* The runtime's two reference-array descriptors give up their pointer slots
 * through one shared contents callback, never the generic reference walk.
 *
 * Built with `NTS_PROVIDER_RC` and `NTS_COUNT_OPERATIONS`, with and without
 * AddressSanitizer: a recursive teardown of the deep chain below overflows the
 * default main-thread stack, so a regression is a crash, not a slow pass. */
#include "nts_runtime.h"
#include <stdio.h>
#include <sys/resource.h>

#ifndef NTS_COUNT_OPERATIONS
#error "exact release counts need NTS_COUNT_OPERATIONS"
#endif

static int failures;
static void check(const char *name, bool holds) {
  printf("%s %s\n", holds ? "ok" : "FAIL", name);
  failures += !holds;
}

/* A child with nothing of its own to release. */
static const NtsDescriptor leaf = {
    .kind = NTS_KIND_OBJECT, .size = sizeof(NtsHeader), .name = "leaf"};

static int disposed;
static void *keep(void *object) { return object; }
static void keep_handle(void *object) { (void)object; }
static void dispose(void *object) {
  if (object) {
    disposed++;
  }
}
static const NtsFamilyOps ops = {.retain = keep, .release = dispose};
static const NtsForeignSlot family[] = {
    {.offset = 0, .family = NTS_FAMILY_NONE, .ops = &ops}};
static const NtsDescriptor foreign_array = {.kind = NTS_KIND_ARRAY,
                                            .size = sizeof(void *),
                                            .name = "foreign[]",
                                            .element = NTS_ARRAY_FOREIGN,
                                            .foreign = 1,
                                            .foreign_slots = family,
                                            .release_foreign =
                                                nts_release_foreign};
static const NtsDescriptor value_array = {.kind = NTS_KIND_ARRAY,
                                          .size = sizeof(NtsValue),
                                          .cyclic = 1,
                                          .name = "unknown[]",
                                          .erased = 1,
                                          .element = NTS_ARRAY_VALUE,
                                          .release_foreign =
                                              nts_release_foreign};

static NtsArray *array_of(const NtsDescriptor *descriptor, uint32_t length) {
  return nts_array_new(descriptor, (double)length);
}
static NtsHeader **slots(NtsArray *array) {
  return NTS_ITEMS(array, NtsHeader *);
}

static void descriptors(void) {
  check("both reference-array descriptors install a contents callback",
        nts_desc_ref.release_fields != NULL &&
            nts_desc_ref_acyclic.release_fields != NULL);
  check("the two descriptors share one pointer-slot callback",
        nts_desc_ref.release_fields == nts_desc_ref_acyclic.release_fields);
  check("cycle tracing keeps the generic walk",
        nts_desc_ref.trace_fields == NULL &&
            nts_desc_ref_acyclic.trace_fields == NULL);
  check("cyclic and acyclic descriptors keep their cycle facts",
        nts_desc_ref.cyclic == 1 && nts_desc_ref_acyclic.cyclic == 0);
}

/* Nulls are skipped before `nts_release`, as the generic walk skipped them:
 * the counted build counts a null release, so a callback that passed nulls on
 * would change the census. An immortal child is released and left alone. */
static void null_and_immortal(const NtsDescriptor *descriptor) {
  size_t live = nts_live_count(), bytes = nts_live_bytes();
  NtsHeader *immortal = (NtsHeader *)&nts_undefined_reference;
  NtsArray *array = array_of(descriptor, 6);
  slots(array)[0] = nts_object_new(&leaf);
  slots(array)[2] = immortal;
  slots(array)[3] = nts_object_new(&leaf);
  NtsHeader *shared = nts_object_new(&leaf);
  nts_retain(shared);
  slots(array)[5] = shared;
  nts_counting_reset();
  nts_release(&array->header);
  check("one release per non-null slot plus the array, none for a null",
        nts_counted_releases() == 1 + 4 && nts_counted_retains() == 0);
  check("an immortal child keeps its immortal count",
        immortal->reserved == NTS_IMMORTAL);
  check("a shared child keeps its other owner's reference",
        shared->reserved == 1 && nts_live_count() == live + 1);
  nts_release(shared);
  check("null, immortal and shared slots balance objects and bytes",
        nts_live_count() == live && nts_live_bytes() == bytes);
}

/* A child of a type a cycle can pass through, still owned elsewhere, becomes a
 * cycle candidate when the array lets go; a self-containing array is reclaimed
 * by the collector's traced walk, which this change leaves generic. */
static void cyclic_children(void) {
  size_t live = nts_live_count(), bytes = nts_live_bytes();
  NtsArray *child = array_of(&nts_desc_ref, 0);
  nts_retain(&child->header);
  NtsArray *array = array_of(&nts_desc_ref, 1);
  slots(array)[0] = &child->header;
  nts_release(&array->header);
  check("a cyclic child released below its last owner becomes a candidate",
        child->header.reserved == 1 &&
            (child->header.flags & NTS_BUFFERED) != 0);
  nts_release(&child->header);
  check("a buffered child's ordinary death removes its candidate entry",
        nts_live_count() == live && nts_live_bytes() == bytes);

  NtsArray *self = array_of(&nts_desc_ref, 0);
  nts_retain(&self->header);
  nts_array_push_ref(self, self);
  nts_release(&self->header);
  check("a self-containing array survives counting as a candidate",
        self->header.reserved == 1 && (self->header.flags & NTS_BUFFERED) != 0);
  nts_collect_cycles();
  check("the collector reclaims a self-containing reference array",
        nts_live_count() == live && nts_live_bytes() == bytes);

  /* The same, one array deeper, so the white path also frees the cycle's
   * other member and its own pointer slots. */
  NtsArray *a = array_of(&nts_desc_ref, 0), *b = array_of(&nts_desc_ref, 0);
  nts_retain(&a->header);
  nts_array_push_ref(a, b);
  nts_array_push_ref(b, a);
  NtsArray *holder = array_of(&nts_desc_ref_acyclic, 1);
  slots(holder)[0] = &a->header;
  nts_release(&holder->header);
  nts_collect_cycles();
  check("a cycle released through an acyclic holder is collected",
        nts_live_count() == live && nts_live_bytes() == bytes);
}

/* Elements with erased and foreign contents of their own: each dies on the
 * dying list and gives those contents back by its own protocol. */
static void erased_and_foreign_children(void) {
  size_t live = nts_live_count(), bytes = nts_live_bytes();
  int before = disposed;
  NtsArray *values = array_of(&value_array, 0);
  NtsValue handle = nts_value_of_undefined();
  handle.tag = NTS_TAG_HANDLE_OBJC;
  handle.as.native = &disposed;
  nts_array_push_value(values, nts_value_of_reference(
                                   (NtsHeader *)nts_string_from_utf8("held", 4),
                                   NTS_TAG_STRING));
  nts_array_push_value(values, nts_value_of_number(2.5));
  nts_array_push_value(values, handle);
  NtsArray *handles = array_of(&foreign_array, 3);
  NTS_ITEMS(handles, void *)[0] = &disposed;
  NTS_ITEMS(handles, void *)[2] = &before;
  NtsArray *array = array_of(&nts_desc_ref_acyclic, 3);
  slots(array)[0] = &values->header;
  slots(array)[2] = &handles->header;
  nts_counting_reset();
  nts_release(&array->header);
  check("an erased child gives back its managed tag and a foreign one once",
        nts_live_count() == live && nts_live_bytes() == bytes);
  check("foreign elements and an erased handle each finalize exactly once",
        disposed == before + 3);
  check("erased and foreign children cost one release each, plus the string",
        nts_counted_releases() == 1 + 2 + 1);
}

/* Wide: one array of a million children. Deep: a million one-element arrays,
 * each holding the last. Both are given back by one flat loop per array and
 * the runtime's dying list, never by recursion. */
enum { MANY = 1000000 };
static void large(const NtsDescriptor *descriptor) {
  size_t live = nts_live_count(), bytes = nts_live_bytes();
  NtsArray *wide = array_of(descriptor, MANY);
  for (uint32_t i = 0; i < MANY; i++) {
    slots(wide)[i] = nts_object_new(&leaf);
  }
  nts_counting_reset();
  nts_release(&wide->header);
  check("a million-element array releases each element exactly once",
        nts_counted_releases() == 1 + (size_t)MANY &&
            nts_live_count() == live && nts_live_bytes() == bytes);

  NtsArray *head = NULL;
  for (uint32_t i = 0; i < MANY; i++) {
    NtsArray *next = array_of(descriptor, 1);
    slots(next)[0] = head ? &head->header : NULL; /* moves the last root */
    head = next;
  }
  nts_counting_reset();
  nts_release(&head->header);
  check("a million-deep chain of arrays tears down iteratively",
        nts_counted_releases() == (size_t)MANY && nts_live_count() == live &&
            nts_live_bytes() == bytes);
}

int main(void) {
  nts_handle_family_register(NTS_TAG_HANDLE_OBJC, keep_handle, dispose,
                             "reference-arrays-test");
  descriptors();
  null_and_immortal(&nts_desc_ref);
  null_and_immortal(&nts_desc_ref_acyclic);
  cyclic_children();
  erased_and_foreign_children();
  large(&nts_desc_ref_acyclic);
  large(&nts_desc_ref);
  nts_collect_cycles();
  check("all reference-array fixture storage is reclaimed",
        nts_live_count() == 0 && nts_live_bytes() == 0);
  struct rusage usage;
  getrusage(RUSAGE_SELF, &usage);
  printf("peak rss %ld KiB\n", usage.ru_maxrss);
  return failures != 0;
}
