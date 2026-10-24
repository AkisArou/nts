/* Candidate lifetime and collection admission. Conservative reference arrays,
 * with a grown-vs-inline control: the only changed input is initial capacity.
 * No checkpoint is allowed to hide a moving-threshold starvation. */
#include "nts_runtime.h"
#include <stdio.h>

static int failures;
static void check(const char *name, bool holds) {
  printf("%s %s\n", holds ? "ok" : "FAIL", name);
  failures += !holds;
}

static const NtsDescriptor leaf = {NTS_KIND_OBJECT,
                                   sizeof(NtsHeader),
                                   0u,
                                   0u,
                                   0,
                                   0,
                                   "leaf",
                                   0u,
                                   0,
                                   NTS_ARRAY_UNKNOWN,
                                   0u,
                                   0,
                                   0,
                                   0};
static const NtsDescriptor refs = {NTS_KIND_ARRAY,
                                   sizeof(NtsHeader *),
                                   1u,
                                   1u,
                                   0,
                                   0,
                                   "refs",
                                   0u,
                                   0,
                                   NTS_ARRAY_REFERENCE,
                                   0u,
                                   0,
                                   0,
                                   0};

static NtsArray *array(bool grown) {
  NtsArray *a = nts_array_new(&refs, grown ? 0 : 1);
  a->header.length = 0;
  nts_array_push_ref(a, NULL);
  return a;
}

static void buffer(NtsHeader *p) {
  nts_retain(p);
  nts_release(p);
}

static void dead_arrays(bool grown) {
  nts_collect_cycles();
  size_t before = nts_live_count();
  for (size_t i = 0; i < 25000; i++) {
    NtsArray *a = array(grown);
    buffer(&a->header);
    nts_release(&a->header);
  }
  check(grown ? "grown dead arrays stay bounded without a checkpoint"
              : "inline dead arrays are the bounded control",
        nts_live_count() <= before + 10000);
  nts_collect_cycles();
  check("the explicit drain still balances", nts_live_count() == before);
}

static void cycles_meet_the_bound(void) {
  nts_collect_cycles();
  size_t before = nts_live_count();
  uint64_t epoch = nts_collection_epoch();
  for (size_t i = 0; i < 25000; i++) {
    NtsArray *a = nts_array_new(&refs, 0);
    nts_retain(&a->header);
    nts_array_push_ref(a, a);
    nts_release(&a->header);
  }
  check("cyclic garbage triggers once per fixed candidate bound",
        nts_collection_epoch() >= epoch + 2);
  check("uncollected cyclic storage is bounded",
        nts_live_count() <= before + 20000);
  nts_collect_cycles();
  check("real cycles remain collectable", nts_live_count() == before);
}

static void a_drain_rechecks_deferred_admission(void) {
  nts_collect_cycles();
  size_t before = nts_live_count();
  uint64_t epoch = nts_collection_epoch();
  NtsArray *owner = nts_array_new(&refs, 0);
  for (size_t i = 0; i < 10000; i++) {
    NtsArray *cycle = nts_array_new(&refs, 0);
    nts_retain(&cycle->header);
    nts_array_push_ref(cycle, cycle);
    nts_array_push_ref(owner, cycle);
  }
  /* All 10,000 non-zero decrements happen inside this destruction drain.
   * None may collect while the dying-list links occupy count words. */
  nts_release(&owner->header);
  check("a death rechecks candidate admission deferred by its drain",
        nts_collection_epoch() > epoch);
  check("the completed drain leaves no unreachable cycles",
        nts_live_count() == before);
  nts_collect_cycles();
}

static void swap_removal_and_collector_reset(void) {
  nts_collect_cycles();
  size_t before = nts_live_count();
  NtsArray *a = array(true), *b = array(true), *c = array(true);
  buffer(&a->header);
  buffer(&b->header);
  buffer(&c->header);
  nts_release(&b->header); /* c moves into b's roots slot. */
  nts_release(&c->header);
  nts_release(&a->header);
  check("removing a middle candidate updates the moved index",
        nts_live_count() == before);

  a = array(true);
  buffer(&a->header);
  nts_collect_cycles();
  check("a retained candidate survives collector processing",
        a->header.reserved == 1);
  buffer(&a->header); /* Must acquire a fresh slot after the clear. */
  nts_release(&a->header);
  check("collector processing invalidates the old roots index",
        nts_live_count() == before);
}

static void collector_compaction_updates_indices(void) {
  nts_collect_cycles();
  size_t before = nts_live_count();
  NtsArray *a = array(true), *b = array(true), *c = array(true);
  buffer(&a->header);
  buffer(&b->header);
  buffer(&c->header);
  nts_retain(&a->header); /* Black first root is removed during MarkRoots. */
  nts_collect_cycles();   /* b and c move down before their indices are cleared.
                           */
  check("root compaction preserves each retained candidate",
        a->header.reserved == 2 && b->header.reserved == 1 &&
            c->header.reserved == 1);
  buffer(&b->header);
  buffer(&c->header);
  nts_release(&b->header);
  nts_release(&c->header);
  nts_release(&a->header);
  nts_release(&a->header);
  check("compacted candidates can be buffered and removed again",
        nts_live_count() == before);
}

int main(void) {
  /* Three live leaf allocations keep the moving live_count/2 trigger just
   * ahead of one candidate per two allocations in the grown-array arm. */
  NtsHeader *anchors[3];
  for (size_t i = 0; i < 3; i++)
    anchors[i] = nts_object_new(&leaf);
  dead_arrays(false);
  dead_arrays(true);
  cycles_meet_the_bound();
  a_drain_rechecks_deferred_admission();
  swap_removal_and_collector_reset();
  collector_compaction_updates_indices();
  for (size_t i = 0; i < 3; i++)
    nts_release(anchors[i]);
  nts_collect_cycles();
  check("all fixture allocations balance", nts_live_count() == 0);
  return failures != 0;
}
