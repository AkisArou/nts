#include "nts_web_compression.h"
#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static size_t collect(const NtsArray *chunks, uint8_t *output, size_t maximum) {
  size_t written = 0;
  for (uint32_t i = 0; i < chunks->header.length; i++) {
    const NtsView *chunk = NTS_ITEMS(chunks, NtsView *)[i];
    size_t length = (size_t)nts_view_byte_length(chunk);
    assert(length != 0 && length <= maximum - written);
    memcpy(output + written, nts_view_bytes(chunk), length);
    written += length;
  }
  return written;
}

static void one_format(int format, size_t size) {
  size_t live = nts_live_count();
  uint8_t *source = malloc(size == 0 ? 1 : size);
  uint8_t *encoded = malloc(size * 2 + 4096);
  uint8_t *decoded = malloc(size == 0 ? 1 : size);
  assert(source != NULL && encoded != NULL && decoded != NULL);
  for (size_t i = 0; i < size; i++)
    source[i] = (uint8_t)(i * 17 + (i >> 7));
  NtsView *input = nts_view_from_bytes(source, (double)size);
  NtsHeader *encoder = nts_web_compression_open(format, false, 15);
  assert(encoder != NULL);
  NtsArray *chunks = nts_web_compression_process(encoder, input, 2, INFINITY);
  assert(nts_web_compression_status(encoder) == 0);
  assert(nts_web_compression_consumed(encoder) == size);
  size_t encoded_size = collect(chunks, encoded, size * 2 + 4096);
  nts_release((NtsHeader *)chunks);
  nts_release((NtsHeader *)input);
  // Releasing an unclosed encoder exercises the native lifetime backstop.
  nts_release(encoder);
  NtsView *compressed = nts_view_from_bytes(encoded, (double)encoded_size);
  NtsHeader *decoder = nts_web_compression_open(format, true, 15);
  assert(decoder != NULL);
  chunks = nts_web_compression_process(decoder, compressed, 2, (double)size);
  assert(nts_web_compression_status(decoder) == 0);
  assert(nts_web_compression_consumed(decoder) == encoded_size);
  assert(collect(chunks, decoded, size) == size);
  assert(memcmp(source, decoded, size) == 0);
  nts_release((NtsHeader *)chunks);
  assert(nts_web_compression_reset(decoder));

  // A valid completed first stream returns its output before shared policy
  // rejects the unconsumed trailer (including a second gzip member).
  uint8_t *trailer = malloc(encoded_size * 2);
  assert(trailer != NULL);
  memcpy(trailer, encoded, encoded_size);
  memcpy(trailer + encoded_size, encoded, encoded_size);
  NtsView *trailing = nts_view_from_bytes(trailer, (double)(encoded_size * 2));
  chunks = nts_web_compression_process(decoder, trailing, 2, INFINITY);
  assert(nts_web_compression_status(decoder) == 0);
  assert(nts_web_compression_consumed(decoder) == encoded_size);
  assert(collect(chunks, decoded, size) == size);
  nts_release((NtsHeader *)chunks);
  nts_release((NtsHeader *)trailing);
  free(trailer);
  assert(nts_web_compression_reset(decoder));

  if (size != 0) {
    chunks =
        nts_web_compression_process(decoder, compressed, 2, (double)(size - 1));
    assert(nts_web_compression_status(decoder) == 2);
    assert(chunks->header.length == 0);
    assert(!nts_web_compression_reset(decoder));
    nts_release((NtsHeader *)chunks);
    nts_web_compression_close(decoder);
    nts_release(decoder);
    decoder = nts_web_compression_open(format, true, 15);
  }
  NtsView *short_input =
      nts_view_from_bytes(encoded, (double)(encoded_size - 1));
  chunks = nts_web_compression_process(decoder, short_input, 2, INFINITY);
  assert(nts_web_compression_status(decoder) == 3);
  assert(!nts_web_compression_reset(decoder));
  nts_release((NtsHeader *)chunks);
  nts_release((NtsHeader *)short_input);
  nts_web_compression_close(decoder);
  nts_web_compression_close(decoder);
  nts_release(decoder);
  nts_release((NtsHeader *)compressed);
  free(source);
  free(encoded);
  free(decoded);
  assert(nts_live_count() == live);
}

static void finished_failure(bool illegal_process) {
  size_t live = nts_live_count();
  NtsHeader *encoder = nts_web_compression_open(0, false, 15);
  NtsView *empty = nts_view_from_bytes(NULL, 0);
  NtsArray *chunks = nts_web_compression_process(encoder, empty, 2, INFINITY);
  assert(nts_web_compression_status(encoder) == 0);
  nts_release((NtsHeader *)chunks);
  if (illegal_process) {
    chunks = nts_web_compression_process(encoder, empty, 0, INFINITY);
    assert(nts_web_compression_status(encoder) == 4);
    assert(chunks->header.length == 0);
    nts_release((NtsHeader *)chunks);
  }
  // The only difference between the subject and control is the illegal call.
  assert(nts_web_compression_reset(encoder) == !illegal_process);
  nts_web_compression_close(encoder);
  nts_release(encoder);
  nts_release((NtsHeader *)empty);
  assert(nts_live_count() == live);
}

int main(void) {
  finished_failure(false);
  finished_failure(true);
  for (int format = 0; format < 4; format++) {
    one_format(format, 0);
    one_format(format, 1);
    one_format(format, 1024);
    one_format(format, 65537);
  }
  one_format(0, 1048576);
  assert(nts_web_compression_open(1, false, 8) == NULL);
  assert(nts_web_compression_open(4, false, 15) == NULL);
  assert(nts_web_compression_open(NAN, true, 15) == NULL);
  puts("native compression: 17 populations, exact limits, trailers, "
       "incomplete, finalizers PASS");
}
