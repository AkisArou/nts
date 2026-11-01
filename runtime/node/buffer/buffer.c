/* Native operations behind Node v26.13.0's Buffer allocator. */
#include "buffer.h"
#include <math.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>

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

/* nts_buffer_mark_as_untransferable is the backing-identity operation in
   nts_runtime.c, shared with the guards at both ArrayBuffer transfer methods.
 */

/* The result owns its backing reference. Both fields follow the declaration
   order of the managed TypeScript record; numbers cross this ABI as double. */
static const uint32_t aligned_allocation_references[] = {
    offsetof(NtsBufferAlignedAllocation, buffer)};
static const NtsDescriptor aligned_allocation_descriptor = {
    .kind = NTS_KIND_OBJECT,
    .size = sizeof(NtsBufferAlignedAllocation),
    .references = 1,
    .cyclic = 0,
    .offsets = aligned_allocation_references,
    .methods = NULL,
    .name = "BufferAlignedAllocation",
    .erased = 0,
    .erased_offsets = NULL,
    .element = NTS_ARRAY_UNKNOWN,
    .foreign = 0,
    .foreign_slots = NULL,
    .to_string = NULL,
    .function_name = NULL,
    .release_fields = NULL,
    .trace_fields = NULL,
};

NtsHeader *nts_buffer_allocate_aligned(double size, double alignment) {
  /* Callers apply Node's public argument validation before this primitive. */
  /* Preserve the public size through extent allocation: nts_buffer_new and
     the later view each apply ToIndex. Positive subintegers still allocate
     padding, unlike the distinct raw-size-zero path. */
  if (!isfinite(size) || size < 0 ||
      !isfinite(alignment) || alignment < 1 || alignment > 1073741824.0 ||
      floor(alignment) != alignment)
    abort();
  const uintptr_t align = (uintptr_t)alignment;
  if ((align & (align - 1)) != 0)
    abort();
  const double padding = alignment < 8 ? 8 : alignment;
  const double extent = size == 0 ? 0 : size + padding;
  NtsBuffer *buffer = nts_buffer_create_unsafe_array_buffer(extent);
  if (buffer == NULL)
    abort();
  NtsBufferAlignedAllocation *result =
      (NtsBufferAlignedAllocation *)nts_object_new(
          &aligned_allocation_descriptor);
  if (result == NULL) {
    nts_release((NtsHeader *)buffer);
    abort();
  }
  result->buffer = buffer;
  result->byte_offset =
      size == 0 ? 0 : nts_buffer_array_buffer_aligned_offset(buffer, alignment);
  return &result->header;
}
