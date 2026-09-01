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
 * The collection before each reading is not optional. A release that reaches
 * zero on an object already buffered as a cycle candidate returns *without*
 * destroying it -- the collector frees it instead -- so a self-referential type
 * looks like a leak of everything it built until the collector runs, and with a
 * threshold of ten thousand candidates a small case never reaches it. Thirty
 * three `Link`s read as thirty three leaks the first time this was run. */
#include "nts_runtime.h"
#include <stdio.h>

double work(double iterations);

int main(void) {
  double settled = work(1);
  nts_collect_cycles();
  size_t before = nts_live_count();

  nts_counting_reset();
  double answer = work(1);
  /* Read before collecting. The collector releases as it works, and charging
     the program for that would measure the runtime rather than the code the
     compiler emitted -- it put thirty two operations on this case's bill the
     first time round. */
  size_t retains = nts_counted_retains();
  size_t releases = nts_counted_releases();
  nts_collect_cycles();
  size_t after = nts_live_count();

  (void)settled;
  printf("retains=%zu releases=%zu leaked=%zd answer=%.0f\n", retains, releases,
         (ptrdiff_t)after - (ptrdiff_t)before, answer);
  return 0;
}
