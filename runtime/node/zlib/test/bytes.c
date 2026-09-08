/* `zlib.c`'s byte-returning bindings, which nothing has ever run.
 *
 * Seven signatures in this module changed from `NtsArray *` to `NtsView *` on
 * 2026-09-08, and `nts_zlib_bytes` -- the helper that allocates a buffer, copies
 * into it and wraps it in a view -- was written at the same time. The module
 * does not compile, so none of it had been executed by anything: the ABI audit
 * proves the *types* agree with the TypeScript, which is a different claim from
 * the code working.
 *
 * These are round trips rather than golden bytes. A fixed compressed blob would
 * pin this module to one zlib version and start failing on an upgrade for no
 * reason anybody could act on; a round trip asks the question that actually
 * matters -- that what comes back out is what went in -- and stays true across
 * versions. The one exception is `crc32`, which has a fixed answer by
 * specification and is checked against it.
 */
#if defined(__linux__) && !defined(_GNU_SOURCE)
#define _GNU_SOURCE
#endif

#include <stdio.h>
#include <string.h>

#include "nts_zlib.h"

const uint32_t nts_closure_call_slot = 0;

static int failures;

static void expect_true(const char *what, bool ok) {
  if (!ok) {
    printf("FAIL %s\n", what);
    failures++;
  } else {
    printf("ok   %s\n", what);
  }
}

/* zlib's own constants, spelled here so this file does not need zlib.h. */
#define FLUSH_FINISH 4
#define MODE_DEFLATE 1
#define MODE_INFLATE 2
#define MODE_GZIP 3
#define MODE_GUNZIP 4
#define MODE_DEFLATERAW 5
#define MODE_INFLATERAW 6

static NtsView *view_of(const uint8_t *bytes, size_t length) {
  NtsBuffer *buffer = nts_buffer_new((double)length);
  if (buffer == NULL) return NULL;
  if (length != 0) memcpy(buffer->bytes, bytes, length);
  return nts_view_new(buffer, 0.0, (double)length, (double)NTS_ELEMENT_U8,
                      false);
}

static bool same_bytes(NtsView *view, const uint8_t *want, size_t length) {
  if (view == NULL) return false;
  if (view->length_ != length) return false;
  return memcmp(view->buffer->bytes + view->byte_offset, want, length) == 0;
}

static NtsView *oneshot(double mode, NtsView *input) {
  return nts_zlib_oneshot(mode, -1.0 /* default level */, 15.0, 8.0,
                          0.0 /* default strategy */, NULL, FLUSH_FINISH,
                          16777216.0, input, false);
}

/* Deliberately compressible and deliberately not: a run of one byte exercises
 * the path where the output is far shorter than the input, and a counter
 * exercises the one where deflate cannot help and the output is *longer*. The
 * second is the case where a buffer sized from the input would be too small. */
static void a_round_trip_returns_what_went_in(double deflate_mode,
                                              double inflate_mode,
                                              const char *label,
                                              const uint8_t *bytes,
                                              size_t length) {
  NtsView *input = view_of(bytes, length);
  NtsView *packed = oneshot(deflate_mode, input);
  if (packed == NULL) {
    printf("FAIL %s: deflate returned null\n", label);
    failures++;
    return;
  }
  NtsView *back = oneshot(inflate_mode, packed);
  expect_true(label, same_bytes(back, bytes, length));
}

static void an_empty_input_round_trips(void) {
  /* Zero bytes is the case `nts_zlib_bytes` guards with `if (length != 0)`, and
   * an empty *view* is not the same as a null one -- node returns an empty
   * Buffer here rather than throwing. */
  NtsView *input = view_of((const uint8_t *)"", 0);
  NtsView *packed = oneshot(MODE_DEFLATE, input);
  expect_true("an empty input deflates to something", packed != NULL);
  if (packed == NULL) return;
  NtsView *back = oneshot(MODE_INFLATE, packed);
  expect_true("an empty input round trips",
              back != NULL && back->length_ == 0);
}

static void the_returned_view_is_a_u8_view_over_its_own_buffer(void) {
  const uint8_t bytes[] = {1, 2, 3, 4, 5};
  NtsView *input = view_of(bytes, sizeof bytes);
  NtsView *packed = oneshot(MODE_DEFLATE, input);
  if (packed == NULL) {
    printf("FAIL the returned view is a u8 view over its own buffer: null\n");
    failures++;
    return;
  }
  /* The whole point of the `NtsArray *` -> `NtsView *` change: what comes back
   * has to be something the TypeScript can hand to `Buffer.from` without a
   * copy, which means a byte view starting at zero and covering the buffer. An
   * array of doubles would have satisfied the old signature and been wrong. */
  expect_true("the returned view is a u8 view over its own buffer",
              packed->width == 1 && packed->byte_offset == 0 &&
                  packed->buffer != NULL &&
                  packed->buffer != input->buffer);
}

static void crc32_agrees_with_the_specification(void) {
  const uint8_t check[] = "123456789";
  NtsView *input = view_of(check, sizeof check - 1);
  /* The standard check value for CRC-32, and one of the few things here with a
   * right answer that does not depend on the zlib build. */
  expect_true("crc32 agrees with the specification",
              nts_crc32(input, 0.0) == 3421780262.0);
}

static void crc32_of_nothing_is_the_seed(void) {
  NtsView *input = view_of((const uint8_t *)"", 0);
  expect_true("crc32 of nothing is the seed", nts_crc32(input, 0.0) == 0.0);
}

int main(void) {
  uint8_t runs[4096];
  memset(runs, 'a', sizeof runs);

  uint8_t counter[4096];
  for (size_t i = 0; i < sizeof counter; i++) counter[i] = (uint8_t)(i * 7 + 3);

  a_round_trip_returns_what_went_in(MODE_DEFLATE, MODE_INFLATE,
                                    "deflate round trips a compressible input",
                                    runs, sizeof runs);
  a_round_trip_returns_what_went_in(MODE_DEFLATE, MODE_INFLATE,
                                    "deflate round trips an incompressible one",
                                    counter, sizeof counter);
  a_round_trip_returns_what_went_in(MODE_GZIP, MODE_GUNZIP,
                                    "gzip round trips", runs, sizeof runs);
  a_round_trip_returns_what_went_in(MODE_DEFLATERAW, MODE_INFLATERAW,
                                    "deflateRaw round trips", runs,
                                    sizeof runs);
  an_empty_input_round_trips();
  the_returned_view_is_a_u8_view_over_its_own_buffer();
  crc32_agrees_with_the_specification();
  crc32_of_nothing_is_the_seed();

  if (failures) {
    printf("%d failure(s)\n", failures);
    return 1;
  }
  printf("all zlib byte checks agree with the contract\n");
  return 0;
}
