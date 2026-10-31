#ifndef NTS_NODE_BUFFER_H
#define NTS_NODE_BUFFER_H
#include "../../c/nts_runtime.h"
NtsBuffer *nts_buffer_create_unsafe_array_buffer(double size);
double nts_buffer_array_buffer_aligned_offset(NtsBuffer *buffer,
                                              double alignment);
#endif
