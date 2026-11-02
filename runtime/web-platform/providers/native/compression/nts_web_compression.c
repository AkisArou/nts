/* The shared CompressionProvider contract, over the bundled Brotli and zlib.
 * No codec, framing, checksum or dictionary algorithm is implemented here. */
#include "nts_web_compression.h"

#include <brotli/decode.h>
#include <brotli/encode.h>
#include <limits.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>
#include <zlib.h>

enum { OK, INVALID_DATA, OUTPUT_LIMIT, INCOMPLETE, OPERATION };
enum { BROTLI, GZIP, DEFLATE, RAW };
enum { PROCESS, SYNC, FINISH };
enum { OUTPUT_BLOCK = 16384 };

typedef struct {
  int format;
  int window;
  int status;
  bool decompress;
  bool closed;
  bool finished;
  bool ended;
  bool zlib_initialized;
  size_t consumed;
  z_stream zstream;
  BrotliEncoderState *encoder;
  BrotliDecoderState *decoder;
} Compression;

static const NtsDescriptor chunks_descriptor = {
    .kind = NTS_KIND_ARRAY,
    .size = sizeof(void *),
    .references = 1,
    .name = "Uint8Array[]",
    .element = NTS_ARRAY_REFERENCE,
};

static void close_codec(Compression *state) {
  if (state->encoder != NULL)
    BrotliEncoderDestroyInstance(state->encoder);
  if (state->decoder != NULL)
    BrotliDecoderDestroyInstance(state->decoder);
  state->encoder = NULL;
  state->decoder = NULL;
  if (state->zlib_initialized) {
    if (state->decompress)
      inflateEnd(&state->zstream);
    else
      deflateEnd(&state->zstream);
    state->zlib_initialized = false;
  }
}

static void destroy(void *pointer, size_t data) {
  (void)data;
  Compression *state = pointer;
  close_codec(state);
  free(state);
}

static Compression *context(NtsHeader *handle) {
  if (handle == NULL || handle->descriptor == NULL ||
      handle->descriptor->kind != NTS_KIND_BOXED)
    abort();
  NtsBoxed *box = (NtsBoxed *)handle;
  if (box->free != destroy || box->boxed == NULL)
    abort();
  return box->boxed;
}

static bool initialize(Compression *state) {
  state->ended = false;
  state->finished = false;
  state->consumed = 0;
  state->status = OK;
  if (state->format == BROTLI) {
    if (state->decompress) {
      state->decoder = BrotliDecoderCreateInstance(NULL, NULL, NULL);
      return state->decoder != NULL &&
             BrotliDecoderSetParameter(state->decoder,
                                       BROTLI_DECODER_PARAM_LARGE_WINDOW, 0);
    }
    state->encoder = BrotliEncoderCreateInstance(NULL, NULL, NULL);
    return state->encoder != NULL;
  }
  memset(&state->zstream, 0, sizeof(state->zstream));
  int window = state->format == RAW ? -state->window : state->window;
  if (state->format == GZIP)
    window += 16;
  int result = state->decompress
                   ? inflateInit2(&state->zstream, window)
                   : deflateInit2(&state->zstream, Z_DEFAULT_COMPRESSION,
                                  Z_DEFLATED, window, 8, Z_DEFAULT_STRATEGY);
  state->zlib_initialized = result == Z_OK;
  return state->zlib_initialized;
}

NtsHeader *nts_web_compression_open(double format, bool decompress,
                                    double window_bits) {
  if (!isfinite(format) || format < BROTLI || format > RAW ||
      floor(format) != format)
    return NULL;
  if (format != BROTLI &&
      (!isfinite(window_bits) || window_bits < (decompress ? 8 : 9) ||
       window_bits > 15 || floor(window_bits) != window_bits))
    return NULL;
  Compression *state = calloc(1, sizeof(*state));
  if (state == NULL)
    return NULL;
  state->format = (int)format;
  state->decompress = decompress;
  // Brotli ignores the DEFLATE-only argument, including non-finite values.
  state->window = format == BROTLI ? 0 : (int)window_bits;
  if (!initialize(state)) {
    destroy(state, 0);
    return NULL;
  }
  return nts_boxed_new(state, destroy, 0);
}

static void fail(Compression *state, int status) {
  state->status = status;
  state->closed = true;
  close_codec(state);
}

/* One bounded native step. Pointers are borrowed only for this invocation. */
static bool step(Compression *state, int flush, const uint8_t **input,
                 size_t *remaining, uint8_t *output, size_t capacity,
                 size_t *produced) {
  size_t available = capacity;
  uint8_t *next = output;
  bool again = false;
  if (state->format == BROTLI) {
    if (state->decompress) {
      BrotliDecoderResult result = BrotliDecoderDecompressStream(
          state->decoder, remaining, input, &available, &next, NULL);
      if (result == BROTLI_DECODER_RESULT_ERROR) {
        int code = BrotliDecoderGetErrorCode(state->decoder);
        fail(state, code <= -1 && code >= -19 ? INVALID_DATA : OPERATION);
      } else {
        state->ended = result == BROTLI_DECODER_RESULT_SUCCESS;
        again = result == BROTLI_DECODER_RESULT_NEEDS_MORE_OUTPUT;
      }
    } else {
      BrotliEncoderOperation operation =
          flush == PROCESS ? BROTLI_OPERATION_PROCESS
          : flush == SYNC  ? BROTLI_OPERATION_FLUSH
                           : BROTLI_OPERATION_FINISH;
      if (!BrotliEncoderCompressStream(state->encoder, operation, remaining,
                                       input, &available, &next, NULL))
        fail(state, OPERATION);
      else {
        state->ended = BrotliEncoderIsFinished(state->encoder);
        again = !state->ended && (BrotliEncoderHasMoreOutput(state->encoder) ||
                                  *remaining != 0 || (flush == FINISH));
      }
    }
  } else {
    size_t amount = *remaining > UINT_MAX ? UINT_MAX : *remaining;
    state->zstream.next_in = (Bytef *)*input;
    state->zstream.avail_in = (uInt)amount;
    state->zstream.next_out = output;
    state->zstream.avail_out = (uInt)capacity;
    // Drain decompression with NO_FLUSH before classifying an incomplete
    // finish, so valid output survives that one failure as the contract says.
    int operation = state->decompress  ? Z_NO_FLUSH
                    : flush == PROCESS ? Z_NO_FLUSH
                    : flush == SYNC    ? Z_SYNC_FLUSH
                                       : Z_FINISH;
    int result = state->decompress ? inflate(&state->zstream, operation)
                                   : deflate(&state->zstream, operation);
    size_t consumed = amount - state->zstream.avail_in;
    if (consumed != 0)
      *input += consumed;
    *remaining -= consumed;
    available = state->zstream.avail_out;
    state->ended = result == Z_STREAM_END;
    if (result != Z_OK && result != Z_BUF_ERROR && result != Z_STREAM_END)
      fail(state, result == Z_DATA_ERROR || result == Z_NEED_DICT ? INVALID_DATA
                                                                  : OPERATION);
    again = !state->ended && (available == 0 || *remaining != 0);
    state->zstream.next_in = NULL;
    state->zstream.next_out = NULL;
    state->zstream.avail_in = 0;
    state->zstream.avail_out = 0;
  }
  *produced = capacity - available;
  return again;
}

NtsArray *nts_web_compression_process(NtsHeader *handle, NtsView *input,
                                      double flush, double maximum) {
  Compression *state = context(handle);
  NtsArray *chunks = nts_array_new(&chunks_descriptor, 0);
  state->consumed = 0;
  if (state->closed || state->finished) {
    state->status = OPERATION;
    return chunks;
  }
  if (!isfinite(flush) || flush < PROCESS || flush > FINISH ||
      floor(flush) != flush || isnan(maximum) || maximum < 0 ||
      (isfinite(maximum) &&
       (floor(maximum) != maximum || maximum > 9007199254740991.0))) {
    fail(state, OPERATION);
    return chunks;
  }
  size_t length = (size_t)nts_view_byte_length(input);
  const uint8_t *source = nts_view_bytes(input);
  size_t remaining = length;
  size_t total = 0;
  if (!state->ended) {
    bool again;
    do {
      // Bound retained output as it is produced. At most one extra byte is
      // probed, never transferred, to distinguish exact fit from overflow.
      size_t capacity = OUTPUT_BLOCK;
      double budget = maximum - (double)total;
      if (budget < OUTPUT_BLOCK)
        capacity = (size_t)budget + 1;
      NtsBuffer *buffer = nts_buffer_new((double)capacity);
      if (buffer == NULL) {
        fail(state, OPERATION);
        break;
      }
      size_t produced = 0;
      size_t before = remaining;
      again = step(state, (int)flush, &source, &remaining, buffer->bytes,
                   capacity, &produced);
      if ((double)produced > budget)
        fail(state, OUTPUT_LIMIT);
      if (state->status == OK && produced != 0) {
        NtsView *chunk =
            nts_view_new(buffer, 0, (double)produced, NTS_ELEMENT_U8, false);
        if (chunk == NULL)
          fail(state, OPERATION);
        else {
          // push_ref transfers this newly created reference to the array.
          nts_array_push_ref(chunks, chunk);
          total += produced;
        }
      }
      nts_release((NtsHeader *)buffer);
      if (state->status != OK)
        break;
      if (again && before == remaining && produced == 0) {
        fail(state, OPERATION);
        break;
      }
    } while (again);
  }
  state->consumed = length - remaining;
  if (state->status == OK && flush == FINISH) {
    if (!state->ended)
      fail(state, INCOMPLETE);
    else
      state->finished = true;
  }
  if (state->status != OK && state->status != INCOMPLETE)
    nts_array_set_length_ref(chunks, 0);
  return chunks;
}

double nts_web_compression_status(NtsHeader *handle) {
  return context(handle)->status;
}
double nts_web_compression_consumed(NtsHeader *handle) {
  return (double)context(handle)->consumed;
}

bool nts_web_compression_reset(NtsHeader *handle) {
  Compression *state = context(handle);
  if (state->closed)
    return false;
  close_codec(state);
  if (!initialize(state)) {
    fail(state, OPERATION);
    return false;
  }
  return true;
}

void nts_web_compression_close(NtsHeader *handle) {
  Compression *state = context(handle);
  close_codec(state);
  state->closed = true;
}
