/* Native operations behind Node v26.13.0's Buffer allocator. */
#include "buffer.h"
#include <stdint.h>

NtsBuffer *nts_buffer_create_unsafe_array_buffer(double size) {
  /* The unsafe API permits initialized storage; use the runtime's allocator
     and ownership contract, shared with every ArrayBuffer. */
  return nts_buffer_new(size);
}

double nts_buffer_array_buffer_aligned_offset(NtsBuffer *buffer,
                                              double alignment) {
  const uintptr_t mask = (uintptr_t)alignment - 1;
  const uintptr_t address = (uintptr_t)buffer->bytes;
  return (double)((0 - address) & mask);
}

/* nts_buffer_mark_as_untransferable requires an actual detach-key state in
   the ArrayBuffer runtime. It has no placeholder implementation here. */
