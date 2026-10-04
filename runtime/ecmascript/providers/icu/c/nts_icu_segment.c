#include "nts_icu.h"
#include <unicode/ubrk.h>
#include <unicode/utext.h>
#include <stdlib.h>

// Immutable managed strings provide ICU's native UTF-16 indices. Wide text is
// borrowed directly; Latin-1 uses bounded decoded chunks, never a full copy.
enum { TEXT_CHUNK = 512 };
static UText *open_text(UText *text, NtsString *input, UErrorCode *status);

static int64_t U_CALLCONV text_length(UText *text) {
  return ((const NtsString *)text->context)->length;
}

static UBool U_CALLCONV text_access(UText *text, int64_t index, UBool forward) {
  const NtsString *input = text->context;
  const int64_t length = input->length;
  const bool available = forward ? index >= 0 && index < length : index > 0 && index <= length;
  if (index < 0) index = 0;
  if (index > length) index = length;
  if ((input->flags & NTS_TWO_BYTE) != 0) {
    text->chunkNativeStart = 0;
    text->chunkNativeLimit = length;
    text->chunkLength = (int32_t)length;
    text->chunkContents = NTS_ELEMENTS(input, UChar);
  } else {
    const int64_t inside = forward && index < length ? index : index > 0 ? index - 1 : 0;
    const int64_t start = inside / TEXT_CHUNK * TEXT_CHUNK;
    const int32_t count = (int32_t)(length - start < TEXT_CHUNK ? length - start : TEXT_CHUNK);
    const uint8_t *bytes = NTS_ELEMENTS(input, uint8_t);
    UChar *buffer = text->pExtra;
    for (int32_t offset = 0; offset < count; offset++) buffer[offset] = bytes[start + offset];
    text->chunkNativeStart = start;
    text->chunkNativeLimit = start + count;
    text->chunkLength = count;
    text->chunkContents = buffer;
  }
  text->nativeIndexingLimit = text->chunkLength;
  text->chunkOffset = (int32_t)(index - text->chunkNativeStart);
  return available;
}

static int32_t U_CALLCONV text_extract(UText *text, int64_t start, int64_t limit,
                                     UChar *destination, int32_t capacity, UErrorCode *status) {
  if (U_FAILURE(*status)) return 0;
  const NtsString *input = text->context;
  if (capacity < 0 || (destination == NULL && capacity != 0) || start > limit) {
    *status = U_ILLEGAL_ARGUMENT_ERROR;
    return 0;
  }
  if (start < 0) start = 0;
  if (limit > input->length) limit = input->length;
  if (start > limit) { *status = U_INDEX_OUTOFBOUNDS_ERROR; return 0; }
  const int32_t length = (int32_t)(limit - start);
  const int32_t count = length < capacity ? length : capacity;
  for (int32_t index = 0; index < count; index++) destination[index] = nts_unit(input, (uint32_t)(start + index));
  if (length < capacity) destination[length] = 0;
  else if (length > capacity) *status = U_BUFFER_OVERFLOW_ERROR;
  else if (length != 0) *status = U_STRING_NOT_TERMINATED_WARNING;
  text_access(text, limit, false);
  return length;
}

static int64_t U_CALLCONV text_offset(const UText *text) {
  return text->chunkNativeStart + text->chunkOffset;
}
static int32_t U_CALLCONV text_native_index(const UText *text, int64_t index) {
  return (int32_t)(index - text->chunkNativeStart);
}

static void U_CALLCONV close_text(UText *text) {
  nts_release((NtsHeader *)text->context);
  text->context = NULL;
}

static UText *U_CALLCONV clone_text(UText *destination, const UText *source, UBool deep, UErrorCode *status) {
  if (U_FAILURE(*status)) return NULL;
  if (deep) { *status = U_UNSUPPORTED_ERROR; return NULL; }
  if (destination == source) return destination;
  const int64_t index = source->chunkNativeStart + source->chunkOffset;
  destination = open_text(destination, (NtsString *)source->context, status);
  if (U_SUCCESS(*status)) text_access(destination, index, index < text_length(destination));
  return destination;
}

static const UTextFuncs text_functions = {
  .tableSize = sizeof(UTextFuncs), .clone = clone_text, .nativeLength = text_length,
  .access = text_access, .extract = text_extract, .mapOffsetToNative = text_offset,
  .mapNativeIndexToUTF16 = text_native_index, .close = close_text,
};

static UText *open_text(UText *text, NtsString *input, UErrorCode *status) {
  const bool wide = (input->flags & NTS_TWO_BYTE) != 0;
  text = utext_setup(text, wide ? 0 : TEXT_CHUNK * (int32_t)sizeof(UChar), status);
  if (U_FAILURE(*status)) return NULL;
  nts_retain((NtsHeader *)input);
  text->context = input;
  text->pFuncs = &text_functions;
  text->providerProperties = wide ? 1 << UTEXT_PROVIDER_STABLE_CHUNKS : 0;
  text_access(text, 0, true);
  return text;
}

static void close_segmenter(void *iterator, size_t data) {
  (void)data;
  ubrk_close(iterator);
}

static UBreakIterator *segmenter_state(NtsHeader *handle) {
  if (handle == NULL || handle->descriptor == NULL || handle->descriptor->kind != NTS_KIND_BOXED) abort();
  NtsBoxed *box = (NtsBoxed *)handle;
  if (box->free != close_segmenter || box->boxed == NULL) abort();
  return box->boxed;
}

NtsHeader *nts_icu_segment_open(NtsString *locale, double granularity) {
  if (!nts_icu_versions_match() || !isfinite(granularity) || granularity < 0 || granularity > 2
      || granularity != floor(granularity)) return NULL;
  for (uint32_t index = 0; index < locale->length; index++)
    if (nts_unit(locale, index) == 0 || nts_unit(locale, index) > 127) return NULL;
  const UBreakIteratorType types[] = { UBRK_CHARACTER, UBRK_WORD, UBRK_SENTENCE };
  const char *tag = nts_string_to_cstring(locale);
  UErrorCode status = U_ZERO_ERROR;
  UBreakIterator *iterator = ubrk_open(types[(int32_t)granularity], tag, NULL, 0, &status);
  nts_cstring_release(locale, tag);
  if (U_FAILURE(status)) { if (iterator != NULL) ubrk_close(iterator); return NULL; }
  return nts_boxed_new(iterator, close_segmenter, 0);
}

NtsHeader *nts_icu_segment_text(NtsHeader *handle, NtsString *input) {
  if (input->length > INT32_MAX) return NULL;
  UErrorCode status = U_ZERO_ERROR;
  UBreakIterator *iterator = ubrk_clone(segmenter_state(handle), &status);
  if (U_FAILURE(status)) { if (iterator != NULL) ubrk_close(iterator); return NULL; }
  UText source = UTEXT_INITIALIZER;
  open_text(&source, input, &status);
  if (U_SUCCESS(status)) ubrk_setUText(iterator, &source, &status);
  utext_close(&source);
  if (U_FAILURE(status)) { ubrk_close(iterator); return NULL; }
  ubrk_first(iterator);
  return nts_boxed_new(iterator, close_segmenter, 0);
}

double nts_icu_segment_boundary(NtsHeader *handle, double index, double direction) {
  UBreakIterator *iterator = segmenter_state(handle);
  if (direction == 0) return ubrk_next(iterator);
  if (direction == 2) return ubrk_previous(iterator);
  if (!isfinite(index) || index < 0 || index > INT32_MAX || index != floor(index)) return NAN;
  if (direction == 1) return ubrk_following(iterator, (int32_t)index);
  return NAN;
}
double nts_icu_segment_status(NtsHeader *handle) {
  return ubrk_getRuleStatus(segmenter_state(handle));
}
