/* Node26 node_buffer.cc:1879-1912: alignment is address + byteOffset.
 * The shared host/compiled JS property test checks the observable properties;
 * this C observer additionally checks the actual address and backing lifetime.
 */
#include "buffer.h"
#include <stdint.h>
#include <stdio.h>

const uint32_t nts_closure_call_slot = 0;
static int failures;
static void check(bool holds, const char *name) {
  printf("%s %s\n", holds ? "ok  " : "FAIL", name);
  if (!holds)
    failures++;
}

int main(void) {
  const double sizes[] = {0, 0.5, 1, 1.5, 9, 65, 65.5, 65536};
  const double alignments[] = {1, 8, 64, 4096};
  for (size_t i = 0; i < sizeof sizes / sizeof sizes[0]; i++) {
    for (size_t j = 0; j < sizeof alignments / sizeof alignments[0]; j++) {
      const size_t before = nts_live_count();
      NtsHeader *owned = nts_buffer_allocate_aligned(sizes[i], alignments[j]);
      NtsBufferAlignedAllocation *allocation =
          (NtsBufferAlignedAllocation *)owned;
      const uintptr_t address = (uintptr_t)allocation->buffer->bytes;
      const uintptr_t offset = (uintptr_t)allocation->byte_offset;
      const uintptr_t alignment = (uintptr_t)alignments[j];
      /* Node's own test-buffer-alloc-alignment.js checks addresses only
         when size > 0. An empty view has no byte whose address must align. */
      check(sizes[i] == 0 || ((address + offset) & (alignment - 1)) == 0,
            "nonempty backing address plus offset meets requested alignment");
      NtsView *view = nts_view_new(allocation->buffer, allocation->byte_offset,
                                   sizes[i], NTS_ELEMENT_U8, false);
      nts_release(owned);
      check(nts_view_length(view) == (double)(size_t)sizes[i],
            "view length follows ToIndex without changing raw zero semantics");
      check(view->buffer->length ==
                (size_t)(sizes[i] == 0
                             ? 0
                             : sizes[i] +
                                   (alignments[j] < 8 ? 8 : alignments[j])),
            "view retains the backing after result record release");
      nts_release((NtsHeader *)view);
#ifdef NTS_PROVIDER_RC
      check(nts_live_count() == before,
            "result and view release all owned storage");
#else
      (void)before;
#endif
    }
  }
  return failures != 0;
}
