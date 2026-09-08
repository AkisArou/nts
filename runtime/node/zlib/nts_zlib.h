/* Native half of node:zlib.
 *
 * The TypeScript owns validation, stream integration and public errors. This
 * file owns the compression-library state and the managed-value marshalling at
 * that boundary. Every signature mirrors src/native.d.ts exactly.
 *
 * That last sentence was false for seven of them until 2026-09-08: every
 * `Uint8Array` in the declarations -- `input`, `dictionary`, and the bytes these
 * return -- was written `NtsArray *` here, and a `Uint8Array` lowers to
 * `NtsView *`. Different structs, so the emitted C could not compile. `nts_crc32`
 * was the same mistake and was found first. Nothing else could see them: `zlib`
 * does not compile for other reasons, and the interpreted lane's stand-ins are
 * node's own zlib, so the one lane that runs cannot disagree with node. */
#ifndef NTS_NODE_ZLIB_H
#define NTS_NODE_ZLIB_H

#include "nts_runtime.h"

double nts_zlib_create(double mode, double level, double window_bits,
                       double mem_level, double strategy, NtsView *dictionary,
                       bool reject_garbage_after_end);
double nts_zlib_create_params(double mode, NtsArray *keys, NtsArray *values,
                              NtsView *dictionary, double pledged_source_size,
                              bool reject_garbage_after_end);

NtsPromise *nts_zlib_write(double handle, double flush, NtsView *input,
                           double output_limit);
NtsView *nts_zlib_write_sync(double handle, double flush, NtsView *input,
                              double maximum_output);

double nts_zlib_status(double handle);
NtsString *nts_zlib_error_message(double handle);
NtsString *nts_zlib_error_code(double handle);
bool nts_zlib_stream_ended(double handle);
double nts_zlib_bytes_written(double handle);
bool nts_zlib_operation_pending(double handle);
void nts_zlib_reset(double handle);
double nts_zlib_params(double handle, double level, double strategy);
void nts_zlib_close(double handle);

NtsView *nts_zlib_oneshot(double mode, double level, double window_bits,
                          double mem_level, double strategy,
                          NtsView *dictionary, double finish_flush,
                          double maximum_output, NtsView *input,
                           bool reject_garbage_after_end);
NtsView *nts_zlib_oneshot_params(double mode, NtsArray *keys, NtsArray *values,
                                 NtsView *dictionary,
                                 double pledged_source_size,
                                 double finish_flush, double maximum_output,
                                 NtsView *input,
                                  bool reject_garbage_after_end);

double nts_zlib_last_status(void);
NtsString *nts_zlib_last_error_message(void);
NtsString *nts_zlib_last_error_code(void);

double nts_zlib_vernum(void);
double nts_crc32(NtsView *input, double initial);

#endif
