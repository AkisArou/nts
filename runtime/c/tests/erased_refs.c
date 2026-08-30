/* An erased value holding a reference, and what the collector makes of it.
 *
 * `NtsValue` is a tag beside a payload, and the payload is a reference only
 * when the tag says so. Everything that walks references therefore has to ask
 * the tag first -- retain, release, the release-contents path, and all four
 * passes of the cycle collector.
 *
 * They all go through one function. `nts_each_reference` is the single
 * traversal, so teaching it about erased slots teaches the whole collector at
 * once -- and it is why an erased value is stored *whole* rather than
 * decomposed into a tag beside a typed slot at every kind of storage. The
 * alternative would have put a parallel tag slot in object layout, array
 * layout, globals and closure captures, and each of those is a place to get it
 * subtly wrong.
 *
 * Build with `-DNTS_PROVIDER_RC`. Under NoGC nothing is ever released, so every
 * assertion here would pass against a runtime that had never learned any of
 * this -- which is exactly the mistake this file exists to make impossible.
 */
#include <stdio.h>
#include <string.h>

#include "nts_test_host.h"

static int failures;

static void expect(const char *what, long got, long want) {
  if (got != want) {
    printf("FAIL %s\n  got  %ld\n  want %ld\n", what, got, want);
    failures++;
  } else {
    printf("ok   %s\n", what);
  }
}

/* An object with one erased field, so the field is a reference exactly when
 * what it holds is one. */
typedef struct Box {
  NtsHeader header;
  NtsValue held;
} Box;

static const uint32_t box_erased[] = {(uint32_t)offsetof(Box, held)};

/* Seven fields positionally, then the erased table. Every descriptor written
 * before erased slots existed sets only the seven and C zero-fills the rest,
 * which is why the two new members are last. */
static const NtsDescriptor desc_box = {
    NTS_KIND_OBJECT, (uint32_t)sizeof(Box), 0u, 1u, 0, 0, "Box", 1u, box_erased,
};

/* An array whose elements are erased values. `erased` is 1 for an array in the
 * same sense `references` is: a fact about every element, with no table. */
static const NtsDescriptor desc_values = {
    NTS_KIND_ARRAY,
    (uint32_t)sizeof(NtsValue),
    0u,
    1u,
    0,
    0,
    "unknown[]",
    1u,
    0,
};

/* Through the runtime's own constructors, like every other reader: the
 * representation is meant to be swappable in one file, and a test that built
 * the struct by hand would be the second place that knows its shape. */
static NtsValue of_string(NtsString *s) {
  return nts_value_of_reference((NtsHeader *)s, NTS_TAG_STRING);
}

static NtsValue of_number(double d) { return nts_value_of_number(d); }

static NtsValue of_object(NtsHeader *o) {
  return nts_value_of_reference(o, NTS_TAG_OBJECT);
}

/* Every check is a live-object delta rather than a peek at a reference count.
 * The count lives in the header's provider-reserved word, which the header says
 * is not public ABI -- and the property that matters is the observable one: the
 * object is given back, or it is not. */

/* A scalar tag means there is nothing to claim, and the helper has to decide
 * that from the tag rather than from the bits: a double whose bit pattern
 * happens to look like a pointer is the failure this rules out. */
static void a_scalar_is_not_retained(void) {
  NtsString *witness = nts_string_from_utf8("witness", 7);
  size_t before = nts_live_count();

  nts_value_retain(of_number(1.5));
  nts_value_release(of_number(1.5));

  expect("a scalar tag claims nothing", (long)nts_live_count(), (long)before);
  nts_release((NtsHeader *)witness);
}

/* Retaining through an erased value keeps the payload alive after the last
 * ordinary reference to it is gone -- which is the whole point of counting it.
 */
static void a_reference_tag_is_counted(void) {
  size_t before = nts_live_count();
  NtsString *s = nts_string_from_utf8("held", 4);
  NtsValue v = of_string(s);

  nts_value_retain(v);
  nts_release((NtsHeader *)s);
  expect("the erased value keeps its payload alive", (long)nts_live_count(),
         (long)before + 1);

  nts_value_release(v);
  expect("and giving it up frees it", (long)nts_live_count(), (long)before);
}

/* The reason the descriptor grew a table: a dying object has to give up what
 * its erased field holds, and the field is a reference only sometimes. */
static void an_erased_field_is_released_with_its_owner(void) {
  size_t before = nts_live_count();
  NtsString *s = nts_string_from_utf8("inside", 6);
  Box *box = (Box *)nts_object_new(&desc_box);
  box->held = of_string(s);
  nts_value_retain(box->held);
  nts_release((NtsHeader *)s);

  expect("the field owns its payload", (long)nts_live_count(),
         (long)before + 2);
  nts_release((NtsHeader *)box);
  expect("dropping the owner frees both", (long)nts_live_count(), (long)before);
}

/* The same field holding a number must release nothing, which is the half a
 * tracer that ignored the tag would get wrong in the dangerous direction: it
 * would hand the collector whatever the double's bits pointed at. */
static void an_erased_field_holding_a_number_releases_nothing(void) {
  NtsString *witness = nts_string_from_utf8("untouched", 9);
  size_t before = nts_live_count();

  Box *box = (Box *)nts_object_new(&desc_box);
  box->held = of_number(3.25);
  nts_release((NtsHeader *)box);

  expect("a number field takes nothing with it", (long)nts_live_count(),
         (long)before);
  nts_release((NtsHeader *)witness);
}

static void erased_array_elements_are_traced(void) {
  size_t before = nts_live_count();
  NtsString *a = nts_string_from_utf8("a", 1);
  NtsString *b = nts_string_from_utf8("b", 1);

  NtsArray *values = nts_array_new(&desc_values, 3);
  values->header.length = 3;
  NtsValue *slots = NTS_ITEMS(values, NtsValue);
  slots[0] = of_string(a);
  slots[1] = of_number(7.0);
  slots[2] = of_string(b);
  nts_value_retain(slots[0]);
  nts_value_retain(slots[2]);
  nts_release((NtsHeader *)a);
  nts_release((NtsHeader *)b);

  expect("the array owns both payloads", (long)nts_live_count(),
         (long)before + 3);
  nts_release((NtsHeader *)values);
  expect("dropping the array frees them", (long)nts_live_count(), (long)before);
}

/* A cycle whose only edge runs through an erased field. The collector can only
 * see that edge by reading the tag, which is why `cyclic` is conservatively
 * true for a type with an erased field. */
static void a_cycle_through_an_erased_field_is_collected(void) {
  nts_collect_cycles();
  size_t before = nts_live_count();

  Box *first = (Box *)nts_object_new(&desc_box);
  Box *second = (Box *)nts_object_new(&desc_box);
  first->held = of_object((NtsHeader *)second);
  second->held = of_object((NtsHeader *)first);
  nts_value_retain(first->held);
  nts_value_retain(second->held);

  nts_release((NtsHeader *)first);
  nts_release((NtsHeader *)second);
  expect("the cycle survives its last outside reference",
         (long)nts_live_count(), (long)before + 2);

  nts_collect_cycles();
  expect("and the collector reclaims it", (long)nts_live_count(), (long)before);
}

int main(void) {
  nts_test_host_install();

  a_scalar_is_not_retained();
  a_reference_tag_is_counted();
  an_erased_field_is_released_with_its_owner();
  an_erased_field_holding_a_number_releases_nothing();
  erased_array_elements_are_traced();
  a_cycle_through_an_erased_field_is_collected();

  if (failures) {
    printf("%d erased-reference check(s) disagree\n", failures);
    return 1;
  }
  printf("every erased reference is counted and traced\n");
  return 0;
}
