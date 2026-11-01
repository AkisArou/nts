#ifndef NTS_NODE_BUFFER_H
#define NTS_NODE_BUFFER_H
#include "../../c/nts_runtime.h"

/* Managed record ABI: matches BufferAlignedAllocation in pool-native.d.ts. */
typedef struct NtsBufferAlignedAllocation {
  NtsHeader header;
  NtsBuffer *buffer;
  double byte_offset;
} NtsBufferAlignedAllocation;

NtsHeader *nts_buffer_allocate_aligned(double size, double alignment);
NtsBuffer *nts_buffer_create_unsafe_array_buffer(double size);
double nts_buffer_array_buffer_aligned_offset(NtsBuffer *buffer,
                                              double alignment);
#endif
