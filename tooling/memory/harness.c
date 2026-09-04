/* What a memory case reports: how much counting ran, and whether it balanced.
 *
 * Two runs, and only the second is measured. A case that builds a table once is
 * not charged for building it -- what is being measured is the steady state,
 * which is what a loop over the same shape actually costs. `nts_live_count`
 * across the two says whether the second run gave back everything it took: any
 * growth is a leak, and a leak is the failure this suite exists to notice at
 * the same time as the count it is trying to drive down.
 *
 * Counting fewer operations while leaking is not an improvement, and a suite
 * that reported only the count would call it one.
 *
 * And the count is no longer the only number. Reference counting is what an
 * elision pass removes; *allocation* is what it cannot touch at all --
 * `awfy-bounce` has five counting operations in the whole program and makes a
 * hundred objects an iteration. So the allocations of the measured run are
 * reported beside the operations, against their own floor.
 *
 * The collection before each reading is not optional. A release that reaches
 * zero on an object already buffered as a cycle candidate returns *without*
 * destroying it -- the collector frees it instead -- so a self-referential type
 * looks like a leak of everything it built until the collector runs, and with a
 * threshold of ten thousand candidates a small case never reaches it. Thirty
 * three `Link`s read as thirty three leaks the first time this was run. */
#include "nts_runtime.h"
#include <stdio.h>

double work(double iterations);

/* Weak, because the compiler emits it only for a module that has state: a case
 * with no globals has no initializer to call and would not link against one.
 *
 * Called once, before the baseline, so what a module allocates when it is
 * evaluated is part of the ground the two runs are compared against rather
 * than something `work` is charged for. Until a case had a global nothing here
 * needed it, and the first one that did read a null array and segfaulted. */
__attribute__((weak)) void module__init(void);

int main(void) {
  if (module__init) {
    module__init();
  }
  double settled = work(1);
  nts_collect_cycles();
  size_t before = nts_live_count();

  nts_counting_reset();
  /* `nts_counting_reset` does not touch this one -- it is "how many have ever
     been buffered" and the warm-up run above may have buffered some -- so it is
     a delta rather than a reading. */
  size_t candidates_before = nts_cycle_candidates();
  double answer = work(1);
  /* Read before collecting. The collector releases as it works, and charging
     the program for that would measure the runtime rather than the code the
     compiler emitted -- it put thirty two operations on this case's bill the
     first time round. */
  size_t retains = nts_counted_retains();
  size_t releases = nts_counted_releases();
  size_t allocated = nts_counted_allocations();
  size_t candidates = nts_cycle_candidates() - candidates_before;
  nts_collect_cycles();
  size_t after = nts_live_count();

  (void)settled;
  printf("retains=%zu releases=%zu allocated=%zu candidates=%zu leaked=%zd "
         "answer=%.0f\n",
         retains, releases, allocated, candidates,
         (ptrdiff_t)after - (ptrdiff_t)before, answer);
  return 0;
}
