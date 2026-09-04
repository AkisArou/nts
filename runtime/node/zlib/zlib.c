/* Compression engines for node:zlib.
 *
 * Node delegates these algorithms to zlib, Brotli and Zstandard as well. The
 * important work here is preserving their incremental state while returning
 * at most one TypeScript stream chunk per operation. Async writes run in
 * libuv's worker pool; only their completion allocates managed objects or
 * settles a promise, back on the owner thread. */
#include "nts_zlib.h"

#include <brotli/decode.h>
#include <brotli/encode.h>
#include <brotli/shared_dictionary.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <uv.h>
#include <zlib.h>
#include <zstd.h>
#include <zstd_errors.h>

enum {
  NTS_DEFLATE = 1,
  NTS_INFLATE = 2,
  NTS_GZIP = 3,
  NTS_GUNZIP = 4,
  NTS_DEFLATERAW = 5,
  NTS_INFLATERAW = 6,
  NTS_UNZIP = 7,
  NTS_BROTLI_DECODE = 8,
  NTS_BROTLI_ENCODE = 9,
  NTS_ZSTD_COMPRESS = 10,
  NTS_ZSTD_DECOMPRESS = 11,
};

typedef enum NtsZlibFamily {
  NTS_ZLIB_FAMILY_ZLIB,
  NTS_ZLIB_FAMILY_BROTLI_ENCODER,
  NTS_ZLIB_FAMILY_BROTLI_DECODER,
  NTS_ZLIB_FAMILY_ZSTD_COMPRESSOR,
  NTS_ZLIB_FAMILY_ZSTD_DECOMPRESSOR,
} NtsZlibFamily;

typedef struct NtsZlibEngine NtsZlibEngine;

struct NtsZlibEngine {
  uint64_t identifier;
  int mode;
  NtsZlibFamily family;
  bool reject_garbage_after_end;
  bool stream_ended;
  bool frame_complete;
  bool busy;
  bool closing;
  int status;
  char error_message[256];
  char error_code[96];
  uint64_t bytes_written;

  uint8_t *dictionary;
  size_t dictionary_length;
  uint64_t pledged_source_size;

  uint8_t *operation_input;
  size_t operation_length;
  size_t operation_offset;
  int operation_flush;
  bool operation_pending;

  unsigned unzip_prefix_length;
  uint8_t unzip_prefix[2];

  z_stream zstream;
  bool zstream_initialized;
  BrotliEncoderState *brotli_encoder;
  BrotliEncoderPreparedDictionary *brotli_dictionary;
  BrotliDecoderState *brotli_decoder;
  ZSTD_CCtx *zstd_compressor;
  ZSTD_DCtx *zstd_decompressor;

  NtsZlibEngine *next;
};

typedef struct NtsZlibWork {
  uv_work_t request;
  NtsZlibEngine *engine;
  NtsPromise *promise;
  uint8_t *output;
  size_t output_limit;
  size_t output_length;
} NtsZlibWork;

typedef struct NtsZlibBuffer {
  uint8_t *data;
  size_t length;
  size_t capacity;
  size_t maximum;
} NtsZlibBuffer;

static const NtsDescriptor nts_zlib_desc_u8 = {
    NTS_KIND_ARRAY, sizeof(uint8_t), 0, 0, 0, 0, "u8[]", 0, 0,
};

/* A loaded addon may be used by more than one Node worker. Handles and the
 * synchronous one-shot error slot belong to the calling runtime thread; the
 * libuv work item carries its engine pointer directly and never consults this
 * registry from a pool thread. */
static _Thread_local NtsZlibEngine *nts_zlib_engines;
static _Thread_local uint64_t nts_zlib_next_identifier = 1;
static _Thread_local int nts_zlib_global_status;
static _Thread_local char nts_zlib_global_message[256];
static _Thread_local char nts_zlib_global_code[96];

static NtsString *nts_zlib_string(const char *text) {
  return nts_string_from_utf8(text, text == NULL ? 0 : strlen(text));
}

static NtsArray *nts_zlib_bytes(const uint8_t *bytes, size_t length) {
  NtsArray *result = nts_array_new(&nts_zlib_desc_u8, (double)length);
  if (length != 0) {
    memcpy(NTS_ITEMS(result, uint8_t), bytes, length);
  }
  return result;
}

static const char *nts_zlib_code(int status) {
  switch (status) {
  case Z_OK:
    return "Z_OK";
  case Z_STREAM_END:
    return "Z_STREAM_END";
  case Z_NEED_DICT:
    return "Z_NEED_DICT";
  case Z_ERRNO:
    return "Z_ERRNO";
  case Z_STREAM_ERROR:
    return "Z_STREAM_ERROR";
  case Z_DATA_ERROR:
    return "Z_DATA_ERROR";
  case Z_MEM_ERROR:
    return "Z_MEM_ERROR";
  case Z_BUF_ERROR:
    return "Z_BUF_ERROR";
  case Z_VERSION_ERROR:
    return "Z_VERSION_ERROR";
  default:
    return "Z_UNKNOWN_ERROR";
  }
}

static void nts_zlib_copy_error(char *target, size_t capacity,
                                const char *source) {
  if (capacity == 0)
    return;
  snprintf(target, capacity, "%s", source == NULL ? "" : source);
}

static void nts_zlib_clear_global_error(void) {
  nts_zlib_global_status = 0;
  nts_zlib_global_message[0] = '\0';
  nts_zlib_global_code[0] = '\0';
}

static void nts_zlib_set_global_error(int status, const char *message,
                                      const char *code) {
  nts_zlib_global_status = status;
  nts_zlib_copy_error(nts_zlib_global_message, sizeof(nts_zlib_global_message),
                      message);
  nts_zlib_copy_error(nts_zlib_global_code, sizeof(nts_zlib_global_code), code);
}

static void nts_zlib_clear_error(NtsZlibEngine *engine) {
  engine->status = 0;
  engine->error_message[0] = '\0';
  engine->error_code[0] = '\0';
}

static void nts_zlib_set_error(NtsZlibEngine *engine, int status,
                               const char *message, const char *code) {
  engine->status = status;
  nts_zlib_copy_error(engine->error_message, sizeof(engine->error_message),
                      message);
  nts_zlib_copy_error(engine->error_code, sizeof(engine->error_code), code);
}

static void nts_zlib_publish_error(const NtsZlibEngine *engine) {
  nts_zlib_set_global_error(engine->status, engine->error_message,
                            engine->error_code);
}

static bool nts_zlib_is_zlib_encoder(int mode) {
  return mode == NTS_DEFLATE || mode == NTS_GZIP || mode == NTS_DEFLATERAW;
}

static bool nts_zlib_is_zlib_decoder(int mode) {
  return mode == NTS_INFLATE || mode == NTS_GUNZIP || mode == NTS_INFLATERAW ||
         mode == NTS_UNZIP;
}

static bool nts_zlib_is_gzip_decoder(const NtsZlibEngine *engine) {
  if (engine->mode == NTS_GUNZIP)
    return true;
  return engine->mode == NTS_UNZIP && engine->unzip_prefix_length == 2 &&
         engine->unzip_prefix[0] == 0x1f && engine->unzip_prefix[1] == 0x8b;
}

static void nts_zlib_sniff_unzip(NtsZlibEngine *engine, const uint8_t *input,
                                 size_t length) {
  if (engine->mode != NTS_UNZIP || engine->unzip_prefix_length == 2)
    return;
  size_t offset = 0;
  while (offset < length && engine->unzip_prefix_length < 2) {
    engine->unzip_prefix[engine->unzip_prefix_length++] = input[offset++];
  }
}

static bool nts_zlib_copy_dictionary(NtsZlibEngine *engine,
                                     const NtsArray *dictionary) {
  size_t length = dictionary == NULL ? 0 : dictionary->header.length;
  if (length == 0)
    return true;
  engine->dictionary = malloc(length);
  if (engine->dictionary == NULL) {
    nts_zlib_set_error(engine, Z_MEM_ERROR, "Out of memory", "Z_MEM_ERROR");
    return false;
  }
  memcpy(engine->dictionary, NTS_ITEMS(dictionary, uint8_t), length);
  engine->dictionary_length = length;
  return true;
}

static NtsZlibEngine *nts_zlib_allocate_engine(int mode, NtsZlibFamily family,
                                               const NtsArray *dictionary,
                                               bool reject_garbage_after_end) {
  NtsZlibEngine *engine = calloc(1, sizeof(*engine));
  if (engine == NULL) {
    nts_zlib_set_global_error(Z_MEM_ERROR, "Out of memory", "Z_MEM_ERROR");
    return NULL;
  }
  engine->mode = mode;
  engine->family = family;
  engine->reject_garbage_after_end = reject_garbage_after_end;
  if (!nts_zlib_copy_dictionary(engine, dictionary)) {
    nts_zlib_publish_error(engine);
    free(engine);
    return NULL;
  }
  return engine;
}

static int nts_zlib_set_zlib_dictionary(NtsZlibEngine *engine) {
  if (engine->dictionary_length == 0)
    return Z_OK;
  if (engine->mode == NTS_DEFLATE || engine->mode == NTS_DEFLATERAW) {
    return deflateSetDictionary(&engine->zstream, engine->dictionary,
                                (uInt)engine->dictionary_length);
  }
  if (engine->mode == NTS_INFLATERAW) {
    return inflateSetDictionary(&engine->zstream, engine->dictionary,
                                (uInt)engine->dictionary_length);
  }
  return Z_OK;
}

static bool nts_zlib_initialize_zlib(NtsZlibEngine *engine, int level,
                                     int window_bits, int mem_level,
                                     int strategy) {
  int adjusted_window_bits = window_bits;
  if (engine->mode == NTS_GZIP || engine->mode == NTS_GUNZIP) {
    adjusted_window_bits += 16;
  } else if (engine->mode == NTS_UNZIP) {
    adjusted_window_bits += 32;
  } else if (engine->mode == NTS_DEFLATERAW || engine->mode == NTS_INFLATERAW) {
    adjusted_window_bits *= -1;
  }

  memset(&engine->zstream, 0, sizeof(engine->zstream));
  int status;
  if (nts_zlib_is_zlib_encoder(engine->mode)) {
    status = deflateInit2(&engine->zstream, level, Z_DEFLATED,
                          adjusted_window_bits, mem_level, strategy);
  } else {
    status = inflateInit2(&engine->zstream, adjusted_window_bits);
  }
  if (status != Z_OK) {
    nts_zlib_set_error(engine, status, "Could not initialize zlib instance",
                       nts_zlib_code(status));
    return false;
  }
  engine->zstream_initialized = true;
  status = nts_zlib_set_zlib_dictionary(engine);
  if (status != Z_OK) {
    nts_zlib_set_error(engine, status, "Failed to set dictionary",
                       nts_zlib_code(status));
    return false;
  }
  return true;
}

static void nts_zlib_destroy_brotli(NtsZlibEngine *engine) {
  if (engine->brotli_encoder != NULL) {
    BrotliEncoderDestroyInstance(engine->brotli_encoder);
    engine->brotli_encoder = NULL;
  }
  if (engine->brotli_dictionary != NULL) {
    BrotliEncoderDestroyPreparedDictionary(engine->brotli_dictionary);
    engine->brotli_dictionary = NULL;
  }
  if (engine->brotli_decoder != NULL) {
    BrotliDecoderDestroyInstance(engine->brotli_decoder);
    engine->brotli_decoder = NULL;
  }
}

static bool nts_zlib_initialize_brotli(NtsZlibEngine *engine,
                                       bool use_dictionary) {
  nts_zlib_destroy_brotli(engine);
  if (engine->family == NTS_ZLIB_FAMILY_BROTLI_ENCODER) {
    engine->brotli_encoder = BrotliEncoderCreateInstance(NULL, NULL, NULL);
    if (engine->brotli_encoder == NULL) {
      nts_zlib_set_error(engine, -1, "Could not initialize Brotli instance",
                         "ERR_ZLIB_INITIALIZATION_FAILED");
      return false;
    }
    if (use_dictionary && engine->dictionary_length != 0) {
      engine->brotli_dictionary = BrotliEncoderPrepareDictionary(
          BROTLI_SHARED_DICTIONARY_RAW, engine->dictionary_length,
          engine->dictionary, BROTLI_MAX_QUALITY, NULL, NULL, NULL);
      if (engine->brotli_dictionary == NULL ||
          !BrotliEncoderAttachPreparedDictionary(engine->brotli_encoder,
                                                 engine->brotli_dictionary)) {
        nts_zlib_set_error(engine, -1, "Failed to attach brotli dictionary",
                           "ERR_ZLIB_DICTIONARY_LOAD_FAILED");
        return false;
      }
    }
    return true;
  }

  engine->brotli_decoder = BrotliDecoderCreateInstance(NULL, NULL, NULL);
  if (engine->brotli_decoder == NULL) {
    nts_zlib_set_error(engine, -1, "Could not initialize Brotli instance",
                       "ERR_ZLIB_INITIALIZATION_FAILED");
    return false;
  }
  if (use_dictionary && engine->dictionary_length != 0 &&
      !BrotliDecoderAttachDictionary(
          engine->brotli_decoder, BROTLI_SHARED_DICTIONARY_RAW,
          engine->dictionary_length, engine->dictionary)) {
    nts_zlib_set_error(engine, -1, "Failed to attach brotli dictionary",
                       "ERR_ZLIB_DICTIONARY_LOAD_FAILED");
    return false;
  }
  return true;
}

static void nts_zlib_destroy_zstd(NtsZlibEngine *engine) {
  if (engine->zstd_compressor != NULL) {
    ZSTD_freeCCtx(engine->zstd_compressor);
    engine->zstd_compressor = NULL;
  }
  if (engine->zstd_decompressor != NULL) {
    ZSTD_freeDCtx(engine->zstd_decompressor);
    engine->zstd_decompressor = NULL;
  }
}

static void nts_zlib_set_zstd_error(NtsZlibEngine *engine, size_t result,
                                    const char *message,
                                    const char *fallback_code) {
  ZSTD_ErrorCode code = ZSTD_getErrorCode(result);
  const char *name = ZSTD_getErrorString(code);
  const char *code_name = fallback_code;
  if (code_name == NULL) {
#define NTS_ZSTD_ERROR_CASE(value)                                             \
  case value:                                                                  \
    code_name = #value;                                                        \
    break
    switch (code) {
      NTS_ZSTD_ERROR_CASE(ZSTD_error_no_error);
      NTS_ZSTD_ERROR_CASE(ZSTD_error_GENERIC);
      NTS_ZSTD_ERROR_CASE(ZSTD_error_prefix_unknown);
      NTS_ZSTD_ERROR_CASE(ZSTD_error_version_unsupported);
      NTS_ZSTD_ERROR_CASE(ZSTD_error_frameParameter_unsupported);
      NTS_ZSTD_ERROR_CASE(ZSTD_error_frameParameter_windowTooLarge);
      NTS_ZSTD_ERROR_CASE(ZSTD_error_corruption_detected);
      NTS_ZSTD_ERROR_CASE(ZSTD_error_checksum_wrong);
      NTS_ZSTD_ERROR_CASE(ZSTD_error_literals_headerWrong);
      NTS_ZSTD_ERROR_CASE(ZSTD_error_dictionary_corrupted);
      NTS_ZSTD_ERROR_CASE(ZSTD_error_dictionary_wrong);
      NTS_ZSTD_ERROR_CASE(ZSTD_error_dictionaryCreation_failed);
      NTS_ZSTD_ERROR_CASE(ZSTD_error_parameter_unsupported);
      NTS_ZSTD_ERROR_CASE(ZSTD_error_parameter_combination_unsupported);
      NTS_ZSTD_ERROR_CASE(ZSTD_error_parameter_outOfBound);
      NTS_ZSTD_ERROR_CASE(ZSTD_error_tableLog_tooLarge);
      NTS_ZSTD_ERROR_CASE(ZSTD_error_maxSymbolValue_tooLarge);
      NTS_ZSTD_ERROR_CASE(ZSTD_error_maxSymbolValue_tooSmall);
      NTS_ZSTD_ERROR_CASE(ZSTD_error_stabilityCondition_notRespected);
      NTS_ZSTD_ERROR_CASE(ZSTD_error_stage_wrong);
      NTS_ZSTD_ERROR_CASE(ZSTD_error_init_missing);
      NTS_ZSTD_ERROR_CASE(ZSTD_error_memory_allocation);
      NTS_ZSTD_ERROR_CASE(ZSTD_error_workSpace_tooSmall);
      NTS_ZSTD_ERROR_CASE(ZSTD_error_dstSize_tooSmall);
      NTS_ZSTD_ERROR_CASE(ZSTD_error_srcSize_wrong);
      NTS_ZSTD_ERROR_CASE(ZSTD_error_dstBuffer_null);
      NTS_ZSTD_ERROR_CASE(ZSTD_error_noForwardProgress_destFull);
      NTS_ZSTD_ERROR_CASE(ZSTD_error_noForwardProgress_inputEmpty);
    default:
      code_name = "ZSTD_error_GENERIC";
      break;
    }
#undef NTS_ZSTD_ERROR_CASE
  }
  nts_zlib_set_error(engine, (int)code, message == NULL ? name : message,
                     code_name);
}

static bool nts_zlib_initialize_zstd(NtsZlibEngine *engine,
                                     bool use_dictionary) {
  nts_zlib_destroy_zstd(engine);
  size_t result;
  if (engine->family == NTS_ZLIB_FAMILY_ZSTD_COMPRESSOR) {
    engine->zstd_compressor = ZSTD_createCCtx();
    if (engine->zstd_compressor == NULL) {
      nts_zlib_set_error(engine, -1, "Could not initialize zstd instance",
                         "ERR_ZLIB_INITIALIZATION_FAILED");
      return false;
    }
    if (use_dictionary && engine->dictionary_length != 0) {
      result =
          ZSTD_CCtx_loadDictionary(engine->zstd_compressor, engine->dictionary,
                                   engine->dictionary_length);
      if (ZSTD_isError(result)) {
        nts_zlib_set_zstd_error(engine, result,
                                "Failed to load zstd dictionary",
                                "ERR_ZLIB_DICTIONARY_LOAD_FAILED");
        return false;
      }
    }
    result = ZSTD_CCtx_setPledgedSrcSize(engine->zstd_compressor,
                                         engine->pledged_source_size);
    if (ZSTD_isError(result)) {
      nts_zlib_set_zstd_error(engine, result, "Could not set pledged src size",
                              "ERR_ZLIB_INITIALIZATION_FAILED");
      return false;
    }
    return true;
  }

  engine->zstd_decompressor = ZSTD_createDCtx();
  if (engine->zstd_decompressor == NULL) {
    nts_zlib_set_error(engine, -1, "Could not initialize zstd instance",
                       "ERR_ZLIB_INITIALIZATION_FAILED");
    return false;
  }
  if (use_dictionary && engine->dictionary_length != 0) {
    result =
        ZSTD_DCtx_loadDictionary(engine->zstd_decompressor, engine->dictionary,
                                 engine->dictionary_length);
    if (ZSTD_isError(result)) {
      nts_zlib_set_zstd_error(engine, result, "Failed to load zstd dictionary",
                              "ERR_ZLIB_DICTIONARY_LOAD_FAILED");
      return false;
    }
  }
  return true;
}

static void nts_zlib_end_operation(NtsZlibEngine *engine) {
  free(engine->operation_input);
  engine->operation_input = NULL;
  engine->operation_length = 0;
  engine->operation_offset = 0;
  engine->operation_pending = false;
}

static void nts_zlib_free_engine(NtsZlibEngine *engine) {
  if (engine == NULL)
    return;
  nts_zlib_end_operation(engine);
  if (engine->zstream_initialized) {
    if (nts_zlib_is_zlib_encoder(engine->mode)) {
      deflateEnd(&engine->zstream);
    } else {
      inflateEnd(&engine->zstream);
    }
  }
  nts_zlib_destroy_brotli(engine);
  nts_zlib_destroy_zstd(engine);
  free(engine->dictionary);
  free(engine);
}

static NtsZlibEngine *nts_zlib_find(double identifier) {
  uint64_t wanted = (uint64_t)identifier;
  for (NtsZlibEngine *engine = nts_zlib_engines; engine != NULL;
       engine = engine->next) {
    if (engine->identifier == wanted)
      return engine;
  }
  return NULL;
}

static double nts_zlib_register(NtsZlibEngine *engine) {
  if (nts_zlib_next_identifier > 9007199254740991ULL) {
    nts_zlib_next_identifier = 1;
  }
  engine->identifier = nts_zlib_next_identifier++;
  engine->next = nts_zlib_engines;
  nts_zlib_engines = engine;
  return (double)engine->identifier;
}

static void nts_zlib_unlink(NtsZlibEngine *engine) {
  NtsZlibEngine **link = &nts_zlib_engines;
  while (*link != NULL) {
    if (*link == engine) {
      *link = engine->next;
      engine->next = NULL;
      return;
    }
    link = &(*link)->next;
  }
}

static bool nts_zlib_begin_operation(NtsZlibEngine *engine, int flush,
                                     const NtsArray *input) {
  size_t length = input == NULL ? 0 : input->header.length;
  const uint8_t *bytes = input == NULL ? NULL : NTS_ITEMS(input, uint8_t);
  if (engine->operation_pending) {
    if (length != 0 || flush != engine->operation_flush) {
      nts_zlib_set_error(engine, Z_STREAM_ERROR,
                         "A compression operation is already pending",
                         "Z_STREAM_ERROR");
      nts_zlib_end_operation(engine);
      return false;
    }
    return true;
  }
  if (engine->status != 0)
    return false;

  if (length != 0) {
    engine->operation_input = malloc(length);
    if (engine->operation_input == NULL) {
      nts_zlib_set_error(engine, Z_MEM_ERROR, "Out of memory", "Z_MEM_ERROR");
      return false;
    }
    memcpy(engine->operation_input, bytes, length);
    nts_zlib_sniff_unzip(engine, bytes, length);
  }
  engine->operation_length = length;
  engine->operation_offset = 0;
  engine->operation_flush = flush;
  engine->operation_pending = true;
  return true;
}

static void nts_zlib_trailing_error(NtsZlibEngine *engine) {
  nts_zlib_set_error(
      engine, Z_DATA_ERROR,
      "Trailing junk found after the end of the compressed stream",
      "ERR_TRAILING_JUNK_AFTER_STREAM_END");
}

static void nts_zlib_zlib_step(NtsZlibEngine *engine, uint8_t *output,
                               size_t output_limit, size_t *output_length) {
  size_t remaining = engine->operation_length - engine->operation_offset;
  uInt input_length = remaining > UINT_MAX ? UINT_MAX : (uInt)remaining;
  uInt writable = output_limit > UINT_MAX ? UINT_MAX : (uInt)output_limit;
  engine->zstream.next_in =
      engine->operation_input == NULL
          ? Z_NULL
          : engine->operation_input + engine->operation_offset;
  engine->zstream.avail_in = input_length;
  engine->zstream.next_out = output;
  engine->zstream.avail_out = writable;

  int result;
  if (nts_zlib_is_zlib_encoder(engine->mode)) {
    result = deflate(&engine->zstream, engine->operation_flush);
  } else {
    if (engine->frame_complete && nts_zlib_is_gzip_decoder(engine)) {
      int reset_status = inflateReset(&engine->zstream);
      if (reset_status != Z_OK) {
        nts_zlib_set_error(engine, reset_status, "Failed to reset gzip member",
                           nts_zlib_code(reset_status));
        engine->zstream.next_in = Z_NULL;
        engine->zstream.avail_in = 0;
        engine->zstream.next_out = Z_NULL;
        engine->zstream.avail_out = 0;
        nts_zlib_end_operation(engine);
        return;
      }
      engine->frame_complete = false;
    }
    result = inflate(&engine->zstream, engine->operation_flush);
    if (result == Z_NEED_DICT && engine->mode != NTS_INFLATERAW &&
        engine->dictionary_length != 0) {
      int dictionary_status =
          inflateSetDictionary(&engine->zstream, engine->dictionary,
                               (uInt)engine->dictionary_length);
      result = dictionary_status == Z_OK
                   ? inflate(&engine->zstream, engine->operation_flush)
                   : Z_NEED_DICT;
    }
  }

  size_t consumed = (size_t)input_length - engine->zstream.avail_in;
  engine->operation_offset += consumed;
  engine->bytes_written += consumed;
  *output_length = (size_t)writable - engine->zstream.avail_out;
  bool output_full = engine->zstream.avail_out == 0;
  bool input_left = engine->operation_offset < engine->operation_length;

  if (nts_zlib_is_zlib_decoder(engine->mode) && result == Z_STREAM_END &&
      input_left && engine->reject_garbage_after_end) {
    nts_zlib_trailing_error(engine);
  } else if ((result == Z_OK || result == Z_BUF_ERROR) &&
             engine->operation_flush == Z_FINISH && !output_full) {
    nts_zlib_set_error(engine, Z_BUF_ERROR, "unexpected end of file",
                       "Z_BUF_ERROR");
  } else if (result == Z_NEED_DICT) {
    nts_zlib_set_error(engine, result,
                       engine->dictionary_length == 0 ? "Missing dictionary"
                                                      : "Bad dictionary",
                       "Z_NEED_DICT");
  } else if (result != Z_OK && result != Z_BUF_ERROR &&
             result != Z_STREAM_END) {
    nts_zlib_set_error(engine, result,
                       engine->zstream.msg == NULL ? "Zlib error"
                                                   : engine->zstream.msg,
                       nts_zlib_code(result));
  }

  engine->frame_complete = result == Z_STREAM_END;
  bool continue_gzip =
      engine->status == 0 && input_left && engine->frame_complete &&
      nts_zlib_is_gzip_decoder(engine) && engine->zstream.next_in[0] != 0x00;
  bool pending = engine->status == 0 &&
                 ((output_full && !engine->frame_complete) || continue_gzip);
  if (engine->status == 0 && nts_zlib_is_zlib_encoder(engine->mode) &&
      input_left) {
    pending = true;
  }
  if (!pending) {
    bool ended_early = nts_zlib_is_zlib_decoder(engine->mode) &&
                       result == Z_STREAM_END && input_left;
    if (engine->status == 0 && result == Z_STREAM_END &&
        (engine->operation_flush == Z_FINISH || ended_early)) {
      engine->stream_ended = true;
    }
    nts_zlib_end_operation(engine);
  }

  engine->zstream.next_in = Z_NULL;
  engine->zstream.avail_in = 0;
  engine->zstream.next_out = Z_NULL;
  engine->zstream.avail_out = 0;
}

static void nts_zlib_brotli_step(NtsZlibEngine *engine, uint8_t *output,
                                 size_t output_limit, size_t *output_length) {
  size_t available_input = engine->operation_length - engine->operation_offset;
  const uint8_t *next_input =
      engine->operation_input == NULL
          ? NULL
          : engine->operation_input + engine->operation_offset;
  uint8_t *next_output = output;
  size_t available_output = output_limit;
  bool output_full;

  if (engine->family == NTS_ZLIB_FAMILY_BROTLI_ENCODER) {
    BROTLI_BOOL success = BrotliEncoderCompressStream(
        engine->brotli_encoder, (BrotliEncoderOperation)engine->operation_flush,
        &available_input, &next_input, &available_output, &next_output, NULL);
    if (!success) {
      nts_zlib_set_error(engine, -1, "Compression failed",
                         "ERR_BROTLI_COMPRESSION_FAILED");
    }
    engine->frame_complete = BrotliEncoderIsFinished(engine->brotli_encoder);
  } else {
    BrotliDecoderResult result = BrotliDecoderDecompressStream(
        engine->brotli_decoder, &available_input, &next_input,
        &available_output, &next_output, NULL);
    if (result == BROTLI_DECODER_RESULT_ERROR) {
      BrotliDecoderErrorCode code =
          BrotliDecoderGetErrorCode(engine->brotli_decoder);
      char code_name[96];
      snprintf(code_name, sizeof(code_name), "ERR_%s",
               BrotliDecoderErrorString(code));
      nts_zlib_set_error(engine, (int)code, "Decompression failed", code_name);
    }
    engine->frame_complete = result == BROTLI_DECODER_RESULT_SUCCESS;
  }

  size_t consumed =
      engine->operation_length - engine->operation_offset - available_input;
  engine->operation_offset += consumed;
  engine->bytes_written += consumed;
  *output_length = output_limit - available_output;
  output_full = available_output == 0;
  bool input_left = engine->operation_offset < engine->operation_length;

  if (engine->status == 0 && engine->family == NTS_ZLIB_FAMILY_BROTLI_DECODER &&
      engine->frame_complete && input_left &&
      engine->reject_garbage_after_end) {
    nts_zlib_trailing_error(engine);
  } else if (engine->status == 0 && !output_full &&
             engine->family == NTS_ZLIB_FAMILY_BROTLI_DECODER &&
             engine->operation_flush == BROTLI_OPERATION_FINISH &&
             !engine->frame_complete && !input_left) {
    nts_zlib_set_error(engine, Z_BUF_ERROR, "unexpected end of file",
                       "Z_BUF_ERROR");
  }

  bool pending = engine->status == 0 && output_full &&
                 (!engine->frame_complete || input_left);
  if (engine->status == 0 && engine->family == NTS_ZLIB_FAMILY_BROTLI_ENCODER &&
      input_left) {
    pending = true;
  }
  if (engine->status == 0 && engine->family == NTS_ZLIB_FAMILY_BROTLI_ENCODER &&
      BrotliEncoderHasMoreOutput(engine->brotli_encoder)) {
    pending = true;
  }
  if (!pending) {
    bool ended_early = engine->family == NTS_ZLIB_FAMILY_BROTLI_DECODER &&
                       engine->frame_complete && input_left;
    if (engine->status == 0 && engine->frame_complete &&
        (engine->operation_flush == BROTLI_OPERATION_FINISH || ended_early)) {
      engine->stream_ended = true;
    }
    nts_zlib_end_operation(engine);
  }
}

static void nts_zlib_zstd_step(NtsZlibEngine *engine, uint8_t *output,
                               size_t output_limit, size_t *output_length) {
  ZSTD_inBuffer input = {
      engine->operation_input == NULL
          ? NULL
          : engine->operation_input + engine->operation_offset,
      engine->operation_length - engine->operation_offset,
      0,
  };
  ZSTD_outBuffer out = {output, output_limit, 0};
  size_t result = 0;

  if (engine->family == NTS_ZLIB_FAMILY_ZSTD_COMPRESSOR) {
    result = ZSTD_compressStream2(engine->zstd_compressor, &out, &input,
                                  (ZSTD_EndDirective)engine->operation_flush);
    if (ZSTD_isError(result)) {
      nts_zlib_set_zstd_error(engine, result, NULL, NULL);
    }
    engine->frame_complete = !ZSTD_isError(result) && result == 0 &&
                             engine->operation_flush == ZSTD_e_end;
  } else if (!(engine->frame_complete && input.size == 0)) {
    result = ZSTD_decompressStream(engine->zstd_decompressor, &out, &input);
    if (ZSTD_isError(result)) {
      nts_zlib_set_zstd_error(engine, result, NULL, NULL);
      engine->frame_complete = false;
    } else {
      engine->frame_complete = result == 0;
    }
  }

  engine->operation_offset += input.pos;
  engine->bytes_written += input.pos;
  *output_length = out.pos;
  bool output_full = out.pos == out.size;
  bool input_left = engine->operation_offset < engine->operation_length;

  if (engine->status == 0 && !output_full &&
      engine->family == NTS_ZLIB_FAMILY_ZSTD_DECOMPRESSOR &&
      engine->frame_complete && input_left &&
      engine->reject_garbage_after_end) {
    nts_zlib_trailing_error(engine);
  } else if (engine->status == 0 && !output_full &&
             engine->family == NTS_ZLIB_FAMILY_ZSTD_DECOMPRESSOR &&
             engine->operation_flush == ZSTD_e_end && !engine->frame_complete &&
             !input_left) {
    nts_zlib_set_error(engine, Z_BUF_ERROR, "unexpected end of file",
                       "Z_BUF_ERROR");
  }

  bool pending = engine->status == 0 && output_full &&
                 (!engine->frame_complete || input_left);
  if (engine->status == 0 &&
      engine->family == NTS_ZLIB_FAMILY_ZSTD_COMPRESSOR &&
      (input_left || result != 0)) {
    pending = true;
  }
  if (!pending) {
    bool ended_early = engine->family == NTS_ZLIB_FAMILY_ZSTD_DECOMPRESSOR &&
                       engine->frame_complete && input_left;
    if (engine->status == 0 && engine->frame_complete &&
        (engine->operation_flush == ZSTD_e_end || ended_early)) {
      engine->stream_ended = true;
    }
    nts_zlib_end_operation(engine);
  }
}

static void nts_zlib_step(NtsZlibEngine *engine, uint8_t *output,
                          size_t output_limit, size_t *output_length) {
  *output_length = 0;
  if (!engine->operation_pending || engine->status != 0)
    return;
  switch (engine->family) {
  case NTS_ZLIB_FAMILY_ZLIB:
    nts_zlib_zlib_step(engine, output, output_limit, output_length);
    break;
  case NTS_ZLIB_FAMILY_BROTLI_ENCODER:
  case NTS_ZLIB_FAMILY_BROTLI_DECODER:
    nts_zlib_brotli_step(engine, output, output_limit, output_length);
    break;
  case NTS_ZLIB_FAMILY_ZSTD_COMPRESSOR:
  case NTS_ZLIB_FAMILY_ZSTD_DECOMPRESSOR:
    nts_zlib_zstd_step(engine, output, output_limit, output_length);
    break;
  }
}

static uint32_t nts_zlib_to_uint32(double value) {
  return nts_to_uint32(value);
}

static bool nts_zlib_apply_parameters(NtsZlibEngine *engine,
                                      const NtsArray *keys,
                                      const NtsArray *values) {
  uint32_t count = keys == NULL ? 0 : keys->header.length;
  if (values == NULL || values->header.length < count) {
    nts_zlib_set_error(engine, Z_STREAM_ERROR,
                       "Parameter key/value length mismatch", "Z_STREAM_ERROR");
    return false;
  }
  const double *key_items = NTS_ITEMS(keys, double);
  const double *value_items = NTS_ITEMS(values, double);
  for (uint32_t index = 0; index < count; index++) {
    int key = (int)key_items[index];
    uint32_t value = nts_zlib_to_uint32(value_items[index]);
    bool success;
    if (engine->family == NTS_ZLIB_FAMILY_BROTLI_ENCODER) {
      success = BrotliEncoderSetParameter(engine->brotli_encoder,
                                          (BrotliEncoderParameter)key, value);
    } else if (engine->family == NTS_ZLIB_FAMILY_BROTLI_DECODER) {
      success = BrotliDecoderSetParameter(engine->brotli_decoder,
                                          (BrotliDecoderParameter)key, value);
    } else if (engine->family == NTS_ZLIB_FAMILY_ZSTD_COMPRESSOR) {
      size_t result = ZSTD_CCtx_setParameter(
          engine->zstd_compressor, (ZSTD_cParameter)key, (int32_t)value);
      success = !ZSTD_isError(result);
    } else {
      size_t result = ZSTD_DCtx_setParameter(
          engine->zstd_decompressor, (ZSTD_dParameter)key, (int32_t)value);
      success = !ZSTD_isError(result);
    }
    if (!success) {
      const char *code =
          engine->family == NTS_ZLIB_FAMILY_BROTLI_ENCODER ||
                  engine->family == NTS_ZLIB_FAMILY_BROTLI_DECODER
              ? "ERR_BROTLI_PARAM_SET_FAILED"
              : "ERR_ZSTD_PARAM_SET_FAILED";
      nts_zlib_set_error(engine, -1, "Setting parameter failed", code);
      return false;
    }
  }
  return true;
}

static NtsZlibEngine *nts_zlib_new_zlib(int mode, int level, int window_bits,
                                        int mem_level, int strategy,
                                        NtsArray *dictionary,
                                        bool reject_garbage_after_end) {
  NtsZlibEngine *engine = nts_zlib_allocate_engine(
      mode, NTS_ZLIB_FAMILY_ZLIB, dictionary, reject_garbage_after_end);
  if (engine == NULL)
    return NULL;
  if (!nts_zlib_initialize_zlib(engine, level, window_bits, mem_level,
                                strategy)) {
    nts_zlib_publish_error(engine);
    nts_zlib_free_engine(engine);
    return NULL;
  }
  return engine;
}

static NtsZlibEngine *
nts_zlib_new_parameterized(int mode, NtsArray *keys, NtsArray *values,
                           NtsArray *dictionary, double pledged_source_size,
                           bool reject_garbage_after_end) {
  NtsZlibFamily family;
  switch (mode) {
  case NTS_BROTLI_ENCODE:
    family = NTS_ZLIB_FAMILY_BROTLI_ENCODER;
    break;
  case NTS_BROTLI_DECODE:
    family = NTS_ZLIB_FAMILY_BROTLI_DECODER;
    break;
  case NTS_ZSTD_COMPRESS:
    family = NTS_ZLIB_FAMILY_ZSTD_COMPRESSOR;
    break;
  case NTS_ZSTD_DECOMPRESS:
    family = NTS_ZLIB_FAMILY_ZSTD_DECOMPRESSOR;
    break;
  default:
    nts_zlib_set_global_error(Z_STREAM_ERROR, "Unsupported compression mode",
                              "Z_STREAM_ERROR");
    return NULL;
  }

  NtsZlibEngine *engine = nts_zlib_allocate_engine(mode, family, dictionary,
                                                   reject_garbage_after_end);
  if (engine == NULL)
    return NULL;
  engine->pledged_source_size = pledged_source_size < 0
                                    ? ZSTD_CONTENTSIZE_UNKNOWN
                                    : (uint64_t)pledged_source_size;
  bool initialized = family == NTS_ZLIB_FAMILY_BROTLI_ENCODER ||
                             family == NTS_ZLIB_FAMILY_BROTLI_DECODER
                         ? nts_zlib_initialize_brotli(engine, true)
                         : nts_zlib_initialize_zstd(engine, true);
  if (initialized) {
    initialized = nts_zlib_apply_parameters(engine, keys, values);
  }
  if (!initialized) {
    nts_zlib_publish_error(engine);
    nts_zlib_free_engine(engine);
    return NULL;
  }
  return engine;
}

double nts_zlib_create(double mode, double level, double window_bits,
                       double mem_level, double strategy, NtsArray *dictionary,
                       bool reject_garbage_after_end) {
  nts_zlib_clear_global_error();
  NtsZlibEngine *engine =
      nts_zlib_new_zlib((int)mode, (int)level, (int)window_bits, (int)mem_level,
                        (int)strategy, dictionary, reject_garbage_after_end);
  return engine == NULL ? (double)Z_STREAM_ERROR : nts_zlib_register(engine);
}

double nts_zlib_create_params(double mode, NtsArray *keys, NtsArray *values,
                              NtsArray *dictionary, double pledged_source_size,
                              bool reject_garbage_after_end) {
  nts_zlib_clear_global_error();
  NtsZlibEngine *engine =
      nts_zlib_new_parameterized((int)mode, keys, values, dictionary,
                                 pledged_source_size, reject_garbage_after_end);
  return engine == NULL ? (double)Z_STREAM_ERROR : nts_zlib_register(engine);
}

static bool nts_zlib_buffer_append(NtsZlibEngine *engine, NtsZlibBuffer *buffer,
                                   const uint8_t *bytes, size_t length) {
  if (length > buffer->maximum - buffer->length) {
    nts_zlib_set_error(
        engine, Z_MEM_ERROR,
        "Cannot create a Buffer larger than maxOutputLength bytes",
        "ERR_BUFFER_TOO_LARGE");
    return false;
  }
  size_t needed = buffer->length + length;
  if (needed > buffer->capacity) {
    size_t capacity = buffer->capacity == 0 ? 16384 : buffer->capacity;
    while (capacity < needed) {
      size_t next =
          capacity > buffer->maximum / 2 ? buffer->maximum : capacity * 2;
      if (next <= capacity) {
        capacity = needed;
        break;
      }
      capacity = next;
    }
    uint8_t *grown = realloc(buffer->data, capacity == 0 ? 1 : capacity);
    if (grown == NULL) {
      nts_zlib_set_error(engine, Z_MEM_ERROR, "Out of memory", "Z_MEM_ERROR");
      return false;
    }
    buffer->data = grown;
    buffer->capacity = capacity;
  }
  if (length != 0)
    memcpy(buffer->data + buffer->length, bytes, length);
  buffer->length = needed;
  return true;
}

static size_t nts_zlib_maximum(double maximum) {
  if (!(maximum > 0))
    return 1;
  if (maximum >= UINT32_MAX)
    return UINT32_MAX;
  return (size_t)maximum;
}

static NtsArray *nts_zlib_run_sync(NtsZlibEngine *engine, int flush,
                                   NtsArray *input, size_t maximum) {
  NtsZlibBuffer result = {NULL, 0, 0, maximum};
  if (!nts_zlib_begin_operation(engine, flush, input)) {
    return nts_zlib_bytes(NULL, 0);
  }
  unsigned stalled = 0;
  while (engine->operation_pending && engine->status == 0) {
    size_t room = result.maximum - result.length;
    size_t chunk = room >= 65536 ? 65536 : room + (room != SIZE_MAX);
    if (chunk == 0)
      chunk = 1;
    uint8_t *temporary = malloc(chunk);
    if (temporary == NULL) {
      nts_zlib_set_error(engine, Z_MEM_ERROR, "Out of memory", "Z_MEM_ERROR");
      break;
    }
    size_t before = engine->operation_offset;
    size_t produced = 0;
    nts_zlib_step(engine, temporary, chunk, &produced);
    bool appended =
        nts_zlib_buffer_append(engine, &result, temporary, produced);
    free(temporary);
    if (!appended)
      break;
    if (produced == 0 && engine->operation_offset == before) {
      if (++stalled == 16) {
        nts_zlib_set_error(engine, Z_BUF_ERROR,
                           "Compression engine made no progress",
                           "Z_BUF_ERROR");
        break;
      }
    } else {
      stalled = 0;
    }
  }
  if (engine->status != 0) {
    nts_zlib_end_operation(engine);
    free(result.data);
    return nts_zlib_bytes(NULL, 0);
  }
  NtsArray *output = nts_zlib_bytes(result.data, result.length);
  free(result.data);
  return output;
}

NtsArray *nts_zlib_write_sync(double handle, double flush, NtsArray *input,
                              double maximum_output) {
  NtsZlibEngine *engine = nts_zlib_find(handle);
  if (engine == NULL)
    return nts_zlib_bytes(NULL, 0);
  return nts_zlib_run_sync(engine, (int)flush, input,
                           nts_zlib_maximum(maximum_output));
}

static void nts_zlib_work_run(uv_work_t *request) {
  NtsZlibWork *work = request->data;
  nts_zlib_step(work->engine, work->output, work->output_limit,
                &work->output_length);
}

static void nts_zlib_work_after(uv_work_t *request, int status) {
  NtsZlibWork *work = request->data;
  NtsZlibEngine *engine = work->engine;
  engine->busy = false;
  if (status == UV_ECANCELED && engine->status == 0) {
    nts_zlib_set_error(engine, Z_ERRNO, "Compression operation cancelled",
                       "Z_ERRNO");
    nts_zlib_end_operation(engine);
  }
  NtsArray *output = nts_zlib_bytes(work->output, work->output_length);
  nts_promise_fulfill_reference(work->promise, (NtsHeader *)output);
  nts_release((NtsHeader *)output);
  nts_release((NtsHeader *)work->promise);
  free(work->output);
  free(work);

  if (engine->closing) {
    nts_zlib_unlink(engine);
    nts_zlib_free_engine(engine);
  }

  /* A standalone binary installs the libuv host, which owns checkpointing.
   * A Node-API addon currently does not; in that embedding the completion is
   * the safe owner-thread boundary at which the awaiting TypeScript must be
   * allowed to resume. nts_checkpoint() is deliberately a no-op for a host
   * that supplied its own microtask queue. */
  nts_checkpoint();
}

static NtsPromise *nts_zlib_fulfilled_empty(void) {
  NtsPromise *promise = nts_promise_new();
  NtsArray *empty = nts_zlib_bytes(NULL, 0);
  nts_promise_fulfill_reference(promise, (NtsHeader *)empty);
  nts_release((NtsHeader *)empty);
  return promise;
}

NtsPromise *nts_zlib_write(double handle, double flush, NtsArray *input,
                           double output_limit) {
  NtsZlibEngine *engine = nts_zlib_find(handle);
  if (engine == NULL)
    return nts_zlib_fulfilled_empty();
  if (engine->busy) {
    nts_zlib_set_error(engine, Z_STREAM_ERROR,
                       "A compression write is already in progress",
                       "Z_STREAM_ERROR");
    return nts_zlib_fulfilled_empty();
  }
  if (!nts_zlib_begin_operation(engine, (int)flush, input)) {
    return nts_zlib_fulfilled_empty();
  }

  size_t limit = output_limit > UINT32_MAX
                     ? UINT32_MAX
                     : (output_limit < 1 ? 1 : (size_t)output_limit);
  NtsZlibWork *work = calloc(1, sizeof(*work));
  uint8_t *output = malloc(limit);
  if (work == NULL || output == NULL) {
    free(work);
    free(output);
    nts_zlib_set_error(engine, Z_MEM_ERROR, "Out of memory", "Z_MEM_ERROR");
    nts_zlib_end_operation(engine);
    return nts_zlib_fulfilled_empty();
  }
  NtsPromise *promise = nts_promise_new();
  nts_retain((NtsHeader *)promise);
  work->request.data = work;
  work->engine = engine;
  work->promise = promise;
  work->output = output;
  work->output_limit = limit;
  engine->busy = true;
  int queued = uv_queue_work(uv_default_loop(), &work->request,
                             nts_zlib_work_run, nts_zlib_work_after);
  if (queued != 0) {
    engine->busy = false;
    nts_zlib_set_error(engine, Z_ERRNO, uv_strerror(queued), "Z_ERRNO");
    nts_zlib_end_operation(engine);
    nts_release((NtsHeader *)promise);
    free(output);
    free(work);
    NtsArray *empty = nts_zlib_bytes(NULL, 0);
    nts_promise_fulfill_reference(promise, (NtsHeader *)empty);
    nts_release((NtsHeader *)empty);
  }
  return promise;
}

double nts_zlib_status(double handle) {
  NtsZlibEngine *engine = nts_zlib_find(handle);
  return engine == NULL ? (double)Z_STREAM_ERROR : (double)engine->status;
}

NtsString *nts_zlib_error_message(double handle) {
  NtsZlibEngine *engine = nts_zlib_find(handle);
  return nts_zlib_string(engine == NULL ? nts_zlib_global_message
                                        : engine->error_message);
}

NtsString *nts_zlib_error_code(double handle) {
  NtsZlibEngine *engine = nts_zlib_find(handle);
  return nts_zlib_string(engine == NULL ? nts_zlib_global_code
                                        : engine->error_code);
}

bool nts_zlib_stream_ended(double handle) {
  NtsZlibEngine *engine = nts_zlib_find(handle);
  return engine != NULL && engine->stream_ended;
}

double nts_zlib_bytes_written(double handle) {
  NtsZlibEngine *engine = nts_zlib_find(handle);
  return engine == NULL ? 0 : (double)engine->bytes_written;
}

bool nts_zlib_operation_pending(double handle) {
  NtsZlibEngine *engine = nts_zlib_find(handle);
  return engine != NULL && engine->operation_pending;
}

static void nts_zlib_reset_zlib(NtsZlibEngine *engine) {
  int status = nts_zlib_is_zlib_encoder(engine->mode)
                   ? deflateReset(&engine->zstream)
                   : inflateReset(&engine->zstream);
  if (status == Z_OK)
    status = nts_zlib_set_zlib_dictionary(engine);
  if (status != Z_OK) {
    nts_zlib_set_error(engine, status, "Failed to reset stream",
                       nts_zlib_code(status));
  }
}

void nts_zlib_reset(double handle) {
  NtsZlibEngine *engine = nts_zlib_find(handle);
  if (engine == NULL)
    return;
  if (engine->busy || engine->operation_pending) {
    nts_zlib_set_error(engine, Z_STREAM_ERROR,
                       "Cannot reset zlib stream while a write is in progress",
                       "Z_STREAM_ERROR");
    return;
  }
  nts_zlib_clear_error(engine);
  engine->stream_ended = false;
  engine->frame_complete = false;
  engine->bytes_written = 0;
  engine->unzip_prefix_length = 0;
  if (engine->family == NTS_ZLIB_FAMILY_ZLIB) {
    nts_zlib_reset_zlib(engine);
  } else if (engine->family == NTS_ZLIB_FAMILY_BROTLI_ENCODER ||
             engine->family == NTS_ZLIB_FAMILY_BROTLI_DECODER) {
    nts_zlib_initialize_brotli(engine, false);
  } else {
    nts_zlib_initialize_zstd(engine, false);
  }
}

double nts_zlib_params(double handle, double level, double strategy) {
  NtsZlibEngine *engine = nts_zlib_find(handle);
  if (engine == NULL || engine->family != NTS_ZLIB_FAMILY_ZLIB ||
      !nts_zlib_is_zlib_encoder(engine->mode)) {
    return (double)Z_STREAM_ERROR;
  }
  if (engine->busy || engine->operation_pending)
    return (double)Z_STREAM_ERROR;
  uint8_t scratch[65536];
  engine->zstream.next_out = scratch;
  engine->zstream.avail_out = sizeof(scratch);
  int status = deflateParams(&engine->zstream, (int)level, (int)strategy);
  engine->zstream.next_out = Z_NULL;
  engine->zstream.avail_out = 0;
  if (status != Z_OK && status != Z_BUF_ERROR) {
    nts_zlib_set_error(engine, status, "Failed to set parameters",
                       nts_zlib_code(status));
  }
  return status == Z_BUF_ERROR ? 0 : (double)status;
}

void nts_zlib_close(double handle) {
  NtsZlibEngine *engine = nts_zlib_find(handle);
  if (engine == NULL)
    return;
  if (engine->busy) {
    engine->closing = true;
    return;
  }
  nts_zlib_unlink(engine);
  nts_zlib_free_engine(engine);
}

NtsArray *nts_zlib_oneshot(double mode, double level, double window_bits,
                           double mem_level, double strategy,
                           NtsArray *dictionary, double finish_flush,
                           double maximum_output, NtsArray *input,
                           bool reject_garbage_after_end) {
  nts_zlib_clear_global_error();
  NtsZlibEngine *engine =
      nts_zlib_new_zlib((int)mode, (int)level, (int)window_bits, (int)mem_level,
                        (int)strategy, dictionary, reject_garbage_after_end);
  if (engine == NULL)
    return nts_zlib_bytes(NULL, 0);
  NtsArray *output = nts_zlib_run_sync(engine, (int)finish_flush, input,
                                       nts_zlib_maximum(maximum_output));
  nts_zlib_publish_error(engine);
  nts_zlib_free_engine(engine);
  return output;
}

NtsArray *nts_zlib_oneshot_params(double mode, NtsArray *keys, NtsArray *values,
                                  NtsArray *dictionary,
                                  double pledged_source_size,
                                  double finish_flush, double maximum_output,
                                  NtsArray *input,
                                  bool reject_garbage_after_end) {
  nts_zlib_clear_global_error();
  NtsZlibEngine *engine =
      nts_zlib_new_parameterized((int)mode, keys, values, dictionary,
                                 pledged_source_size, reject_garbage_after_end);
  if (engine == NULL)
    return nts_zlib_bytes(NULL, 0);
  NtsArray *output = nts_zlib_run_sync(engine, (int)finish_flush, input,
                                       nts_zlib_maximum(maximum_output));
  nts_zlib_publish_error(engine);
  nts_zlib_free_engine(engine);
  return output;
}

double nts_zlib_last_status(void) { return (double)nts_zlib_global_status; }

NtsString *nts_zlib_last_error_message(void) {
  return nts_zlib_string(nts_zlib_global_message);
}

NtsString *nts_zlib_last_error_code(void) {
  return nts_zlib_string(nts_zlib_global_code);
}

double nts_crc32(NtsArray *input, double initial) {
  uint32_t value = nts_zlib_to_uint32(initial);
  size_t remaining = input == NULL ? 0 : input->header.length;
  const uint8_t *bytes = input == NULL ? NULL : NTS_ITEMS(input, uint8_t);
  while (remaining != 0) {
    uInt length = remaining > UINT_MAX ? UINT_MAX : (uInt)remaining;
    value = (uint32_t)crc32(value, bytes, length);
    bytes += length;
    remaining -= length;
  }
  return (double)value;
}
