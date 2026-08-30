/* What an object owns outside its own block.
 *
 * An array's elements start inline, just past the header, and the first push
 * past capacity moves them to a block of their own. That block was `malloc`'d
 * directly rather than through `nts_alloc`, which had two consequences and the
 * second is why the first went unnoticed for so long:
 *
 *   - reclamation freed the header and not the elements, so every array that
 *     ever grew leaked everything it had grown into; and
 *   - `nts_live_bytes` never counted the block, so a program that leaked all
 *     of it measured as holding exactly what it should.
 *
 * 200,000 arrays grown to 128 doubles and released held 200MB resident. This
 * suite is the same measurement made assertable: live bytes must come back to
 * where they started, which is a claim the accounting can now support.
 *
 * Reference counting, necessarily -- under NoGC nothing is released at all and
 * every number below would be trivially equal.
 */
#include <stdio.h>

#include "nts_test_host.h"

static int failures;

static void check(const char *what, bool ok) {
  if (ok) {
    printf("ok   %s\n", what);
  } else {
    printf("FAIL %s\n", what);
    failures++;
  }
}

/* The shape the emitter generates for `number[]`. */
static const NtsDescriptor desc_num = {
    NTS_KIND_ARRAY, (uint32_t)sizeof(double), 0u, 0u, 0, 0, "number[]", 0u, 0,
};

/* A reference array, whose elements are pointers the collector walks. Growing
 * one moves a block the tracer reads from, so this is the case where freeing
 * the wrong block would be visible as a crash rather than as a number. */
static const NtsDescriptor desc_ref_grow = {
    NTS_KIND_ARRAY, (uint32_t)sizeof(void *), 1u, 1u, 0, 0, "ref[]", 0u, 0,
};

int main(void) {
  size_t base = nts_live_bytes();

  /* An array that never grows keeps its elements inline, so nothing is owned
   * outside the block and reclamation was always right for it. Checked so
   * that a fix which freed the inline block would fail here rather than
   * corrupt the heap somewhere else. */
  NtsArray *small = nts_array_new(&desc_num, 4);
  nts_release(&small->header);
  check("an array that never grows returns to the baseline",
        nts_live_bytes() == base);

  /* One that does grow. The elements move out on the first push past
   * capacity and are reallocated on every doubling after it. */
  NtsArray *grown = nts_array_new(&desc_num, 2);
  for (int i = 0; i < 512; i++) {
    nts_array_push(grown, (double)i);
  }
  check("a grown array's elements are counted while it is alive",
        nts_live_bytes() >= base + 512u * sizeof(double));
  nts_release(&grown->header);
  check("a grown array returns to the baseline", nts_live_bytes() == base);

  /* Repeatedly, because a leak of one block is a rounding error and a leak
   * per array is the bug: 4,000 of these held 4MB before the fix. */
  for (int round = 0; round < 4000; round++) {
    NtsArray *a = nts_array_new(&desc_num, 2);
    for (int i = 0; i < 128; i++) {
      nts_array_push(a, (double)i);
    }
    nts_release(&a->header);
  }
  check("4,000 grown arrays leak nothing", nts_live_bytes() == base);

  /* A grown array of references still releases what it points at. The
   * elements live in the moved block, so a tracer reading the inline one
   * would visit garbage -- and a reclamation that freed the moved block
   * before walking it would read freed memory. */
  NtsArray *holder = nts_array_new(&desc_ref_grow, 0);
  holder->header.length = 0;
  for (int i = 0; i < 64; i++) {
    NtsString *s = nts_string_from_utf8("held", 4);
    if (holder->header.length == holder->capacity) {
      /* `nts_array_push` writes doubles; grow through it and overwrite,
       * which is what the emitter does for a reference array. */
      nts_array_push(holder, 0.0);
      holder->header.length--;
    }
    NTS_ITEMS(holder, NtsHeader *)[holder->header.length] = s;
    holder->header.length++;
  }
  check("a grown reference array holds its elements",
        holder->header.length == 64);
  nts_release(&holder->header);
  check("a grown reference array releases them and returns to the baseline",
        nts_live_bytes() == base);

  printf("%s\n", failures ? "FAILURES" : "all storage checks passed");
  return failures ? 1 : 0;
}
