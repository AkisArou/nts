/* A finished sort permutes existing ownership. Its changed-source control
 * owes counts instead; both must preserve identity and return every object. */
#include "nts_test_host.h"
#include <stdio.h>

typedef struct {
  NtsHeader header;
  uint32_t id;
} Item;

static const NtsDescriptor item_descriptor = {
    .kind = NTS_KIND_OBJECT,
    .size = sizeof(Item),
    .name = "SortItem",
};
static const NtsDescriptor order_descriptor = {
    .kind = NTS_KIND_ARRAY,
    .size = sizeof(uint32_t),
    .name = "SortOrder",
    .element = NTS_ARRAY_UINT,
};
static int failures;

static void check(const char *what, bool ok) {
  printf("%s %s\n", ok ? "ok  " : "FAIL", what);
  failures += !ok;
}

static Item *item(uint32_t id) {
  Item *out = (Item *)nts_object_new(&item_descriptor);
  out->id = id;
  return out;
}

static void distinct_owner(unsigned mutation) {
  NtsArray *target = nts_array_new(&nts_desc_ref_acyclic, 0);
  for (uint32_t i = 0; i < 3; i++)
    nts_array_push_ref(target, item(i));
  NtsArray *snapshot = nts_array_slice_ref(target, 0, 3);
  NtsArray *order = nts_array_new(&order_descriptor, 3);
  uint32_t *indices = NTS_ITEMS(order, uint32_t);
  indices[0] = 2;
  indices[1] = 0;
  indices[2] = 1;
  if (mutation == 1) {
    nts_array_set_length_ref(target, 0);
  } else if (mutation == 2 || mutation == 4) {
    void **slots = NTS_ITEMS(target, void *);
    void *old = slots[0];
    slots[0] = item(99);
    nts_release((NtsHeader *)old);
  }
  if (mutation >= 3)
    nts_array_push_ref(target, item(42));
  nts_counting_reset();
  nts_array_sort_writeback_ref(target, snapshot, order);
  size_t retains = nts_counted_retains();
  size_t releases = nts_counted_releases();
  bool unchanged = mutation == 0 || mutation == 3;
  check("unchanged prefix moves without counts; mutation reconciles",
        retains == (unchanged ? 0u : 3u) &&
            releases == ((mutation == 2 || mutation == 4) ? 3u : 0u));
  Item **slots = NTS_ITEMS(target, Item *);
  Item **source = NTS_ITEMS(snapshot, Item *);
  check("the committed order contains the original references",
        slots[0] == source[2] && slots[1] == source[0] &&
            slots[2] == source[1]);
  check("a comparator's appended tail survives",
        target->header.length == (mutation >= 3 ? 4u : 3u) &&
            (mutation < 3 || slots[3]->id == 42));
  nts_release(&order->header);
  nts_release(&snapshot->header);
  nts_release(&target->header);
  nts_collect_cycles();
  check("no original, replacement or appended object leaks",
        nts_live_count() == 0 && nts_live_bytes() == 0);
}

static void private_copy(void) {
  NtsArray *target = nts_array_new(&nts_desc_ref_acyclic, 0);
  for (uint32_t i = 0; i < 8; i++)
    nts_array_push_ref(target, item(i));
  NtsArray *order = nts_array_new(&order_descriptor, 8);
  /* Two cycles, an identity, then a three-cycle. */
  const uint32_t wanted[] = {1, 0, 3, 2, 4, 6, 7, 5};
  uint32_t *indices = NTS_ITEMS(order, uint32_t);
  for (uint32_t i = 0; i < 8; i++)
    indices[i] = wanted[i];
  nts_counting_reset();
  nts_array_sort_writeback_ref(target, target, order);
  check("a private toSorted owner moves cycles without counts",
        nts_counted_retains() == 0 && nts_counted_releases() == 0);
  bool correct = true;
  Item **slots = NTS_ITEMS(target, Item *);
  for (uint32_t i = 0; i < 8; i++)
    correct &= slots[i]->id == wanted[i] && slots[i]->header.reserved == 1 &&
               indices[i] == i;
  check("cycles preserve each single owner and mark only private indices",
        correct);
  nts_release(&order->header);
  nts_release(&target->header);
  nts_collect_cycles();
  check("cycle permutation gives every object back", nts_live_count() == 0);
}

int main(void) {
  for (unsigned mutation = 0; mutation < 5; mutation++)
    distinct_owner(mutation);
  private_copy();
  return failures != 0;
}
